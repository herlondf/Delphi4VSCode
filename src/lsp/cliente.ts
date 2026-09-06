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
import { marcarLsp } from './estado';
import { BuildManager } from '../build';

/*
 * `vscode-languageclient` só carrega dentro do VS Code — ele estende classes do módulo
 * `vscode`. Importar no topo faria a extensão inteira depender disso para ser sequer
 * carregada, e é por isso que aqui é `import type` mais um `require` lá dentro.
 */
let cliente: LanguageClient | undefined;

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
}

export async function registrarLsp(
  ctx: vscode.ExtensionContext, build: BuildManager, canal: vscode.OutputChannel,
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

  const cfg = vscode.workspace.getConfiguration('delphi4vscode');
  if (cfg.get<boolean>('lsp.enabled', true) === false) {
    canal.appendLine('LSP desligado por configuração (delphi4vscode.lsp.enabled).');
    return;
  }

  const bdsBin = cfg.get<string>('bdsBinPath', '');
  const exe = bdsBin ? exeDoLsp(bdsBin) : undefined;
  if (!exe) {
    canal.appendLine(bdsBin
      ? `sem DelphiLSP.exe em ${bdsBin} — Code Insight fica no índice próprio`
      : 'sem instalação do Delphi escolhida — rode "Delphi: compilar" uma vez');
    return;
  }

  const versao = /(\d+\.\d+)/.exec(bdsBin)?.[1] ?? '';
  const pasta = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const servidor: ServerOptions = {
    run: { command: exe, args: ['-LogModes', '0', '-LSPLogging', pasta] },
    debug: { command: exe, args: ['-LogModes', '248', '-LSPLogging', pasta] },
  };
  const opcoes: LanguageClientOptions = {
    documentSelector: [{ pattern: '**/*.{pas,dpr,dpk,inc}' }],
    // Never: o canal do servidor não deve roubar o foco a cada diagnóstico
    revealOutputChannelOn: 0,
    /*
     * `controller` reserva um processo só para o Error Insight e outro para o resto. Com um
     * agente só, digitar rápido faz o diagnóstico e o completar disputarem a mesma fila.
     */
    initializationOptions: { serverType: 'controller', agentCount: 2 },
  };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lc = require('vscode-languageclient/node');
  cliente = new lc.LanguageClient(
    'delphi4vscode.lsp', 'Delphi Code Insight', servidor, opcoes) as LanguageClient;
  ctx.subscriptions.push(cliente);
  try {
    await cliente.start();
  } catch (err) {
    canal.appendLine(`o DelphiLSP não subiu: ${String(err)}`);
    cliente = undefined;
    return;
  }
  marcarLsp(true);
  canal.appendLine(`DelphiLSP no ar: ${exe}`);

  apontar = async (): Promise<void> => {
    const p = build.projeto;
    if (!cliente || !p) {
      vscode.window.showWarningMessage('Escolha o projeto ativo (.dproj) primeiro.');
      return;
    }
    await apontarProjeto(cliente, p.fsPath, bdsBin, versao,
      cfg.get<string>('buildPlatform', 'Win32'),
      cfg.get<string>('buildConfig', 'Debug'), canal);
  };
  if (build.projeto) { await apontar(); }

  ctx.subscriptions.push(
    /*
     * O `.dproj` muda quando alguém acrescenta uma unit ou mexe no search path — e aí o
     * servidor está trabalhando com o projeto antigo, sem nenhum sinal visível disso.
     */
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (/\.dpr(oj)?$/i.test(doc.uri.fsPath)) { void apontar(); }
    }),
  );
}

export async function pararLsp(): Promise<void> {
  marcarLsp(false);
  if (cliente) { await cliente.stop(); cliente = undefined; }
}
