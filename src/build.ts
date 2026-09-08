/**
 * Compilar o projeto Delphi sem sair do VS Code.
 *
 * O Delphi compila por MSBuild: o `.dproj` é um arquivo MSBuild, e o `rsvars.bat` da
 * instalação exporta as variáveis que ele precisa (BDS, caminho da biblioteca, versão do
 * framework). Chamar o msbuild direto sem esse ambiente falha com erros obscuros de unit
 * não encontrada — por isso invocamos sempre via `rsvars.bat && msbuild`.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import {
  CANDIDATOS, ProjetoInfo, acharRsvars, comandoBuild, configsUteis, expandir, instalacoesBds,
  lerProjeto, scriptBuild, scriptProprio,
} from './dfm/project';

const ESTADO = 'delphi4vscode.projetoAtivo';
const SCRIPT_PERGUNTADO = 'delphi4vscode.scriptPerguntado';

/** O painel mostra o nome que o Delphi usa, não o do alvo MSBuild. */
const ROTULO_ALVO: Record<string, string> = {
  Make: 'Compilar', Build: 'Recompilar tudo', Clean: 'Limpar',
  'Clean;Build': 'Limpar e reconstruir',
};

export type Alvo = 'Make' | 'Build' | 'Clean' | 'Clean;Build';

export class BuildManager {
  private status: vscode.StatusBarItem;
  /** Configuração e plataforma têm item próprio, como o combo da toolbar do Delphi. */
  private statusCfg: vscode.StatusBarItem;

  /**
   * Dispara quando o projeto ativo, a configuração ou a plataforma mudam.
   *
   * Existe porque o Code Insight precisa saber: o servidor compila contra o `.dproj` e as
   * DCUs da plataforma que estão valendo, e continuar apontado para o projeto anterior não dá
   * erro visível — dá autocompletar de outro projeto, que é pior que autocompletar nenhum.
   */
  private readonly mudou = new vscode.EventEmitter<void>();
  readonly onMudou = this.mudou.event;

  constructor(private ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(this.mudou);
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.status.command = 'delphi4vscode.selecionarProjeto';
    this.statusCfg = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.statusCfg.command = 'delphi4vscode.configurarBuild';
    ctx.subscriptions.push(this.status, this.statusCfg, this.canal);
    this.atualizarStatus();
  }

  get projeto(): ProjetoInfo | undefined {
    return this.ctx.workspaceState.get<ProjetoInfo>(ESTADO);
  }

  atualizarStatus(): void {
    const p = this.projeto;
    if (p) {
      const { config, plataforma } = this.opcoes();
      this.status.text = `$(file-code) ${p.nome} · ${config}/${plataforma}`;
      this.status.tooltip = `Projeto Delphi ativo: ${p.fsPath}\nClique para trocar`;
      this.status.show();
    } else {
      this.status.text = '$(file-code) Delphi: sem projeto';
      this.status.tooltip = 'Clique para escolher o .dproj ativo';
      this.status.show();
    }
  }

  /**
   * Configuração e plataforma que valem agora, já com o override temporário do
   * "compilar como...". Pública porque o Code Insight compila contra as DCUs da plataforma
   * escolhida, e ler a configuração uma vez na ativação deixa o servidor no Win32 depois que
   * o usuário troca para Win64.
   */
  get alvoAtual(): { config: string; plataforma: string } {
    const { config, plataforma } = this.opcoes();
    return { config, plataforma };
  }

  private opcoes(): { config: string; plataforma: string; verbosidade: string } {
    const cfg = vscode.workspace.getConfiguration('delphi4vscode');
    return {
      config: this.temporario?.config ?? cfg.get<string>('buildConfig', 'Debug'),
      plataforma: this.temporario?.plataforma ?? cfg.get<string>('buildPlatform', 'Win32'),
      verbosidade: cfg.get<string>('buildVerbosity', 'minimal'),
    };
  }

