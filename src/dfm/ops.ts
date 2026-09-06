/**
 * Operações do designer que mexem na estrutura, não só em valores.
 *
 * Mover um bloco entre containers, duplicar, trocar a ordem de empilhamento, reverter um
 * override: tudo isso é recortar e colar linhas do `.dfm`, e todas precisam do mesmo cuidado
 * — o bloco vai inteiro, do `object` ao `end` que o fecha, com a indentação do destino.
 */

import { DfmNode, num, txt } from './model';
import { DfmDocument } from './document';
import { EditError, TextChange } from './edit';

/** Linhas cruas de um nó, do cabeçalho ao `end`, como estão no arquivo. */
export function blockLines(text: string, node: DfmNode): string[] {
  return text.split(/\r?\n/).slice(node.line, node.endLine + 1);
}

/** Reindenta um bloco inteiro para caber sob um novo pai. */
export function reindent(lines: string[], from: number, to: number): string[] {
  const delta = to - from;
  return lines.map(l => {
    if (!l.trim()) { return l; }
    const atual = l.length - l.trimStart().length;
    return ' '.repeat(Math.max(0, atual + delta)) + l.trimStart();
  });
}

function ownFile(doc: DfmDocument, node: DfmNode, acao: string): void {
  if (node.uri !== doc.uri) {
    throw new EditError(
      `${node.name || node.cls} é declarado em ${node.uri.split(/[\\/]/).pop()}: ` +
      `${acao} no arquivo dele`);
  }
}

/** Ponto onde um filho novo entra: depois das propriedades, antes dos objetos aninhados. */
export function insertPoint(parent: DfmNode): number {
  return parent.kids.length ? Math.min(...parent.kids.map(k => k.line)) : parent.endLine;
}

/**
 * D05 — reparentar: tira o bloco de onde está e põe dentro de outro container.
 *
 * As coordenadas são relativas ao pai, então o Left/Top precisam ser recalculados para o
 * componente não saltar na tela.
 */
export function reparent(
  doc: DfmDocument, text: string, node: DfmNode, novoPai: DfmNode,
  novoLeft: number, novoTop: number,
): TextChange[] {
  ownFile(doc, node, 'mova');
  ownFile(doc, novoPai, 'mova para um container declarado');
  if (node === novoPai) { throw new EditError('um componente não pode conter a si mesmo'); }
  for (let p: DfmNode | null = novoPai; p; p = p.parent) {
    if (p === node) { throw new EditError('não dá para mover um container para dentro dele mesmo'); }
  }

  const bloco = reindent(blockLines(text, node), node.indent, novoPai.indent + 2);
  const ajustado = bloco.map(l => {
    const m = /^(\s*)(Left|Top)(\s*=\s*)(-?\d+)\s*$/.exec(l);
    if (!m) { return l; }
    return `${m[1]}${m[2]}${m[3]}${m[2] === 'Left' ? novoLeft : novoTop}`;
  });

  return [
    { line: node.line, kind: 'delete', count: node.endLine - node.line + 1 },
    ...ajustado.map(text => ({ line: insertPoint(novoPai), kind: 'insert' as const, text })),
  ];
}

/**
 * D04 — duplicar: copia o bloco com nome novo, deslocado, como o Ctrl+D do Delphi.
 * Nomes dos filhos também precisam ser únicos, senão o form não carrega.
 */
