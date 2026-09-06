/**
 * Os dois atalhos que mais economizam ida à IDE na hora de escrever código.
 *
 * `Ctrl+Shift+C` gera o corpo do método que acabei de declarar. E o quick fix do
 * `E2003 Undeclared identifier` acrescenta ao `uses` a unit que declara o símbolo — o índice
 * de classes já sabe onde cada uma mora, e é o erro mais comum de quem escreve Delphi fora
 * da IDE, onde não existe o "Add unit to uses" do Error Insight.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { Registry } from './dfm/registry';
import { completarClasse } from './dfm/classcomp';
import { parsePascal } from './dfm/pascal';

const EH_PASCAL = /\.(pas|dpr|dpk|inc)$/i;

async function classCompletion(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !EH_PASCAL.test(editor.document.uri.fsPath)) {
    vscode.window.showWarningMessage('Abra o .pas onde quer completar a classe.');
    return;
  }
  const doc = editor.document;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const r = completarClasse(doc.getText(), eol);
  if (!r) {
    vscode.window.showInformationMessage(
      'Nenhum método declarado está sem corpo nesta unit.');
    return;
  }
  await editor.edit(e => e.insert(new vscode.Position(r.linha, 0), r.texto));
  /*
   * Leva o cursor para o primeiro corpo gerado. Sem isto o método aparece no fim do arquivo,
   * fora da vista, e o próximo passo do usuário é procurá-lo com Ctrl+F.
   */
  const destino = new vscode.Position(r.linha + 3, 0);
  editor.selection = new vscode.Selection(destino, destino);
  editor.revealRange(new vscode.Range(destino, destino),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  vscode.window.showInformationMessage(
    `${r.metodos.length} corpo(s) gerado(s): ${r.metodos.slice(0, 3).join(', ')}` +
    (r.metodos.length > 3 ? '…' : ''));
}

/** A unit Pascal que declara um símbolo, pelo índice. */
function unitQueDeclara(reg: Registry, simbolo: string): string | undefined {
  const pascal = reg.unitPascalDe(simbolo);
  if (pascal) { return pascal; }
  const arquivo = reg.unitOf(simbolo);
  return arquivo ? path.basename(arquivo).replace(/\.pas$/i, '') : undefined;
}

/**
 * Onde entra a unit nova.
 *
 * No `uses` da `implementation` quando existe, senão no da `interface`. É a ordem certa por
 * um motivo prático: pôr tudo na `interface` cria dependência circular entre units que só se
 * usam por dentro, e circular no Delphi é erro de compilação, não aviso.
 */
function alvoDoUses(doc: vscode.TextDocument): { linha: number; texto: string } | undefined {
  const linhas = doc.getText().split(/\r?\n/);
  const impl = linhas.findIndex(l => /^\s*implementation\b/i.test(l));
  const procurarUses = (de: number, ate: number): number => {
    for (let i = de; i < ate && i < linhas.length; i++) {
      if (/^\s*uses\b/i.test(linhas[i])) { return i; }
    }
    return -1;
  };
  const inicio = impl >= 0 ? procurarUses(impl, linhas.length) : -1;
  const usesLinha = inicio >= 0 ? inicio : procurarUses(0, impl >= 0 ? impl : linhas.length);
  if (usesLinha < 0) {
    // não há `uses`: cria um logo depois do `implementation`
    if (impl < 0) { return undefined; }
    return { linha: impl + 1, texto: 'NOVO' };
  }
  for (let i = usesLinha; i < linhas.length; i++) {
    if (linhas[i].includes(';')) { return { linha: i, texto: linhas[i] }; }
  }
  return undefined;
}

class AdicionarUnit implements vscode.CodeActionProvider {
  constructor(private registry: () => Registry) {}

  static readonly tipos = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    doc: vscode.TextDocument, _range: vscode.Range | vscode.Selection,
    ctx: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const reg = this.registry();
    const acoes: vscode.CodeAction[] = [];
    const jaOferecidas = new Set<string>();

    for (const d of ctx.diagnostics) {
      // o LSP manda o código no `code`; o texto cobre o diagnóstico do índice próprio
      const codigo = String(d.code ?? '');
      if (!/E2003/.test(codigo) && !/Undeclared identifier/i.test(d.message)) { continue; }
      const m = /'([A-Za-z_][\w.]*)'/.exec(d.message);
      if (!m) { continue; }
      const unit = unitQueDeclara(reg, m[1]);
      if (!unit) { continue; }

      const jaTem = parsePascal(doc.getText()).uses
        .some(u => u.nome.toLowerCase() === unit.toLowerCase());
      if (jaTem || jaOferecidas.has(unit.toLowerCase())) { continue; }
      jaOferecidas.add(unit.toLowerCase());

      const alvo = alvoDoUses(doc);
      if (!alvo) { continue; }
      const acao = new vscode.CodeAction(
        `Acrescentar ${unit} ao uses`, vscode.CodeActionKind.QuickFix);
      acao.diagnostics = [d];
      acao.edit = new vscode.WorkspaceEdit();
      if (alvo.texto === 'NOVO') {
        acao.edit.insert(doc.uri, new vscode.Position(alvo.linha, 0),
          `${EOL(doc)}uses${EOL(doc)}  ${unit};${EOL(doc)}`);
      } else {
        // a última entrada termina em `;`: a nova entra antes dele, com a vírgula
        acao.edit.replace(doc.uri, doc.lineAt(alvo.linha).range,
          alvo.texto.replace(/;\s*$/, `,${EOL(doc)}  ${unit};`));
      }
      acoes.push(acao);
    }
    return acoes;
  }
}

function EOL(doc: vscode.TextDocument): string {
  return doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

export function registrarCodigo(
  ctx: vscode.ExtensionContext, registry: () => Registry,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.classCompletion', classCompletion),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'pascal' }, { language: 'objectpascal' },
       { pattern: '**/*.{pas,dpr,dpk,inc}' }],
      new AdicionarUnit(registry),
      { providedCodeActionKinds: AdicionarUnit.tipos }),
  );
}
