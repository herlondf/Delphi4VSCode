/**
 * Problemas do form no painel Problems do VS Code.
 *
 * Tudo aqui sai da árvore já parseada — nenhuma checagem exige compilar nada.
 */

import * as vscode from 'vscode';
import { DfmDocument } from './dfm/document';
import { Registry } from './dfm/registry';
import { DfmNode, num, txt } from './dfm/model';
import { place, visualKids } from './dfm/layout';

/*
 * C04 — propriedades que o .dfm grava e que nenhuma classe declara com `property`.
 *
 * Saem do próprio mecanismo de streaming (`DefineProperties`) ou do designer, e cobrá-las
 * daria aviso em quase todo form. A lista é fechada e foi levantada medindo: sobre os 1.111
 * `.dfm` do projeto de teste mais as fontes da VCL e do DevExpress, com ela o aviso cai
 * a 0,00% dos 8.106 valores verificados nos forms do próprio projeto.
 *
 * `OldCreateOrder` fica de fora de propósito. Ela não existe mais no `TForm` desde o 10.4, e
 * um form que ainda a grava falha ao abrir no Delphi atual — o aviso é o certo, e a correção
 * é apagar a linha.
 */
const PSEUDO_PROPS = new Set([
  'left', 'top', 'width', 'height',
  'explicitleft', 'explicittop', 'explicitwidth', 'explicitheight',
  'designsize', 'taborder', 'pixelsperinch', 'textheight',
  'parentid', 'version', 'rowindex', 'index', 'special', 'dockcontrolheights',
  'clientrectleft', 'clientrecttop', 'clientrectright', 'clientrectbottom',
  'bitmap', 'dockingtype', 'savestrings',
]);

/** Propriedade escrita no .dfm que a classe não conhece: o form falha ao carregar. */
function checarPropriedades(
  doc: DfmDocument, reg: Registry,
  add: (n: DfmNode, msg: string, sev: vscode.DiagnosticSeverity, linha?: number) => void,
): void {
  for (const n of doc.index.values()) {
    if (n.uri !== doc.uri) { continue; }
    if (!reg.indiceConfiavel(n.cls)) { continue; }
    for (const [chave, p] of n.props) {
      if (p.uri !== doc.uri) { continue; }
      const base = chave.split('.')[0];
      if (PSEUDO_PROPS.has(base)) { continue; }
      if (reg.conheceProp(n.cls, base)) { continue; }
      add(n, `${n.cls} não tem a propriedade ${p.label.split('.')[0]}: ` +
        'o form vai falhar ao carregar', vscode.DiagnosticSeverity.Error, p.line);
    }
  }
}

export function validate(
  doc: DfmDocument, reg: Registry, document: vscode.TextDocument,
): vscode.Diagnostic[] {
  const out: vscode.Diagnostic[] = [];
  const add = (
    node: DfmNode, msg: string, sev: vscode.DiagnosticSeverity, linha?: number,
  ) => {
    const alvo = linha ?? node.line;
    if (node.uri !== doc.uri || alvo >= document.lineCount) { return; }
    const line = document.lineAt(alvo);
    const d = new vscode.Diagnostic(line.range, msg, sev);
    d.source = 'dfm';
    out.push(d);
  };

  // nome é único por owner, não globalmente: quatro instâncias do mesmo frame trazem
  // quatro homônimos legítimos. Só conta o que este .dfm declara.
  const porNome = new Map<string, DfmNode[]>();
  for (const n of doc.index.values()) {
    if (n.name && n.uri === doc.uri) {
      const lista = porNome.get(n.name) ?? [];
      lista.push(n);
      porNome.set(n.name, lista);
    }
  }
  for (const [nome, nodes] of porNome) {
    if (nodes.length > 1) {
      for (const n of nodes) {
        add(n, `${nodes.length} componentes chamados ${nome} neste form`,
          vscode.DiagnosticSeverity.Warning);
      }
    }
  }

  const check = (node: DfmNode, cw: number, ch: number): void => {
    const kids = visualKids(node, reg);
    const rects = place(kids, cw, ch, reg, 12, node);
    const tabs = new Map<number, string[]>();
    for (const k of kids) {
      const r = rects.get(k)!;
      if (r.w <= 0 || r.h <= 0) {
        add(k, `${k.name} tem tamanho ${r.w}x${r.h}`, vscode.DiagnosticSeverity.Error);
      } else if (
        (r.x < 0 || r.y < 0 || (cw && r.x + r.w > cw) || (ch && r.y + r.h > ch))
        // com Anchors o designer conta com o reposicionamento em runtime: extrapolar
        // ali é intencional, não defeito
        && !k.props.has('anchors') && !k.props.has('align')
      ) {
        add(k, `${k.name} em ${r.x},${r.y} ${r.w}x${r.h} não cabe no pai (${cw}x${ch})`,
          vscode.DiagnosticSeverity.Warning);
      }
      if (k.props.has('taborder')) {
        const t = num(k, 'taborder');
        tabs.set(t, [...(tabs.get(t) ?? []), k.name]);
      }
      check(k, r.w, r.h);
    }
    for (const [ordem, nomes] of tabs) {
      if (nomes.length > 1) {
        add(node, `TabOrder ${ordem} repetido em ${nomes.join(', ')}`,
          vscode.DiagnosticSeverity.Information);
      }
    }
  };
  check(doc.root, num(doc.root, 'clientwidth') || num(doc.root, 'width'),
    num(doc.root, 'clientheight') || num(doc.root, 'height'));

  if (vscode.workspace.getConfiguration('delphi4vscode')
    .get<boolean>('validarPropriedades', true)) {
    checarPropriedades(doc, reg, add);
  }
  return out;
}

/** Componentes na barra de navegação e no Ctrl+Shift+O. */
export class DfmSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private registry: () => Registry) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    let doc: DfmDocument;
    try {
      doc = new DfmDocument(document.uri.fsPath, document.getText(), this.registry());
    } catch {
      return [];
    }
    const reg = this.registry();
    const build = (n: DfmNode): vscode.DocumentSymbol | null => {
      if (n.uri !== doc.uri || n.line >= document.lineCount) { return null; }
      const fim = Math.min(n.endLine, document.lineCount - 1);
      const range = new vscode.Range(
        new vscode.Position(n.line, 0), document.lineAt(fim).range.end);
      const sym = new vscode.DocumentSymbol(
        n.name || n.cls, n.cls,
        reg.isVisual(n) ? vscode.SymbolKind.Object : vscode.SymbolKind.Field,
        range, document.lineAt(n.line).range,
      );
      sym.children = n.kids.map(build).filter((s): s is vscode.DocumentSymbol => !!s);
      return sym;
    };
    const root = build(doc.root);
    return root ? [root] : [];
  }
}

export { txt };