export function duplicate(
  doc: DfmDocument, text: string, node: DfmNode, offset = 8,
): { changes: TextChange[]; name: string } {
  ownFile(doc, node, 'duplique');
  if (!node.parent) { throw new EditError('não dá para duplicar o próprio form'); }

  const usados = new Set([...doc.index.values()].map(n => n.name).filter(Boolean));
  const renomear = new Map<string, string>();
  const proximo = (base: string): string => {
    const raiz = base.replace(/\d+$/, '') || base;
    let i = 1;
    while (usados.has(`${raiz}${i}`)) { i++; }
    const novo = `${raiz}${i}`;
    usados.add(novo);
    return novo;
  };
  const walkNames = (n: DfmNode): void => {
    if (n.name) { renomear.set(n.name, proximo(n.name)); }
    n.kids.forEach(walkNames);
  };
  walkNames(node);

  const bloco = blockLines(text, node).map(l => {
    let out = l;
    // renomeia nas declarações `object X: TY` e nas referências simples `Prop = X`
    for (const [de, para] of renomear) {
      out = out.replace(new RegExp(`(\\b(?:object|inherited|inline)\\s+)${de}(\\s*:)`), `$1${para}$2`);
      out = out.replace(new RegExp(`(=\\s*)${de}\\s*$`), `$1${para}`);
    }
    const m = /^(\s*)(Left|Top)(\s*=\s*)(-?\d+)\s*$/.exec(out);
    if (m) { return `${m[1]}${m[2]}${m[3]}${parseInt(m[4], 10) + offset}`; }
    return out;
  });

  const at = node.endLine + 1;
  return {
    changes: bloco.map(text => ({ line: at, kind: 'insert' as const, text })),
    name: renomear.get(node.name) ?? node.name,
  };
}

/**
 * D06 — z-order: quem vem por último no `.dfm` fica por cima. Trazer para a frente é mover o
 * bloco para o fim da lista de irmãos; enviar para trás, para o começo.
 */
export function zOrder(
  doc: DfmDocument, text: string, node: DfmNode, para: 'front' | 'back',
): TextChange[] {
  ownFile(doc, node, 'reordene');
  const pai = node.parent;
  if (!pai) { throw new EditError('o form não tem irmãos'); }
  const irmaos = pai.kids;
  if (irmaos.length < 2) { throw new EditError('não há irmãos para reordenar'); }
  const ehPrimeiro = irmaos[0] === node;
  const ehUltimo = irmaos[irmaos.length - 1] === node;
  if ((para === 'front' && ehUltimo) || (para === 'back' && ehPrimeiro)) {
    throw new EditError(para === 'front' ? 'já está na frente' : 'já está atrás');
  }
  const bloco = blockLines(text, node);
  const destino = para === 'front'
    ? irmaos[irmaos.length - 1].endLine + 1
    : irmaos[0].line;
  return [
    { line: node.line, kind: 'delete', count: node.endLine - node.line + 1 },
    ...bloco.map(text => ({ line: destino, kind: 'insert' as const, text })),
  ];
}

/**
 * D11 — reverter para o herdado: apaga o override e devolve o valor do ancestral.
 *
 * Se o bloco `inherited` ficar sem nenhuma propriedade e sem filhos, ele também sai — é o que
 * o Delphi faz, e deixa o `.dfm` limpo.
 */
export function revertInherited(
  doc: DfmDocument, node: DfmNode, key?: string,
): TextChange[] {
  const alvo = doc.writeTarget(node);
  if (!alvo || alvo === node) {
    throw new EditError('este componente não é herdado: não há o que reverter');
  }
  if (key) {
    const p = alvo.props.get(key);
    if (!p) { throw new EditError(`${key} não está sobrescrito aqui`); }
    const sobra = alvo.props.size - 1;
    if (sobra === 0 && !alvo.kids.length) {
      return [{ line: alvo.line, kind: 'delete', count: alvo.endLine - alvo.line + 1 }];
    }
    return [{ line: p.line, kind: 'delete', count: 1 }];
  }
  return [{ line: alvo.line, kind: 'delete', count: alvo.endLine - alvo.line + 1 }];
}

/** D08 — igualar tamanho ao maior ou menor da seleção. */
export function equalizeSize(
  nodes: DfmNode[], eixo: 'w' | 'h', modo: 'max' | 'min',
): Map<DfmNode, number> {
  if (nodes.length < 2) { throw new EditError('selecione ao menos dois componentes'); }
  const chave = eixo === 'w' ? 'width' : 'height';
  const valores = nodes.map(n => num(n, chave));
  const alvo = modo === 'max' ? Math.max(...valores) : Math.min(...valores);
  return new Map(nodes.map(n => [n, alvo]));
}