  /**
   * Qual RAD Studio usar.
   *
   * Com mais de um instalado, pergunta uma vez e grava. Escolher a versão mais alta sozinho
   * já compilou projeto com o compilador errado nesta extensão — e o sintoma foi um erro de
   * unit incompatível que não tinha nada a ver com a causa.
   */
  private async rsvars(): Promise<string | undefined> {
    const cfg = vscode.workspace.getConfiguration('delphi4vscode');
    const configurado = cfg.get<string>('bdsBinPath', '');
    if (configurado) { return acharRsvars(configurado); }

    const achadas = instalacoesBds();
    if (!achadas.length) { return undefined; }
    if (achadas.length === 1) { return achadas[0].rsvars; }

    const escolha = await vscode.window.showQuickPick(
      achadas.map(i => ({ label: `RAD Studio ${i.versao}`, detail: i.rsvars })),
      { title: 'Qual Delphi usar para compilar?',
        placeHolder: `${achadas.length} instalações encontradas — a escolha fica gravada` });
    if (!escolha) { return undefined; }
    await cfg.update('bdsBinPath', path.dirname(escolha.detail),
                     vscode.ConfigurationTarget.Workspace);
    this.log(`Delphi escolhido: ${escolha.label} (${escolha.detail})`);
    return escolha.detail;
  }

  /** Tudo que o build faz vai para um canal próprio: falhar em silêncio não ajuda ninguém. */
  private canal = vscode.window.createOutputChannel('Delphi Form');

  /*
   * O log vai para o canal E para um arquivo. O canal some quando a janela recarrega, e é
   * justamente no "apertei e não aconteceu nada" que se precisa olhar para trás.
   */
  private log(texto: string): void {
    const linha = `[${new Date().toISOString()}] ${texto}`;
    this.canal.appendLine(linha);
    try {
      fs.mkdirSync(this.ctx.globalStorageUri.fsPath, { recursive: true });
      const arq = path.join(this.ctx.globalStorageUri.fsPath, 'delphi4vscode.log');
      if (fs.existsSync(arq) && fs.statSync(arq).size > 512 * 1024) { fs.rmSync(arq); }
      fs.appendFileSync(arq, linha + String.fromCharCode(13, 10), "utf8");
    } catch { /* log é diagnóstico, não pode derrubar o build */ }
  }

  /** Os .bat de builds já encerrados não servem para nada; some com os de mais de uma hora. */
  private limparBatsVelhos(): void {
    const limite = Date.now() - 60 * 60 * 1000;
    try {
      for (const f of fs.readdirSync(this.ctx.globalStorageUri.fsPath)) {
        if (!/^build-.*\.bat$/.test(f) && f !== 'build.bat') { continue; }
        const alvo = path.join(this.ctx.globalStorageUri.fsPath, f);
        if (fs.statSync(alvo).mtimeMs < limite) { fs.rmSync(alvo, { force: true }); }
      }
    } catch { /* limpeza é higiene, não requisito */ }
  }

  /** Onde o log em arquivo mora — o comando de diagnóstico abre este arquivo. */
  arquivoDeLog(): string {
    return path.join(this.ctx.globalStorageUri.fsPath, 'delphi4vscode.log');
  }



  /** Ativa um projeto pelo caminho — é por aqui que a view e o QuickPick entram. */
  async ativar(fsPath: string): Promise<void> {
    await this.ctx.workspaceState.update(ESTADO, lerProjeto(fsPath));
    this.atualizarStatus();
    this.mudou.fire();
    vscode.window.showInformationMessage(
      `Projeto ativo: ${path.basename(fsPath)} — Ctrl+F9 compila.`);
  }

  /**
   * Devolve o projeto ativo, resolvendo um se não houver.
   *
   * Existe por causa de um defeito silencioso do rename: `workspaceState` é isolado por id de
   * extensão, então ninguém herdou o projeto ativo do `dfmview`. Sem projeto, o Code Insight
   * sobe, aponta para lugar nenhum e responde `null` a tudo — e nada na tela dizia por quê.
   *
   * Com um `.dproj` só no workspace não há o que perguntar. Com mais de um, quem escolhe é o
   * usuário: adivinhar aqui já compilou o projeto errado nesta extensão.
   */
  async garantirProjeto(perguntar: boolean): Promise<ProjetoInfo | undefined> {
    if (this.projeto) { return this.projeto; }
    const achados = await vscode.workspace.findFiles(
      '**/*.dproj', '**/{node_modules,__history,__recovery}/**', 50);
    if (!achados.length) { return undefined; }
    if (achados.length === 1) {
      await this.ativar(achados[0].fsPath);
      return this.projeto;
    }
    if (!perguntar) { return undefined; }
    await this.selecionar();
    return this.projeto;
  }

