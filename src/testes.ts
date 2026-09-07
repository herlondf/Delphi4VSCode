/**
 * Os testes DUnitX na aba de testes do VS Code.
 *
 * O runner do DUnitX é um `.exe` de console que já sai da compilação normal — não há nada a
 * inventar sobre como executar. O que faltava era o VS Code saber quais testes existem (para
 * listar sem compilar nada) e entender o que voltou (para pintar verde/vermelho e levar à
 * linha da falha).
 *
 * As opções de linha de comando saíram da fonte do próprio DUnitX que vem na instalação
 * (`source/DUnitX/DUnitX.OptionsDefinition.pas`), não de tentativa e erro:
 *
 *   --exitbehavior:Continue   sem isso o runner espera <Enter> e a execução trava
 *   --xmlfile:<caminho>       onde gravar o resultado NUnit
 *   --run:<nomes>             roda só os testes pedidos, separados por vírgula
 *   --consolemode:Quiet       o console interessa pouco quando o XML vem completo
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildManager } from './build';
import { descobrirTestes, lerResultados, resumo, ResultadoTeste } from './dfm/dunitx';
import { exeDoProjeto } from './dfm/projeto';

/** `Unidade.TFixture.Metodo`, que é como o DUnitX nomeia o teste no `--run` e no XML. */
function nomeCompleto(unidade: string, fixture: string, metodo: string): string {
  return `${unidade}.${fixture}.${metodo}`;
}

function excluidos(): string[] {
  return vscode.workspace.getConfiguration('delphi4vscode')
    .get<string[]>('symbols.excluir', ['vendor', 'vendors', 'third-party', 'thirdparty']);
}

/**
 * Executa o `.exe` e devolve o que o XML disser.
 *
 * O runner grava o XML ao lado do próprio executável (ele faz `SetCurrentDir` para lá), então
 * o caminho vai explícito — senão o resultado de uma execução some dentro da pasta de build e
 * a leitura pega o de ontem.
 */
function rodarExe(
  exe: string, filtro: string[], canal: vscode.OutputChannel,
): Promise<ResultadoTeste[]> {
  const xml = path.join(os.tmpdir(), `d4vs-testes-${Date.now().toString(36)}.xml`);
  const args = ['--exitbehavior:Continue', '--consolemode:Quiet', `--xmlfile:${xml}`];
  if (filtro.length) { args.push(`--run:${filtro.join(',')}`); }
  canal.appendLine(`${exe} ${args.join(' ')}`);

  return new Promise(resolve => {
    execFile(exe, args, { cwd: path.dirname(exe), timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        /*
         * Código de saída 1 quer dizer "algum teste falhou", que é resultado, não erro de
         * execução. Quem decide é o XML: se ele existe, foi executado.
         */
        if (stdout) { canal.appendLine(stdout.trim().slice(0, 4000)); }
        if (stderr) { canal.appendLine(stderr.trim().slice(0, 2000)); }
        let texto = '';
        try {
          texto = fs.readFileSync(xml, 'utf8');
        } catch {
          canal.appendLine(`sem XML em ${xml}${err ? ` — ${String(err)}` : ''}`);
          resolve([]);
          return;
        }
        try { fs.unlinkSync(xml); } catch { /* temporário */ }
        resolve(lerResultados(texto));
      });
  });
}

