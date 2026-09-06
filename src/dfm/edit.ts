/**
 * Edições no .dfm como operações de texto.
 *
 * Nada aqui escreve em disco: tudo vira `TextEdit` aplicado ao documento aberto. É o que
 * garante Ctrl+Z nativo, o arquivo marcado como sujo na aba e o save nas mãos do usuário —
 * e o que impede uma edição de escapar para o .dfm de um frame ou de um form ancestral.
 */

import { DfmNode, PropKind, formatValue, propKind } from './model';
import { DfmDocument } from './document';
import { padraoDe } from './palette';
import { camposDe } from './fmx';
import { Registry } from './registry';

export interface TextChange {
  /** Linha 0-based. Substituir troca a linha inteira; inserir entra antes desta linha. */
  line: number;
  kind: 'replace' | 'insert' | 'delete';
  /** Texto novo (sem quebra de linha). Para 'delete', o número de linhas a remover. */
  text?: string;
  count?: number;
}

export class EditError extends Error {}

/** Propriedades que o inspetor deixa acrescentar quando ainda não estão no .dfm. */
export const ADDABLE: Record<string, PropKind> = {
  Caption: 'str', Hint: 'str', Left: 'int', Top: 'int', Width: 'int', Height: 'int',
  TabOrder: 'int', Visible: 'bool', Enabled: 'bool', ReadOnly: 'bool',
  Color: 'enum', Align: 'enum',
  // Anchors quase nunca está gravado, e é justamente o que se quer acrescentar quando o
  // form vai mudar de tamanho
  Anchors: 'set',
};

/**
 * Nó onde a propriedade deve ser escrita. Um componente herdado se sobrescreve no bloco
 * `inherited X` do descendente; sem esse bloco, ele é criado — que é o que o Delphi faz.
 */
function targetFor(doc: DfmDocument, node: DfmNode, changes: TextChange[]): DfmNode {
  const direct = doc.writeTarget(node);
  if (direct) { return direct; }
  if (!node.name) {
    throw new EditError(`${node.cls} vem de outro arquivo e não tem nome para sobrescrever`);
  }
  if (!node.parent) { throw new EditError('sem caminho até a raiz deste .dfm'); }

  const pai = targetFor(doc, node.parent, changes);
  const pad = ' '.repeat(pai.indent + 2);
  // o designer grava as propriedades antes dos objetos aninhados
  const at = pai.kids.length ? Math.min(...pai.kids.map(k => k.line)) : pai.endLine;
  changes.push({ line: at, kind: 'insert', text: `${pad}inherited ${node.name}: ${node.cls}` });
  changes.push({ line: at, kind: 'insert', text: `${pad}end` });

  // o bloco recém-criado ainda não existe na árvore; devolvemos um nó espelho para as
  // propriedades caírem dentro dele
  const espelho: DfmNode = {
    ...node, uri: doc.uri, line: at, endLine: at + 1, indent: pai.indent + 2,
    props: new Map(), kids: [], override: null,
  };
  node.override = espelho;
  return espelho;
}

function propLine(target: DfmNode, key: string, label: string, value: string): TextChange {
  const existing = target.props.get(key);
  const pad = ' '.repeat(target.indent + 2);
  const line = `${pad}${existing?.label ?? label} = ${value}`;
  if (existing) { return { line: existing.line, kind: 'replace', text: line }; }
  const at = target.kids.length ? Math.min(...target.kids.map(k => k.line)) : target.endLine;
  return { line: at, kind: 'insert', text: line };
}

export function setProps(
  doc: DfmDocument, node: DfmNode, values: [string, string, string][],
): TextChange[] {
  const changes: TextChange[] = [];
  const target = targetFor(doc, node, changes);
  for (const [key, label, raw] of values) {
    changes.push(propLine(target, key, label, raw));
  }
  return changes;
}

/** Move: sob layout control o Left/Top é recalculado, então não faz sentido gravá-lo. */
export function moveNode(
  doc: DfmDocument, node: DfmNode, left: number, top: number,
): TextChange[] {
  if (doc.byControl.has(node)) {
    throw new EditError('sob TdxLayoutControl a posição vem do layout: use redimensionar, ' +
      'ou arraste sobre um irmão para trocar a ordem');
  }
  const target = doc.writeTarget(node) ?? node;
  const c = camposDe(node);
  const values: [string, string, string][] = [
    [c.left[0], c.left[1], c.formatar(left)], [c.top[0], c.top[1], c.formatar(top)],
  ];
  // o designer mantém Explicit* junto de Left/Top; deixar velho faz o Delphi restaurar
  // a posição antiga no próximo recálculo de align
  if (target.props.has('explicitleft')) { values.push(['explicitleft', 'ExplicitLeft', String(left)]); }
  if (target.props.has('explicittop')) { values.push(['explicittop', 'ExplicitTop', String(top)]); }
  return setProps(doc, node, values);
}

