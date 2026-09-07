/**
 * O cliente do `DelphiLSP.exe` — o Code Insight do próprio compilador dentro do VS Code.
 *
 * O servidor vem na instalação do Delphi (`bin\DelphiLSP.exe`) e fala LSP por stdio. Ele não
 * lê o `.dproj`: exige um `<projeto>.delphilsp.json` que a IDE normalmente escreve, e que
 * `config.ts` gera daqui. O protocolo abaixo é o mesmo do cliente oficial da Embarcadero,
 * conferido no código dela: argumentos de linha de comando, `initializationOptions` com o
 * tipo de servidor, e o caminho do arquivo de configuração chegando por
 * `workspace/didChangeConfiguration` — não por `initializationOptions`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  LanguageClient, LanguageClientOptions, ServerOptions,
} from 'vscode-languageclient/node';
import { gravarConfig, paraUri } from './config';
import { marcarLsp, marcarProjeto } from './estado';
import { BuildManager } from '../build';
import { Registry } from '../dfm/registry';
import { resolverDefinicao } from '../pascalNav';

/*
 * `vscode-languageclient` só carrega dentro do VS Code — ele estende classes do módulo
 * `vscode`. Importar no topo faria a extensão inteira depender disso para ser sequer
 * carregada, e é por isso que aqui é `import type` mais um `require` lá dentro.
 */
let cliente: LanguageClient | undefined;
/*
 * O estado do Code Insight fica na barra, ao lado do projeto.
 *
 * Ele já subiu apontando para lugar nenhum e respondendo `null` a tudo, sem nada na tela
 * dizendo isso — o usuário conclui que o autocompletar "não funciona". Um item de status
 * custa nada e torna esse estado impossível de passar batido.
 */
let barra: vscode.StatusBarItem | undefined;
/** Quantas vezes o servidor fechou nesta sessão. */
let fechou = 0;

function mostrarEstado(texto: string, aviso: boolean, dica: string): void {
  if (!barra) { return; }
  barra.text = `$(${aviso ? 'warning' : 'symbol-method'}) ${texto}`;
  barra.tooltip = dica;
  barra.backgroundColor = aviso
    ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  barra.show();
}

function exeDoLsp(bdsBin: string): string | undefined {
  const exe = path.join(bdsBin, 'DelphiLSP.exe');
  return fs.existsSync(exe) ? exe : undefined;
}

/** Manda o servidor recarregar o projeto. Barato quando nada mudou: o arquivo não é reescrito. */
async function apontarProjeto(
  c: LanguageClient, dproj: string, bdsBin: string, versao: string,
  plataforma: string, config: string, canal: vscode.OutputChannel,
): Promise<void> {
  let arquivo: string;
  try {
    ({ arquivo } = gravarConfig({ dproj, bdsBin, versaoBds: versao, plataforma, config }));
  } catch (err) {
    canal.appendLine(`falhou ao gerar o .delphilsp.json: ${String(err)}`);
    return;
  }
  canal.appendLine(`projeto do LSP: ${arquivo}`);
  await c.sendNotification('workspace/didChangeConfiguration',
    { settings: { settingsFile: paraUri(arquivo) } });
  marcarProjeto(true);
}

