/**
 * Edição de valores que ocupam várias linhas: listas de strings e coleções.
 *
 * `Prop.line` é a primeira linha e `raw` guarda todas, então o pedaço a trocar é sempre
 * `[line, line + raw.split(quebra).length)`. Coleção herdada de frame ou ancestral não se
 * edita aqui: reescrever o bloco inteiro no descendente muda o significado do que o Delphi
 * gravou lá, e é assim que se apaga a coluna de um grid sem perceber.
 */

import { DfmNode, Prop, propKind } from './model';
import { DfmDocument } from './document';
import { EditError, TextChange } from './edit';

const NL = String.fromCharCode(10);

function citar(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

function alvoBloco(
  doc: DfmDocument, node: DfmNode, key: string, scope: 'control' | 'item',
): { alvo: DfmNode; prop: Prop } {
  const alvo = scope === 'item' ? doc.byControl.get(node) : node;
  if (!alvo) { throw new EditError('componente não tem TdxLayoutItem'); }
  const prop = alvo.props.get(key);
  if (!prop) { throw new EditError(`${key} não existe neste componente`); }
  if (prop.uri !== doc.uri) {
    throw new EditError(`${prop.label} vem de ${prop.uri.split(/[\\/]/).pop()}: ` +
      'blocos herdados só se editam no arquivo de origem');
  }
  return { alvo, prop };
}

function span(prop: Prop): number {
  return prop.raw.split(NL).length;
}

/** I05 — reescreve `Lines.Strings = (...)` com o conteúdo novo. */
export function setStringsProp(
  doc: DfmDocument, node: DfmNode, key: string, linhas: string[], scope: 'control' | 'item',
): TextChange[] {
  const { alvo, prop } = alvoBloco(doc, node, key, scope);
  if (propKind(prop.raw) !== 'block' || prop.raw.trim()[0] !== '(') {
    throw new EditError(`${prop.label} não é uma lista de strings`);
  }
  const pad = ' '.repeat(alvo.indent + 2);
  const dentro = pad + '  ';
  const corpo = linhas.length
    ? '(' + NL + linhas.map((l, i) =>
        dentro + citar(l) + (i === linhas.length - 1 ? ')' : '')).join(NL)
    : '()';
  return [{
    line: prop.line, kind: 'replace', count: span(prop),
    text: `${pad}${prop.label} = ${corpo}`,
  }];
}

export interface LinhaItem {
  texto: string;
  /** Profundidade dentro do item, para reindentar sem perder o aninhamento. */
  nivel: number;
}

/** Quebra `<item ... end item ... end>` nos itens, guardando o aninhamento de cada linha. */
export function itensDaColecao(raw: string): LinhaItem[][] {
  const out: LinhaItem[][] = [];
  let atual: LinhaItem[] | null = null;
  let nivel = 0;
  for (const bruta of raw.split(NL)) {
    const l = bruta.trim();
    if (!l) { continue; }
    if (!atual) {
      if (/^item$/i.test(l)) { atual = []; nivel = 1; }
      continue;
    }
    if (/^end>?$/i.test(l)) {
      nivel--;
      if (nivel === 0) { out.push(atual); atual = null; }
      else { atual.push({ texto: 'end', nivel: nivel - 1 }); }
      continue;
    }
    atual.push({ texto: l, nivel: nivel - 1 });
    if (/^(object|inherited|inline|item)\b/i.test(l)) { nivel++; }
  }
  return out;
}

/** Descrição curta de um item, para a lista do editor de coleção. */
const CHAVES_ITEM = ['caption', 'fieldname', 'name', 'text', 'displayname', 'header'];

export function descreverItem(item: LinhaItem[]): string {
  const props = new Map<string, string>();
  for (const l of item) {
    if (l.nivel !== 0) { continue; }
    const m = /^([\w.]+)\s*=\s*(.*)$/.exec(l.texto);
    if (m) { props.set(m[1].toLowerCase(), m[2]); }
  }
  for (const k of CHAVES_ITEM) {
    const v = props.get(k);
    if (v !== undefined) {
      const limpo = v.replace(/^'|'$/g, '').replace(/''/g, "'");
      return limpo || `(${k} vazio)`;
    }
  }
  const primeira = item.find(l => l.texto.includes('='));
  return primeira ? primeira.texto.slice(0, 48) : '(item vazio)';
}

export function escreverColecao(itens: LinhaItem[][], indent: number, label: string): string {
  const pad = ' '.repeat(indent + 2);
  if (!itens.length) { return `${pad}${label} = <>`; }
  const blocos = itens.map((item, i) => [
    pad + '  item',
    ...item.map(l => pad + '    ' + '  '.repeat(l.nivel) + l.texto),
    // o `end` do último item é quem fecha a coleção
    pad + '  end' + (i === itens.length - 1 ? '>' : ''),
  ].join(NL));
  return `${pad}${label} = <` + NL + blocos.join(NL);
}

/**
 * I06 — grava a coleção na ordem pedida, com os itens que sobraram.
 *
 * `ordem` são índices na coleção atual: reordenar é permutar, apagar é omitir, e duplicar é
 * repetir o índice. Um único caminho de escrita cobre as três operações.
 */
export function setCollectionProp(
  doc: DfmDocument, node: DfmNode, key: string, ordem: number[], scope: 'control' | 'item',
): TextChange[] {
  const { alvo, prop } = alvoBloco(doc, node, key, scope);
  if (propKind(prop.raw) !== 'block' || prop.raw.trim()[0] !== '<') {
    throw new EditError(`${prop.label} não é uma coleção`);
  }
  const itens = itensDaColecao(prop.raw);
  const novos = ordem.map(i => itens[i]).filter(Boolean);
  if (!novos.length && itens.length) {
    throw new EditError('coleção vazia apagaria a definição inteira: remova um item por vez');
  }
  return [{
    line: prop.line, kind: 'replace', count: span(prop),
    text: escreverColecao(novos, alvo.indent, prop.label),
  }];
}

/** Troca uma propriedade escalar de um item da coleção, sem mexer nos demais. */
export function setCollectionItemProp(
  doc: DfmDocument, node: DfmNode, key: string, indice: number,
  propLabel: string, valorCru: string, scope: 'control' | 'item',
): TextChange[] {
  const { alvo, prop } = alvoBloco(doc, node, key, scope);
  const itens = itensDaColecao(prop.raw);
  const item = itens[indice];
  if (!item) { throw new EditError(`a coleção não tem item ${indice}`); }
  const alvoLinha = item.findIndex(l =>
    l.nivel === 0 && new RegExp(`^${propLabel}\\s*=`, 'i').test(l.texto));
  const nova = `${propLabel} = ${valorCru}`;
  if (alvoLinha >= 0) { item[alvoLinha] = { texto: nova, nivel: 0 }; }
  else { item.unshift({ texto: nova, nivel: 0 }); }
  return [{
    line: prop.line, kind: 'replace', count: span(prop),
    text: escreverColecao(itens, alvo.indent, prop.label),
  }];
}