  async selecionar(): Promise<void> {
    const achados = await vscode.workspace.findFiles(
      '**/*.{dproj,dpr}', '**/{node_modules,__history,__recovery}/**', 200);
    if (!achados.length) {
      vscode.window.showWarningMessage('Nenhum .dproj ou .dpr encontrado no workspace.');
      return;
    }
    // .dproj antes de .dpr: é ele que o MSBuild entende
    const itens = achados
      .sort((a, b) => (b.path.endsWith('.dproj') ? 1 : 0) - (a.path.endsWith('.dproj') ? 1 : 0))
      .map(u => ({
        label: path.basename(u.fsPath),
        description: vscode.workspace.asRelativePath(u),
        uri: u,
      }));
    const escolha = await vscode.window.showQuickPick(itens,
      { title: 'Projeto Delphi ativo', placeHolder: 'Escolha o .dproj a compilar' });
    if (!escolha) { return; }
    await this.ativar(escolha.uri.fsPath);
  }

  /** Troca configuração e plataforma, oferecendo o que o .dproj declara. */
  async configurar(): Promise<void> {
    const p = this.projeto;
    if (!p) { await this.selecionar(); return; }
    const atual = this.opcoes();
    const config = await vscode.window.showQuickPick(configsUteis(p.configs),
      { title: `Configuração — ${p.nome}`, placeHolder: `atual: ${atual.config}` });
    if (!config) { return; }
    const plataforma = await vscode.window.showQuickPick(p.plataformas,
      { title: 'Plataforma', placeHolder: `atual: ${atual.plataforma}` });
    if (!plataforma) { return; }
    const cfg = vscode.workspace.getConfiguration('delphi4vscode');
    await cfg.update('buildConfig', config, vscode.ConfigurationTarget.Workspace);
    await cfg.update('buildPlatform', plataforma, vscode.ConfigurationTarget.Workspace);
    this.atualizarStatus();
    this.mudou.fire();
  }

  /** Monta a task do VS Code: rsvars + msbuild, com o problem matcher do compilador. */
  /*
   * Os alvos do MSBuild não têm o nome que o Delphi usa, e a diferença importa:
   *
   *   IDE Ctrl+F9  "Compile"  -> /t:Make   (recompila só o que mudou)
   *   IDE Shift+F9 "Build"    -> /t:Build  (passa -B ao dcc32: recompila TUDO)
   *
   * Chamar /t:Build no Ctrl+F9 é o que fazia esta extensão, e não é a mesma coisa: num
   * projeto que mantém uma cópia própria de unit da VCL, o -B recompila essa unit contra
   * os .dcu pré-compilados da VCL e o build morre com F2051 — enquanto o Compile do IDE,
   * que nem toca nela, passa.
   */
  /**
   * Linha e diretório do script do projeto, se houver um configurado.
   *
   * Quando existe, ele substitui o rsvars+msbuild inteiro: um projeto que carrega a própria
   * toolchain não compila com a instalação da máquina, e insistir só produz F2051.
   */
  private scriptDoProjeto(p: ProjetoInfo, alvo: string): { linha: string; cwd: string } | null {
    const cfg = vscode.workspace.getConfiguration('delphi4vscode');
    const bruto = cfg.get<string>('buildScript', '').trim();
    if (!bruto) { return null; }
    const raiz = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(p.fsPath);
    const { config, plataforma } = this.opcoes();
    const vars = {
      target: alvo, project: path.basename(p.fsPath).replace(/\.[^.]+$/, ''),
      projectPath: p.fsPath, config, platform: plataforma, workspaceFolder: raiz,
    };
    const cwdBruto = cfg.get<string>('buildScriptCwd', '').trim();
    const cwd = cwdBruto ? path.resolve(expandir(cwdBruto, vars)) : raiz;
    return { linha: expandir(bruto, vars), cwd };
  }

  /** Oferece o script do próprio repositório quando acha um e nada foi configurado. */
  async oferecerScript(): Promise<void> {
    const raiz = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!raiz) { return; }
    const achados = CANDIDATOS
      .map(c => path.join(raiz, ...c.split('/')))
      .filter(f => fs.existsSync(f));
    if (!achados.length) {
      vscode.window.showInformationMessage(
        'Não achei script de build no repositório. Configure delphi4vscode.buildScript à mão.');
      await vscode.commands.executeCommand('workbench.action.openSettings', 'delphi4vscode.buildScript');
      return;
    }
    const escolha = await vscode.window.showQuickPick(
      achados.map(f => ({ label: path.relative(raiz, f), detail: f })),
      { title: 'Script de build do projeto',
        placeHolder: 'A extensão passa o nome do projeto como argumento' });
    if (!escolha) { return; }
    const cfg = vscode.workspace.getConfiguration();
    // o marcador do nome do projeto e expandido na hora de montar o .bat
    // aspas simples de shell: JSON.stringify duplicaria as barras invertidas do caminho
    const linha = '"' + escolha.detail + '" ' + String.fromCharCode(36) + '{project}';
    await cfg.update('delphi4vscode.buildScript', linha, vscode.ConfigurationTarget.Workspace);
    await cfg.update("delphi4vscode.buildScriptCwd", path.dirname(raiz),
      vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(
      `Build passa a usar ${escolha.label}. Ajuste delphi4vscode.buildScriptCwd se ele espera ` +
      'outro diretório corrente.');
  }

