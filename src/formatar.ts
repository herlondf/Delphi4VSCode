/**
 * O formatador ligado ao VS Code. A lógica está em `dfm/formatador.ts`, sem dependência do
 * editor — é o que permite testá-la rodando o binário de verdade.
 */

import * as vscode from 'vscode';
import { formatarTexto, exeDoFormatador } from './dfm/formatador';

class FormatadorPascal implements vscode.DocumentFormattingEditProvider {
  constructor(private canal: vscode.OutputChannel) {}

  async provideDocumentFormattingEdits(
    doc: vscode.TextDocument,
  ): Promise<vscode.TextEdit[]> {
    const bdsBin = vscode.workspace.getConfiguration('delphi4vscode')
      .get<string>('bdsBinPath', '');
    const exe = bdsBin ? exeDoFormatador(bdsBin) : undefined;
    if (!exe) {
      this.canal.appendLine(bdsBin
        ? `sem Formatter.exe em ${bdsBin}`
        : 'sem instalação do Delphi escolhida: formatação indisponível');
      return [];
    }
    let saida: string | undefined;
    try {
      saida = await formatarTexto(doc.getText(), exe);
    } catch (err) {
      /*
       * O formatador sai com código != 0 quando o arquivo não compila até o ponto de parsear.
       * Devolver o texto meio formatado seria pior que não formatar: falha calada aqui, com o
       * motivo no canal.
       */
      this.canal.appendLine(`Formatter.exe falhou: ${String(err)}`);
      return [];
    }
    if (saida === undefined) { return []; }
    const tudo = new vscode.Range(
      doc.positionAt(0), doc.positionAt(doc.getText().length));
    return [vscode.TextEdit.replace(tudo, saida)];
  }
}

export function registrarFormatador(
  ctx: vscode.ExtensionContext, canal: vscode.OutputChannel,
): void {
  ctx.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      [{ language: 'pascal' }, { language: 'objectpascal' },
       { pattern: '**/*.{pas,dpr,dpk,inc}' }],
      new FormatadorPascal(canal)),
  );
}