/** Redimensiona: sob layout control o tamanho mora no TdxLayoutItem, não no controle. */
export function resizeNode(
  doc: DfmDocument, node: DfmNode, w: number, h: number,
): TextChange[] {
  const item = doc.byControl.get(node);
  if (item) {
    return setProps(doc, item, [
      ['controloptions.originalwidth', 'ControlOptions.OriginalWidth', String(w)],
      ['controloptions.originalheight', 'ControlOptions.OriginalHeight', String(h)],
    ]);
  }
  const c = camposDe(node);
  return setProps(doc, node, [
    [c.width[0], c.width[1], c.formatar(w)], [c.height[0], c.height[1], c.formatar(h)],
  ]);
}

/** Troca a ordem de dois controles irmãos dentro do mesmo grupo de layout. */
export function reorderNodes(doc: DfmDocument, a: DfmNode, b: DfmNode): TextChange[] {
  const ia = doc.byControl.get(a);
  const ib = doc.byControl.get(b);
  if (!ia || !ib) { throw new EditError('só reordena controles dentro de um TdxLayoutControl'); }
  const pa = ia.props.get('parent')?.raw.trim();
  const pb = ib.props.get('parent')?.raw.trim();
  if (!pa || pa !== pb) { throw new EditError('os dois precisam estar no mesmo grupo de layout'); }
  const na = ia.props.get('index')?.raw.trim() ?? '0';
  const nb = ib.props.get('index')?.raw.trim() ?? '0';
  return [
    ...setProps(doc, ia, [['index', 'Index', nb]]),
    ...setProps(doc, ib, [['index', 'Index', na]]),
  ];
}

export function setProperty(
  doc: DfmDocument, node: DfmNode, key: string, value: string, scope: 'control' | 'item',
): TextChange[] {
  const alvo = scope === 'item' ? doc.byControl.get(node) : node;
  if (!alvo) { throw new EditError('componente não tem TdxLayoutItem'); }
  const existing = alvo.props.get(key);
  if (existing) {
    const kind = propKind(existing.raw);
    if (kind === 'block') {
      throw new EditError(`${existing.label} é uma coleção ou bloco binário: edite no Delphi`);
    }
    return setProps(doc, alvo, [[key, existing.label, formatValue(kind, value)]]);
  }
  const label = Object.keys(ADDABLE).find(k => k.toLowerCase() === key);
  if (label) {
    return setProps(doc, alvo, [[key, label, formatValue(ADDABLE[label], value)]]);
  }
  // eventos e referências a componentes são identificadores nus no .dfm: OnClick = BotaoClick
  if (/^(on|before|after)[a-z]/i.test(key) && /^[A-Za-z_]\w*$/.test(value)) {
    const nomeProp = key.replace(/^(\w)/, c => c.toUpperCase())
      .replace(/^(On|Before|After)(\w)/, (_, p1, p2) => p1 + p2.toUpperCase());
    return setProps(doc, alvo, [[key, nomeProp, value]]);
  }
  throw new EditError(`propriedade ${key} não está no .dfm e não é uma das acrescentáveis`);
}

export function novoNome(doc: DfmDocument, cls: string): string {
  const base = cls.startsWith('T') ? cls.slice(1) : cls;
  const usados = new Set([...doc.index.values()].map(n => n.name));
  let i = 1;
  while (usados.has(`${base}${i}`)) { i++; }
  return `${base}${i}`;
}

/**
 * Cria o componente. A classe vem da paleta, que sai do índice — não de uma lista fixa —,
 * e o tamanho inicial vem da família dela: um grid nasce grande, um label pequeno.
 */
export function addComponent(
  doc: DfmDocument, parent: DfmNode, cls: string, left = 8, top = 8, reg?: Registry,
): { changes: TextChange[]; name: string } {
  if (!/^T[A-Za-z_]\w*$/.test(cls)) {
    throw new EditError(`${cls} não parece um nome de classe Delphi`);
  }
  const padrao = padraoDe(reg ? reg.kind(cls) : 'btn', cls);
  const spec: [string, string][] = [
    ['Width', String(padrao.w)], ['Height', String(padrao.h)], ...padrao.props,
  ];
  const changes: TextChange[] = [];
  const alvo = targetFor(doc, parent, changes);
  const nome = novoNome(doc, cls);
  const pad = ' '.repeat(alvo.indent + 2);
  const at = alvo.kids.length ? Math.min(...alvo.kids.map(k => k.line)) : alvo.endLine;
  const linhas = [
    `${pad}object ${nome}: ${cls}`,
    `${pad}  Left = ${left}`, `${pad}  Top = ${top}`,
    ...spec.map(([k, v]) => `${pad}  ${k} = ${v}`),
    `${pad}end`,
  ];
  for (const text of linhas) { changes.push({ line: at, kind: 'insert', text }); }
  return { changes, name: nome };
}

export function removeComponent(doc: DfmDocument, node: DfmNode): TextChange[] {
  if (node === doc.root) { throw new EditError('não dá para apagar o próprio form'); }
  if (node.uri !== doc.uri) {
    throw new EditError(`componente declarado em ${node.uri.split(/[\\/]/).pop()}: ` +
      'apague no arquivo dele');
  }
  return [{ line: node.line, kind: 'delete', count: node.endLine - node.line + 1 }];
}