  /**
   * Escolhe configuração e plataforma só para esta compilação, sem gravar.
   *
   * É o caso de "quero conferir se o Release compila" sem mexer no que está configurado —
   * trocar e lembrar de voltar é como se esquece o projeto em Release por uma semana.
   */
  async compilarComo(): Promise<void> {
    let p = this.projeto;
    if (!p) { await this.selecionar(); p = this.projeto; }
    if (!p) { return; }
    const combinacoes: { label: string; config: string; plataforma: string }[] = [];
    for (const c of configsUteis(p.configs)) {
      for (const pl of p.plataformas) {
        combinacoes.push({ label: `${c} / ${pl}`, config: c, plataforma: pl });
      }
    }
    const escolha = await vscode.window.showQuickPick(combinacoes,
      { title: `Compilar ${p.nome} como`, placeHolder: 'não altera a configuração gravada' });
    if (!escolha) { return; }
    this.temporario = { config: escolha.config, plataforma: escolha.plataforma };
    try {
      await this.executar('Make');
    } finally {
      this.temporario = undefined;
    }
  }

  /** Configuração válida só para a compilação em curso (compilarComo). */
  private temporario: { config: string; plataforma: string } | undefined;

  /** Ponto de entrada dos comandos: nada aqui pode terminar sem o usuário saber por quê. */
  /**
   * Propriedades MSBuild extras só para a próxima compilação.
   *
   * É como a depuração pede o map detalhado sem mexer no `.dproj` do usuário: um
   * `/p:DCC_MapFile=3` na linha de comando vale para aquele build e não deixa rastro.
   */
  extras: Record<string, string> = {};

  async executar(alvo: Alvo): Promise<void> {
    try {
      await this.executarInterno(alvo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`FALHOU: ${msg}`);
      const acao = await vscode.window.showErrorMessage(
        `Não consegui iniciar o build: ${msg}`, 'Ver detalhes');
      if (acao) { this.canal.show(); }
    }
  }