export function registrarTestes(
  ctx: vscode.ExtensionContext, build: BuildManager, canal: vscode.OutputChannel,
): void {
  const ctrl = vscode.tests.createTestController('delphi4vscode', 'Delphi (DUnitX)');
  ctx.subscriptions.push(ctrl);

  /** id do item -> nome completo que o `--run` entende. */
  const nomes = new Map<string, string>();
  /** id do item -> o item, para pintar o resultado sem revarrer a árvore. */
  const itens = new Map<string, vscode.TestItem>();

  async function descobrir(): Promise<void> {
    ctrl.items.replace([]);
    nomes.clear();
    itens.clear();
    const fora = excluidos().map(e => `**/${e}/**`).join(',');
    const arquivos = await vscode.workspace.findFiles(
      '**/*.pas', `{**/__history/**,**/__recovery/**,**/node_modules/**${fora ? ',' + fora : ''}}`);

    for (const uri of arquivos) {
      let src: string;
      try { src = fs.readFileSync(uri.fsPath, 'latin1'); } catch { continue; }
      // filtro barato antes de varrer: a maioria dos .pas de um projeto nao tem teste
      if (!/TestFixture|RegisterTestFixture|\[\s*Test\s*\]/i.test(src)) { continue; }

      const achados = descobrirTestes(src, uri.fsPath);
      if (!achados.length) { continue; }
      const unidade = path.basename(uri.fsPath).replace(/\.pas$/i, '');
      const doArquivo = ctrl.createTestItem(uri.fsPath, path.basename(uri.fsPath), uri);
      ctrl.items.add(doArquivo);

      const porFixture = new Map<string, vscode.TestItem>();
      for (const t of achados) {
        let fx = porFixture.get(t.fixture);
        if (!fx) {
          fx = ctrl.createTestItem(`${uri.fsPath}#${t.fixture}`, t.fixture, uri);
          porFixture.set(t.fixture, fx);
          doArquivo.children.add(fx);
        }
        const id = `${uri.fsPath}#${t.fixture}#${t.nome}`;
        const item = ctrl.createTestItem(id, t.nome, uri);
        item.range = new vscode.Range(t.linha, 0, t.linha, 0);
        fx.children.add(item);
        nomes.set(id, nomeCompleto(unidade, t.fixture, t.nome));
        itens.set(id, item);
      }
    }
    canal.appendLine(`testes descobertos: ${itens.size} em ${ctrl.items.size} arquivo(s)`);
  }

  ctrl.refreshHandler = () => descobrir();

  async function executar(
    pedido: vscode.TestRunRequest, cancelar: vscode.CancellationToken,
  ): Promise<void> {
    const projeto = vscode.workspace.getConfiguration('delphi4vscode')
      .get<string>('testProject', '') || build.projeto?.fsPath;
    if (!projeto) {
      vscode.window.showWarningMessage(
        'Ative o .dproj dos testes, ou aponte delphi4vscode.testProject.');
      return;
    }
    const exe = exeDoProjeto(projeto);
    if (!exe) {
      const acao = await vscode.window.showWarningMessage(
        `Não achei o executável de ${path.basename(projeto)}. Compile antes de rodar.`,
        'Compilar');
      if (acao) { await vscode.commands.executeCommand('delphi4vscode.build'); }
      return;
    }

    const run = ctrl.createTestRun(pedido);
    const alvos: vscode.TestItem[] = [];
    const juntar = (i: vscode.TestItem): void => {
      if (i.children.size) { i.children.forEach(juntar); } else { alvos.push(i); }
    };
    if (pedido.include) { pedido.include.forEach(juntar); }
    else { ctrl.items.forEach(juntar); }
    for (const a of alvos) { run.enqueued(a); }

    /*
     * Sem `include` roda tudo sem filtro: passar 686 nomes no `--run` estoura a linha de
     * comando do Windows, e o runner já roda tudo quando não há filtro.
     */
    const filtro = pedido.include
      ? alvos.map(a => nomes.get(a.id)).filter((s): s is string => !!s) : [];

    const t0 = Date.now();
    const resultados = await rodarExe(exe, filtro, canal);
    if (cancelar.isCancellationRequested) { run.end(); return; }

    /* O XML identifica o teste por fixture + nome; o id da árvore carrega os dois. */
    const porChave = new Map<string, ResultadoTeste>();
    for (const r of resultados) {
      porChave.set(`${r.fixture.toLowerCase()}#${r.nome.toLowerCase()}`, r);
    }
    for (const a of alvos) {
      const partes = a.id.split('#');
      const r = porChave.get(`${(partes[1] ?? '').toLowerCase()}#${(partes[2] ?? '').toLowerCase()}`);
      const ms = (r?.tempo ?? 0) * 1000;
      if (!r) { run.skipped(a); }
      else if (r.passou) { run.passed(a, ms); }
      else if (!r.executado) { run.skipped(a); }
      else {
        const msg = new vscode.TestMessage(r.mensagem ?? 'falhou sem mensagem');
        run.failed(a, msg, ms);
      }
    }
    canal.appendLine(`${resumo(resultados)} — ${((Date.now() - t0) / 1000).toFixed(1)}s de relógio`);
    run.end();
  }

  ctrl.createRunProfile('Executar', vscode.TestRunProfileKind.Run, executar, true);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.descobrirTestes', () => descobrir()),
    // o `.pas` salvo pode ter ganhado ou perdido um teste
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (/\.pas$/i.test(doc.uri.fsPath) && /TestFixture|RegisterTestFixture/i.test(doc.getText())) {
        void descobrir();
      }
    }),
  );
  setTimeout(() => void descobrir(), 3000);
}
