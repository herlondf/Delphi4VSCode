/** Comando de depurar. A lógica e o porquê do caminho estão em `dfm/depurar`. */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildManager } from './build';
import { exeDoProjeto } from './dfm/projeto';
import {
  MAP_DETALHADO, Artefatos, artefatos, argumentosMap2pdb, candidatosMap2pdb,
  configDeLancamento, estadoDoPdb,
} from './dfm/depurar';

const EXTENSAO_CPP = 'ms-vscode.cpptools';

function conversor(): string | undefined {
  const cfg = vscode.workspace.getConfiguration('delphi4vscode');
  const posto = cfg.get<string>('debug.map2pdb', '').trim();
  if (posto) { return fs.existsSync(posto) ? posto : undefined; }
  const raizes = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  return candidatosMap2pdb(raizes).find(c => fs.existsSync(c));
}

async function pedirConversor(): Promise<void> {
  const acao = await vscode.window.showErrorMessage(
    'Falta o conversor de símbolos. O Delphi não gera PDB, e é o PDB que qualquer depurador ' +
    'do Windows lê. O map2pdb (Anders Melander, código aberto) converte o .map detalhado; ' +
    'ele é escrito em Delphi, então compila com o compilador que você já tem.',
    'Abrir o projeto do map2pdb', 'Apontar o executável');
  if (acao === 'Abrir o projeto do map2pdb') {
    await vscode.env.openExternal(vscode.Uri.parse('https://github.com/andersmelander/map2pdb'));
  } else if (acao === 'Apontar o executável') {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings', 'delphi4vscode.debug.map2pdb');
  }
}

function converter(exe: string, a: Artefatos, canal: vscode.OutputChannel): boolean {
  const conv = conversor();
  if (!conv) { void pedirConversor(); return false; }
  canal.appendLine(`map2pdb: ${conv} ${argumentosMap2pdb(a.map).join(' ')}`);
  const r = cp.spawnSync(conv, argumentosMap2pdb(a.map), { encoding: 'utf8' });
  if (r.stdout) { canal.appendLine(r.stdout.trim()); }
  if (r.stderr) { canal.appendLine(r.stderr.trim()); }
  if (r.status !== 0 || !fs.existsSync(a.pdb)) {
    canal.show(true);
    vscode.window.showErrorMessage(
      `O map2pdb não gerou ${path.basename(a.pdb)}. O log está no canal Delphi.`);
    return false;
  }
  return true;
}

async function depurar(build: BuildManager, canal: vscode.OutputChannel): Promise<void> {
  const p = await build.garantirProjeto(true);
  if (!p) { return; }

  if (!vscode.extensions.getExtension(EXTENSAO_CPP)) {
    const acao = await vscode.window.showErrorMessage(
      'A depuração usa o motor cppvsdbg, que vem na extensão C/C++ da Microsoft. ' +
      'Ela é só o depurador — o Code Insight continua sendo o do Delphi.',
      'Instalar');
    if (acao) {
      await vscode.commands.executeCommand('workbench.extensions.installExtension', EXTENSAO_CPP);
    }
    return;
  }

  /*
   * O map detalhado é pedido na linha de comando, não gravado no `.dproj` do usuário. Um
   * `/p:DCC_MapFile=3` vale para esta compilação e não deixa rastro no projeto dele.
   */
  build.extras = { ...MAP_DETALHADO };
  try {
    await build.executar('Make');
  } finally {
    build.extras = {};
  }

  const exe = exeDoProjeto(p.fsPath);
  if (!exe) {
    vscode.window.showWarningMessage('Não achei o executável depois de compilar.');
    return;
  }
  const a = artefatos(exe);
  const estado = estadoDoPdb(a);
  canal.appendLine(`depuração: ${estado.motivo}`);
  if (!estado.converter && !fs.existsSync(a.pdb)) {
    vscode.window.showWarningMessage(`Sem símbolos: ${estado.motivo}.`);
    return;
  }
  if (estado.converter && !converter(exe, a, canal)) { return; }

  const pasta = vscode.workspace.workspaceFolders?.[0];
  const ok = await vscode.debug.startDebugging(
    pasta, configDeLancamento({ exe, nome: `Delphi: ${path.basename(exe)}` }) as never);
  if (!ok) { vscode.window.showErrorMessage('O VS Code não aceitou a sessão de depuração.'); }
}

export function registrarDepurar(
  ctx: vscode.ExtensionContext, build: BuildManager, canal: vscode.OutputChannel,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.depurar', () => depurar(build, canal)));
}