  private async executarInterno(alvo: Alvo): Promise<void> {
    this.log(`--- ${alvo} pedido ---`);
    let p = this.projeto;
    if (!p) {
      await this.selecionar();
      p = this.projeto;
      if (!p) { this.log('nenhum projeto ativo escolhido'); return; }
    }
    this.log(`projeto: ${p.fsPath}`);
    await this.talvezOferecerScript();
    const proprio = this.scriptDoProjeto(p, alvo);
    if (proprio) {
      this.log(`script do projeto: ${proprio.linha} (em ${proprio.cwd})`);
      await this.rodar(p, alvo, scriptProprio(proprio.linha, proprio.cwd));
      return;
    }
    const rs = await this.rsvars();
    if (!rs) {
      this.log('nenhum rsvars.bat utilizável');
      const acao = await vscode.window.showErrorMessage(
        'Não achei o rsvars.bat da Embarcadero. Aponte a pasta bin do Delphi nas configurações.',
        'Abrir configurações');
      if (acao) {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'delphi4vscode.bdsBinPath');
      }
      return;
    }
    this.log(`rsvars: ${rs}`);
    const { config, plataforma, verbosidade } = this.opcoes();
    await this.rodar(p, alvo,
      scriptBuild(rs, p.fsPath, alvo, config, plataforma, verbosidade, this.extras));
  }

  /*
   * Projeto que traz o próprio script de build costuma trazê-lo porque a instalação da
   * máquina não serve. Perguntar uma vez, na primeira compilação, evita que o usuário
   * descubra isso por um F2051 sem explicação.
   */
  private async talvezOferecerScript(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('delphi4vscode');
    if (cfg.get<string>('buildScript', '').trim()) { return; }
    if (this.ctx.workspaceState.get<boolean>(SCRIPT_PERGUNTADO)) { return; }
    const raiz = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!raiz) { return; }
    const achados = CANDIDATOS
      .map(c => path.join(raiz, ...c.split('/')))
      .filter(f => fs.existsSync(f));
    if (!achados.length) { return; }

    await this.ctx.workspaceState.update(SCRIPT_PERGUNTADO, true);
    const acao = await vscode.window.showInformationMessage(
      `Este repositório tem script de build próprio (${path.relative(raiz, achados[0])}). ` +
      'Projetos assim costumam não compilar com o Delphi instalado na máquina. Usar o script?',
      'Usar o script', 'Continuar com msbuild');
    if (acao === 'Usar o script') { await this.oferecerScript(); }
  }

  /** Escreve o .bat e o executa como task do VS Code, com o problem matcher do compilador. */
  private async rodar(p: ProjetoInfo, alvo: string, conteudo: string): Promise<void> {
    const { config, plataforma } = this.opcoes();
    /*
     * Um .bat por invocação, não um só reaproveitado.
     *
     * O cmd.exe lê o arquivo enquanto executa: reescrever o mesmo `build.bat` com um build
     * ainda rodando corrompe a execução em andamento, e a nova às vezes nem começa. Foi o
     * que fez o segundo Ctrl+F9 seguido "não fazer nada".
     */
    const bat = path.join(this.ctx.globalStorageUri.fsPath,
                          `build-${Date.now().toString(36)}.bat`);
    try {
      fs.mkdirSync(this.ctx.globalStorageUri.fsPath, { recursive: true });
      this.limparBatsVelhos();
      fs.writeFileSync(bat, conteudo, 'latin1');
    } catch (err) {
      vscode.window.showErrorMessage(
        `Não consegui preparar o script de build: ${err instanceof Error ? err.message : err}`);
      return;
    }

    const task = new vscode.Task(
      { type: 'delphi4vscode', alvo },
      vscode.TaskScope.Workspace,
      `${ROTULO_ALVO[alvo] ?? alvo} ${p.nome} (${config}/${plataforma})`,
      'Delphi',
      // o quoting e do VS Code: montar as aspas na mao faz o argumento chegar escapado
      new vscode.ShellExecution(
        { value: comandoBuild(bat), quoting: vscode.ShellQuoting.Strong }, [],
        { executable: 'cmd.exe', shellArgs: ['/d', '/c'] }),
      /*
       * Os dois formatos, porque os dois acontecem: o build padrão vai por MSBuild, que
       * embrulha a linha do compilador, e quem usa script próprio chama o `dcc32` direto.
       * Só o segundo estava declarado, e por isso erro de compilação nunca virou item
       * clicável no painel Problems — uma falha muda, porque ninguém repara na ausência.
       */
      ['$delphi4vscode-msbuild', '$delphi4vscode-dcc'],
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Shared,
      clear: true,
    };
    task.group = alvo === 'Clean' ? vscode.TaskGroup.Clean : vscode.TaskGroup.Build;
    this.log(`executando ${bat}`);
    const execucao = await vscode.tasks.executeTask(task);
    if (!execucao) { throw new Error('o VS Code não aceitou a task de build'); }
    this.atualizarStatus();
  }
}

export function registrarBuild(ctx: vscode.ExtensionContext): BuildManager {
  const mgr = new BuildManager(ctx);
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.selecionarProjeto', () => mgr.selecionar()),
    vscode.commands.registerCommand('delphi4vscode.configurarBuild', () => mgr.configurar()),
    vscode.commands.registerCommand('delphi4vscode.build', () => mgr.executar('Make')),
    vscode.commands.registerCommand('delphi4vscode.rebuild', () => mgr.executar('Build')),
    vscode.commands.registerCommand('delphi4vscode.clean', () => mgr.executar('Clean')),
    vscode.commands.registerCommand('delphi4vscode.cleanBuild', () => mgr.executar('Clean;Build')),
    vscode.commands.registerCommand('delphi4vscode.compilarComo', () => mgr.compilarComo()),
    vscode.commands.registerCommand('delphi4vscode.usarScriptBuild', () => mgr.oferecerScript()),
    vscode.commands.registerCommand('delphi4vscode.abrirLog', async () => {
      const arq = mgr.arquivoDeLog();
      if (!fs.existsSync(arq)) {
        vscode.window.showInformationMessage(
          'Ainda não há log: o build nunca chegou a rodar nesta instalação.');
        return;
      }
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(arq));
    }),
  );
  return mgr;
}
