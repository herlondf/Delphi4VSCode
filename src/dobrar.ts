/** Registro do dobramento de Object Pascal no VS Code. A lógica está em `dfm/dobras`. */

import * as vscode from 'vscode';
import { dobras } from './dfm/dobras';

class DobrasPascal implements vscode.FoldingRangeProvider {
  provideFoldingRanges(doc: vscode.TextDocument): vscode.FoldingRange[] {
    const tipo = {
      comentario: vscode.FoldingRangeKind.Comment,
      regiao: vscode.FoldingRangeKind.Region,
    };
    return dobras(doc.getText().split(/\r?\n/))
      .map(d => new vscode.FoldingRange(d.inicio, d.fim, d.tipo && tipo[d.tipo]));
  }
}

export function registrarDobras(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(vscode.languages.registerFoldingRangeProvider(
    [{ language: 'pascal' }, { pattern: '**/*.{pas,dpr,dpk,inc}' }], new DobrasPascal()));
}
