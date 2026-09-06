/**
 * Diagnósticos de Object Pascal, do que dá para saber sem compilar.
 *
 * O valor está no cruzamento com o `.dfm` irmão: um componente que existe no form mas não
 * na classe, ou um `OnClick` que aponta para um método inexistente, compila sem reclamação
 * e derruba a aplicação quando a tela abre. É o erro mais caro e o mais fácil de evitar.
 */

import * as fs from 'fs';
import * as vscode from 'vscode';
import { parsePascal, crossCheck, CrossIssue } from './dfm/pascal';
import { parseDfm } from './dfm/parser';
import { readDfmText } from './dfm/document';
import { DfmNode, walk, txt } from './dfm/model';

const SEV: Record<CrossIssue['severidade'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** Componentes e handlers declarados no .dfm irmão, com a linha de cada um. */
function ladoDoForm(dfmPath: string): {
  componentes: { nome: string; cls: string; linha: number }[];
  handlers: { nome: string; linha: number; prop: string }[];
} {
  const componentes: { nome: string; cls: string; linha: number }[] = [];
  const handlers: { nome: string; linha: number; prop: string }[] = [];
  let root: DfmNode | null = null;
  try {
    root = parseDfm(readDfmText(dfmPath).text, dfmPath);
  } catch {
    return { componentes, handlers };
  }
  if (!root) { return { componentes, handlers }; }
  for (const n of walk(root)) {
    if (n !== root && n.name) { componentes.push({ nome: n.name, cls: n.cls, linha: n.line }); }
    for (const [chave, p] of n.props) {
      // OnClick, OnChange, BeforePost... tudo que começa com On/Before/After é handler
      if (!/^(on|before|after)[a-z]/.test(chave)) { continue; }
      const alvo = txt(n, chave);
      if (alvo && /^[A-Za-z_]\w*$/.test(alvo)) {
        handlers.push({ nome: alvo, linha: p.line, prop: p.label });
      }
    }
  }
  return { componentes, handlers };
}

export class PascalDiagnostics {
  private colecao = vscode.languages.createDiagnosticCollection('pascal');
  private timer: NodeJS.Timeout | undefined;

  constructor(ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(
      this.colecao,
      vscode.workspace.onDidOpenTextDocument(d => this.agendar(d)),
      vscode.workspace.onDidChangeTextDocument(e => this.agendar(e.document)),
      vscode.workspace.onDidCloseTextDocument(d => this.colecao.delete(d.uri)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('delphi4vscode.validatePascal')) { this.revisarTodos(); }
      }),
    );
    this.revisarTodos();
  }

  private revisarTodos(): void {
    for (const d of vscode.workspace.textDocuments) { this.agendar(d); }
  }

  private agendar(doc: vscode.TextDocument): void {
    if (doc.languageId !== 'pascal' && !doc.fileName.toLowerCase().endsWith('.pas')) { return; }
    if (this.timer) { clearTimeout(this.timer); }
    this.timer = setTimeout(() => this.revisar(doc), 400);
  }

  private revisar(doc: vscode.TextDocument): void {
    if (!vscode.workspace.getConfiguration('delphi4vscode').get<boolean>('validatePascal', true)) {
      this.colecao.delete(doc.uri);
      return;
    }
    const unit = parsePascal(doc.getText());
    const dfmPath = doc.uri.fsPath.replace(/\.pas$/i, '.dfm');
    const temForm = fs.existsSync(dfmPath);

    const lado = temForm ? ladoDoForm(dfmPath)
      : { componentes: [], handlers: [] };
    // sem .dfm ao lado, não há o que cruzar: só as checagens internas da unit
    const issues = crossCheck(unit, lado.componentes, lado.handlers);

    const noPas: vscode.Diagnostic[] = [];
    const noDfm: vscode.Diagnostic[] = [];
    for (const i of issues) {
      const alvo = i.origem === 'pas' ? noPas : noDfm;
      const linha = Math.min(i.linha, (i.origem === 'pas' ? doc.lineCount : 1e9) - 1);
      const range = i.origem === 'pas'
        ? doc.lineAt(Math.max(0, linha)).range
        : new vscode.Range(i.linha, 0, i.linha, 200);
      const d = new vscode.Diagnostic(range, i.mensagem, SEV[i.severidade]);
      d.source = 'delphi';
      alvo.push(d);
    }

    // nome da unit precisa bater com o nome do arquivo, ou o compilador recusa
    const arquivo = doc.uri.fsPath.split(/[\\/]/).pop()!.replace(/\.pas$/i, '');
    if (unit.nome && unit.nome.split('.').pop()!.toLowerCase() !== arquivo.toLowerCase()) {
      const d = new vscode.Diagnostic(
        doc.lineAt(unit.linhaUnit).range,
        `a unit se chama ${unit.nome} mas o arquivo é ${arquivo}.pas`,
        vscode.DiagnosticSeverity.Error);
      d.source = 'delphi';
      noPas.push(d);
    }

    this.colecao.set(doc.uri, noPas);
    if (temForm && noDfm.length) {
      this.colecao.set(vscode.Uri.file(dfmPath), noDfm);
    } else if (temForm) {
      this.colecao.delete(vscode.Uri.file(dfmPath));
    }
  }
}

export function registrarPascalDiagnostics(ctx: vscode.ExtensionContext): PascalDiagnostics {
  return new PascalDiagnostics(ctx);
}
