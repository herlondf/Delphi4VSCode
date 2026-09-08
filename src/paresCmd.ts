/** O comando de alternar entre declaração e implementação. A lógica está em `dfm/pares`. */

import * as vscode from 'vscode';
import { cabecalhos, cabecalhoEm, par } from './dfm/pares';

async function alternar(): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !/[.](pas|dpr|inc)$/i.test(ed.document.fileName)) {
    vscode.window.showInformationMessage('abra um arquivo Pascal para alternar.');
    return;
  }
  const linhas = ed.document.getText().split(/\r?\n/);
  const lista = cabecalhos(linhas);
  const atual = cabecalhoEm(lista, ed.selection.active.line);
  if (!atual) {
    vscode.window.showInformationMessage('o cursor não está dentro de um método.');
    return;
  }
  const destino = par(lista, atual);
  if (!destino) {
    vscode.window.showInformationMessage(
      `${atual.nome}: só existe ${atual.classe ? 'o corpo' : 'a declaração'} nesta unit.`);
    return;
  }
  const pos = new vscode.Position(destino.linha, destino.coluna);
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function registrarPares(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.alternarDeclaracao', alternar));
}
