/**
 * P10 — editor de menu.
 *
 * Um `TMainMenu` é uma árvore de `TMenuItem` aninhados; mexer nela no texto é onde mais se
 * erra o `end`. O editor devolve a árvore nova e este módulo reescreve o bloco inteiro do
 * componente — preservando linha por linha as propriedades que já existiam (ShortCut,
 * ImageIndex, OnClick), porque perder um `OnClick` num menu é um comando que some sem aviso.
 */

import { DfmNode, txt } from './model';
import { DfmDocument } from './document';
import { EditError, TextChange, novoNome } from './edit';

const NL = String.fromCharCode(10);

export interface ItemMenu {
  /** Caminho do nó original; vazio quando o item foi criado no editor. */
  path: string;
  name: string;
  caption: string;
  separador: boolean;
  kids: ItemMenu[];
}

/** Linhas de propriedade próprias do nó: tudo entre o cabeçalho e o `end`, menos os filhos. */
function linhasProprias(texto: string[], n: DfmNode): string[] {
  const ocupado = new Set<number>();
  for (const k of n.kids) {
    for (let i = k.line; i <= k.endLine; i++) { ocupado.add(i); }
  }
  const out: string[] = [];
  for (let i = n.line + 1; i < n.endLine; i++) {
    if (!ocupado.has(i)) { out.push(texto[i].trim()); }
  }
  return out;
}

export function lerMenu(node: DfmNode): ItemMenu[] {
  const monta = (n: DfmNode): ItemMenu => {
    const cap = txt(n, 'caption', '');
    return {
      path: n.path, name: n.name, caption: cap, separador: cap === '-',
      kids: n.kids.map(monta),
    };
  };
  return node.kids.map(monta);
}

function citar(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/**
 * Reescreve o bloco do menu. `originais` guarda as linhas de cada item que já existia, para
 * que só o Caption seja tocado; item novo nasce com o mínimo.
 */
export function escreverMenu(
  itens: ItemMenu[], indent: number, originais: Map<string, string[]>,
  cabecalho: string,
): string[] {
  const out: string[] = [cabecalho];
  const emitir = (item: ItemMenu, nivel: number): void => {
    const pad = ' '.repeat(indent + 2 * nivel);
    out.push(`${pad}object ${item.name}: TMenuItem`);
    const antigas = originais.get(item.path) ?? [];
    let temCaption = false;
    for (const l of antigas) {
      if (/^caption\s*=/i.test(l)) {
        out.push(`${pad}  Caption = ${citar(item.caption)}`);
        temCaption = true;
      } else {
        out.push(`${pad}  ${l}`);
      }
    }
    if (!temCaption) { out.push(`${pad}  Caption = ${citar(item.caption)}`); }
    for (const k of item.kids) { emitir(k, nivel + 1); }
    out.push(`${pad}end`);
  };
  for (const i of itens) { emitir(i, 0); }
  return out;
}

/** Nomes que o Delphi geraria: `N1`, `N2`, ... para os itens novos. */
function nomearNovos(doc: DfmDocument, itens: ItemMenu[]): void {
  const usados = new Set([...doc.index.values()].map(n => n.name));
  let i = 1;
  const visita = (item: ItemMenu): void => {
    if (!item.name) {
      while (usados.has(`N${i}`)) { i++; }
      item.name = `N${i}`;
      usados.add(item.name);
    }
    item.kids.forEach(visita);
  };
  itens.forEach(visita);
}

export function setMenu(
  doc: DfmDocument, texto: string, node: DfmNode, itens: ItemMenu[],
): TextChange[] {
  if (node.uri !== doc.uri) {
    throw new EditError(`${node.name} vem de ${node.uri.split(/[\\/]/).pop()}: ` +
      'edite o menu no arquivo dele');
  }
  const linhas = texto.split(/\r?\n/);
  const originais = new Map<string, string[]>();
  const coleta = (n: DfmNode): void => {
    originais.set(n.path, linhasProprias(linhas, n));
    n.kids.forEach(coleta);
  };
  node.kids.forEach(coleta);

  nomearNovos(doc, itens);
  const pad = ' '.repeat(node.indent);
  const proprias = linhasProprias(linhas, node).map(l => `${pad}  ${l}`);
  const corpo = escreverMenu(itens, node.indent + 2, originais,
    `${pad}${node.kind} ${node.name}: ${node.cls}`);
  corpo.splice(1, 0, ...proprias);
  corpo.push(`${pad}end`);

  return [{
    line: node.line, kind: 'replace', count: node.endLine - node.line + 1,
    text: corpo.join(NL),
  }];
}

export { novoNome };