export async function registrarLsp(
  ctx: vscode.ExtensionContext, build: BuildManager, canal: vscode.OutputChannel,
  registry: () => Registry,
): Promise<void> {
  /*
   * O comando entra antes de qualquer desistência.
   *
   * Ele é declarado no `package.json`, então aparece na paleta de todo mundo — inclusive de
   * quem não tem Delphi instalado, ou desligou o LSP. Registrar só depois que o servidor sobe
   * deixa a entrada visível e quebrada, com "command not found" e nenhuma pista do motivo.
   */
  let apontar = async (): Promise<void> => {
    vscode.window.showWarningMessage(
      'O Code Insight do Delphi não está no ar. Veja o canal "Delphi Code Insight".');
  };
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.lspRecarregar', () => apontar()));

  barra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  barra.command = 'delphi4vscode.lspRecarregar';
  ctx.subscriptions.push(barra);
  mostrarEstado('Code Insight: subindo', false, 'DelphiLSP iniciando');

  const cfg = vscode.workspace.getConfiguration('delphi4vscode');
  if (cfg.get<boolean>('lsp.enabled', true) === false) {
    mostrarEstado('Code Insight: desligado', false,
      'delphi4vscode.lsp.enabled está false');
    canal.appendLine('LSP desligado por configuração (delphi4vscode.lsp.enabled).');
    return;
  }

  const bdsBin = cfg.get<string>('bdsBinPath', '');
  const exe = bdsBin ? exeDoLsp(bdsBin) : undefined;
  if (!exe) {
    const porque = bdsBin
      ? `sem DelphiLSP.exe em ${bdsBin}`
      : 'sem instalação do Delphi escolhida';
    canal.appendLine(`${porque} — Code Insight fica no índice próprio`);
    mostrarEstado('Code Insight: indisponível', true, porque);
    return;
  }

  const versao = /(\d+\.\d+)/.exec(bdsBin)?.[1] ?? '';
  const pasta = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  /*
   * A lib carrega aqui, antes das opcoes, porque o `errorHandler` precisa do enum dela — usar
   * os numeros crus funcionava e envelheceria mal, calado, se a lib mudasse os valores.
   *
   * Fica dentro de um try: ela ja faltou no pacote uma vez (o `.vscodeignore` levava o
   * `node_modules` inteiro), e a excecao subia para um `void registrarLsp(...)` virando
   * rejeicao nao tratada — a extensao ativava e o Code Insight nao existia.
   */
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let lc: typeof import('vscode-languageclient/node');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    lc = require('vscode-languageclient/node');
  } catch (err) {
    canal.appendLine(`vscode-languageclient não carregou: ${String(err)}`);
    mostrarEstado('Code Insight: indisponível', true, 'a biblioteca do LSP não veio no pacote');
    return;
  }

  const servidor: ServerOptions = {
    run: { command: exe, args: ['-LogModes', '0', '-LSPLogging', pasta] },
    debug: { command: exe, args: ['-LogModes', '248', '-LSPLogging', pasta] },
  };
  const opcoes: LanguageClientOptions = {
    documentSelector: [{ pattern: '**/*.{pas,dpr,dpk,inc}' }],
    // Never: o canal do servidor não deve roubar o foco a cada diagnóstico
    revealOutputChannelOn: 0,
    /*
     * O `DelphiLSP.exe` cai sozinho. Já apareceu no log dele:
     *
     *   <Agent1> TDelphiLSPDiagnosticsProcessor.PublishDiagnosticsForFile EAccessViolation
     *   <Agent1> Kernel exception detected!
     *
     * É defeito do binário da Embarcadero e não há o que corrigir daqui. O que dá para fazer
     * é não deixar o processo morto: continuar depois de um erro de pedido, e reiniciar
     * algumas vezes se ele fechar. Sem limite viraria um laço de reinício com o servidor
     * quebrado; 4 tentativas cobrem a queda ocasional sem esconder a quebra permanente.
     */
    errorHandler: {
      error: (erro, _msg, contagem) => {
        canal.appendLine(`erro do servidor (${contagem ?? 1}): ${String(erro).slice(0, 200)}`);
        return { action: lc.ErrorAction.Continue };
      },
      closed: () => {
        fechou += 1;
        canal.appendLine(`o servidor fechou (${fechou})`);
        if (fechou > 4) {
          mostrarEstado('Code Insight: caiu', true,
            'O DelphiLSP fechou várias vezes. Clique para tentar de novo.');
          return { action: lc.CloseAction.DoNotRestart };
        }
        return { action: lc.CloseAction.Restart };
      },
    },
    /*
     * `controller` reserva um processo só para o Error Insight e outro para o resto. Com um
     * agente só, digitar rápido faz o diagnóstico e o completar disputarem a mesma fila.
     */
    initializationOptions: { serverType: 'controller', agentCount: 2 },
    /*
     * O servidor erra, e o erro dele não pode virar erro na cara do usuário.
     *
     * `textDocument/definition` já devolveu `-32603 Internal server error` num Ctrl+clique
     * comum de unit no `uses`. Sem isto, o cliente escreve "Request failed" no canal e o
     * usuário fica sem navegação nenhuma — porque o `pascalNav` se cala enquanto o servidor
     * está no ar. Aqui o erro vira log e a resposta cai no índice próprio.
     */
    middleware: {
      provideDefinition: async (doc, pos, token, next) => {
        try {
          return await next(doc, pos, token);
        } catch (err) {
          canal.appendLine(`definition falhou no servidor (${String(err).slice(0, 120)}) ` +
            '— caindo no índice próprio');
          return resolverDefinicao(doc, pos, registry());
        }
      },
      provideCompletionItem: async (doc, pos, ctxCompl, token, next) => {
        try {
          return await next(doc, pos, ctxCompl, token);
        } catch (err) {
          canal.appendLine(`completion falhou no servidor: ${String(err).slice(0, 120)}`);
          return undefined;
        }
      },
      provideHover: async (doc, pos, token, next) => {
        try {
          return await next(doc, pos, token);
        } catch (err) {
          canal.appendLine(`hover falhou no servidor: ${String(err).slice(0, 120)}`);
          return undefined;
        }
      },
    },
  };

  try {
    cliente = new lc.LanguageClient(
      'delphi4vscode.lsp', 'Delphi Code Insight', servidor, opcoes) as LanguageClient;
    ctx.subscriptions.push(cliente);
    await cliente.start();
  } catch (err) {
    canal.appendLine(`o DelphiLSP não subiu: ${String(err)}`);
    cliente = undefined;
    mostrarEstado('Code Insight: falhou', true, String(err).slice(0, 200));
    /*
     * Avisa em vez de degradar calado: sem isto o usuario continua vendo o completar
     * heuristico e acha que o Code Insight do compilador e aquilo.
     */
    void vscode.window.showWarningMessage(
      'Delphi4VSCode: o Code Insight do compilador não subiu. ' +
      'O completar caiu no índice próprio.', 'Ver o log')
      .then(a => { if (a) { canal.show(); } });
    return;
  }
  marcarLsp(true);
  canal.appendLine(`DelphiLSP no ar: ${exe}`);

  apontar = async (): Promise<void> => {
    const p = await build.garantirProjeto(true);
    if (!cliente || !p) {
      marcarProjeto(false);
      mostrarEstado('Code Insight: sem projeto', true,
        'Escolha o .dproj ativo para o completar funcionar');
      return;
    }
    mostrarEstado(`Code Insight: ${p.nome}`, false,
      `DelphiLSP apontado para ${p.fsPath}
Clique para recarregar`);
    /*
     * A plataforma e a configuração vêm do BuildManager a cada chamada, não de um `cfg`
     * capturado lá em cima: `getConfiguration()` devolve um retrato, e o retrato tirado na
     * ativação continua dizendo Win32 depois que o usuário trocou para Win64 — com o
     * servidor completando contra as DCUs erradas e nada na tela dizendo isso.
     */
    const { config, plataforma } = build.alvoAtual;
    await apontarProjeto(cliente, p.fsPath, bdsBin, versao, plataforma, config, canal);
  };
  /*
   * Sem projeto o servidor não resolve nada. Resolver um aqui é o que faz o Code Insight
   * funcionar de primeira em vez de exigir que o usuário descubra sozinho que faltava isso.
   */
  const p = await build.garantirProjeto(false);
  if (p) {
    await apontar();
    mostrarEstado(`Code Insight: ${p.nome}`, false,
      `DelphiLSP apontado para ${p.fsPath}
Clique para recarregar`);
  } else {
    mostrarEstado('Code Insight: sem projeto', true,
      'Escolha o .dproj ativo para o completar funcionar');
    canal.appendLine('servidor no ar, sem projeto ativo — o completar não vai responder');
    void vscode.window.showWarningMessage(
      'Delphi4VSCode: escolha o projeto ativo para o Code Insight funcionar.',
      'Escolher projeto')
      .then(a => {
        if (a) { void vscode.commands.executeCommand('delphi4vscode.selecionarProjeto'); }
      });
  }

  ctx.subscriptions.push(
    /*
     * O `.dproj` muda quando alguém acrescenta uma unit ou mexe no search path — e aí o
     * servidor está trabalhando com o projeto antigo, sem nenhum sinal visível disso.
     */
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (/\.dpr(oj)?$/i.test(doc.uri.fsPath)) { void apontar(); }
    }),
    // trocar de projeto, de configuração ou de plataforma tem o mesmo efeito
    build.onMudou(() => { if (build.projeto) { void apontar(); } }),
  );
}

export async function pararLsp(): Promise<void> {
  marcarLsp(false);
  if (cliente) { await cliente.stop(); cliente = undefined; }
}