/** D07 — as doze operações de alinhamento do Delphi, sobre os retângulos já resolvidos. */
export type AlignOp =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'centerH' | 'centerV' | 'spaceH' | 'spaceV'
  | 'centerInParentH' | 'centerInParentV';

export function alignRects(
  rects: { path: string; x: number; y: number; w: number; h: number }[],
  op: AlignOp, pai: { w: number; h: number },
): Map<string, { x: number; y: number }> {
  if (rects.length < 1) { return new Map(); }
  const out = new Map<string, { x: number; y: number }>();
  const set = (r: typeof rects[0], x: number, y: number) => out.set(r.path, { x, y });

  switch (op) {
    case 'left': {
      const x = Math.min(...rects.map(r => r.x));
      rects.forEach(r => set(r, x, r.y));
      break;
    }
    case 'right': {
      const dir = Math.max(...rects.map(r => r.x + r.w));
      rects.forEach(r => set(r, dir - r.w, r.y));
      break;
    }
    case 'top': {
      const y = Math.min(...rects.map(r => r.y));
      rects.forEach(r => set(r, r.x, y));
      break;
    }
    case 'bottom': {
      const base = Math.max(...rects.map(r => r.y + r.h));
      rects.forEach(r => set(r, r.x, base - r.h));
      break;
    }
    case 'centerH': {
      const centro = rects.reduce((s, r) => s + r.x + r.w / 2, 0) / rects.length;
      rects.forEach(r => set(r, Math.round(centro - r.w / 2), r.y));
      break;
    }
    case 'centerV': {
      const centro = rects.reduce((s, r) => s + r.y + r.h / 2, 0) / rects.length;
      rects.forEach(r => set(r, r.x, Math.round(centro - r.h / 2)));
      break;
    }
    case 'centerInParentH':
      rects.forEach(r => set(r, Math.round((pai.w - r.w) / 2), r.y));
      break;
    case 'centerInParentV':
      rects.forEach(r => set(r, r.x, Math.round((pai.h - r.h) / 2)));
      break;
    case 'spaceH': {
      const ord = [...rects].sort((a, b) => a.x - b.x);
      const ini = ord[0].x;
      const fim = ord[ord.length - 1].x + ord[ord.length - 1].w;
      const usado = ord.reduce((s, r) => s + r.w, 0);
      const gap = (fim - ini - usado) / (ord.length - 1);
      let cur = ini;
      ord.forEach(r => { set(r, Math.round(cur), r.y); cur += r.w + gap; });
      break;
    }
    case 'spaceV': {
      const ord = [...rects].sort((a, b) => a.y - b.y);
      const ini = ord[0].y;
      const fim = ord[ord.length - 1].y + ord[ord.length - 1].h;
      const usado = ord.reduce((s, r) => s + r.h, 0);
      const gap = (fim - ini - usado) / (ord.length - 1);
      let cur = ini;
      ord.forEach(r => { set(r, r.x, Math.round(cur)); cur += r.h + gap; });
      break;
    }
  }
  return out;
}

/** D09 — ordem de tabulação atual dos filhos de um container, na ordem em que ela vale. */
export function tabOrderOf(parent: DfmNode): { path: string; name: string; order: number }[] {
  return parent.kids
    .filter(k => k.props.has('taborder'))
    .map(k => ({ path: k.path, name: k.name, order: num(k, 'taborder') }))
    .sort((a, b) => a.order - b.order);
}

/**
 * D09 — aplica uma nova ordem de tabulação: TabOrder 0..n-1 na sequência recebida.
 *
 * O Delphi renumera todos ao reordenar, e é isso que evita o buraco que gera TabOrder
 * repetido — o defeito que a verificação já apontava sem ter como consertar.
 */
export function applyTabOrder(
  parent: DfmNode, ordem: string[],
): { node: DfmNode; valor: number }[] {
  const porPath = new Map(parent.kids.map(k => [k.path, k]));
  const alvo: { node: DfmNode; valor: number }[] = [];
  ordem.forEach((path, i) => {
    const n = porPath.get(path);
    if (n && num(n, 'taborder', -1) !== i) { alvo.push({ node: n, valor: i }); }
  });
  return alvo;
}

export { txt };
