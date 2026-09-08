/**
 * Onde cada componente fica na tela.
 *
 * Duas mecânicas convivem no mesmo form. A do VCL: `Align` consome o retângulo do pai e o
 * resto obedece Left/Top. E a do `TdxLayoutControl`, que ignora Left/Top e posiciona por uma
 * árvore paralela de grupos e itens — o designer grava as coordenadas já calculadas, mas
 * mexer nelas não muda nada, porque o engine recalcula em runtime.
 */

import { DfmNode, num, txt, flag, unquote } from './model';
import { Registry, Kind } from './registry';
import { alignVcl, posicao, tamanho } from './fmx';

export interface Rect { x: number; y: number; w: number; h: number; }

/** O designer só grava o que difere do default, e editores cx nem gravam Height. */
const DEFAULT_SIZE: Partial<Record<Kind, [number, number]>> = {
  btn: [75, 25], edit: [121, 21], lbl: [0, 15], chk: [97, 17],
  grid: [250, 150], panel: [185, 41], spin: [42, 21], image: [105, 105],
  bevel: [50, 50], splitter: [3, 100], shape: [65, 65], progress: [150, 17], web: [300, 200],
};

/** Containers que recalculam a posição dos filhos em runtime. */
const LAYOUT_ENGINE = 'tdxcustomlayoutcontrol';

export function isLayoutHost(node: DfmNode, reg: Registry): boolean {
  return reg.chain(node.cls).includes(LAYOUT_ENGINE);
}

/** Só o pai direto conta: o layout control governa seus filhos diretos, e nada mais fundo. */
export function inLayout(node: DfmNode, reg: Registry): boolean {
  return !!node.parent && isLayoutHost(node.parent, reg);
}

export function textWidth(text: string, px = 12): number {
  return Math.max(8, Math.round(text.length * px * 0.55) + 6);
}

export function sizeOf(node: DfmNode, reg: Registry, px = 12): [number, number] {
  const kind = reg.kind(node.cls);
  const [dw, dh] = DEFAULT_SIZE[kind] ?? [0, 0];
  // C08 — no FireMonkey o tamanho mora em Size.Width/Size.Height, e em ponto flutuante
  const [fw, fh] = tamanho(node);
  let w = fw || dw;
  let h = fh || dh;
  const autosize = flag(node, 'autosize') === true;
  if (kind === 'lbl' && (!w || autosize)) {
    w = textWidth(txt(node, 'caption') || txt(node, 'text') || node.name, px);
  }
  if (kind === 'lbl' && (!h || autosize)) { h = Math.max(h, px + 3); }
  return [w, h];
}

/**
 * Quanto a área cliente de um container é menor que o retângulo dele.
 *
 * No Delphi, `Left`/`Top` de um filho são relativos à área CLIENTE do pai, não à borda
 * externa. Um `TPanel` com `BevelOuter = bvRaised` (o padrão) come 1px de cada lado; com
 * `BorderWidth` come mais; um `TGroupBox` reserva o alto para o rótulo.
 *
 * Deixar isso para a borda do CSS parecia funcionar e não funcionava: o desconto acontecia
 * mesmo quando o `.dfm` dizia `bvNone`, e o erro somava a cada nível de aninhamento.
 */
export function insetCliente(n: DfmNode, reg: Registry): { x: number; y: number } {
  const kind = reg.kind(n.cls);
  if (kind !== 'panel' && kind !== 'grid' && kind !== 'tab') { return { x: 0, y: 0 }; }

  const bevel = (chave: string): number =>
    ['bvraised', 'bvlowered', 'bvspace'].includes(txt(n, chave, '').toLowerCase()) ? 1 : 0;
  // o TPanel nasce com bvRaised; sem a propriedade gravada, o padrão vale
  const temOuter = n.props.has('bevelouter') ? bevel('bevelouter')
    : (kind === 'panel' ? 1 : 0);
  const larguraBorda = num(n, 'borderwidth', 0);
  const x = temOuter + bevel('bevelinner') + larguraBorda;

  // grupo com rótulo reserva o alto para ele; é o que faz um GroupBox parecer certo
  const rotulo = /groupbox|radiogroup/i.test(n.cls) ? 13 : 0;
  return { x, y: x + rotulo };
}

export function visualKids(node: DfmNode, reg: Registry): DfmNode[] {
  return node.kids.filter(k => reg.isVisual(k));
}

/**
 * Resolve os retângulos dos filhos como o VCL: Align consome as bordas do cliente na ordem
 * de criação, alClient fica com o que sobrou, e o resto usa Left/Top.
 *
 * `pai` importa por um motivo só, e é decisivo: dentro de um `TdxLayoutControl` o `Align`
 * do controle **não vale**. Quem posiciona é o `TdxLayoutItem`, e o designer deixa o `Align`
 * do controle com o valor que estiver lá, sem efeito. Aplicá-lo faz um `TcxCheckBox` com
 * `Align = alLeft` esticar até a altura inteira do form e cobrir todos os irmãos.
 */
/**
 * Área que uma página ocupa dentro do container de abas.
 *
 * O `.dfm` grava `ClientRectLeft/Top/Right/Bottom` do container — o retângulo que a própria
 * IDE calculou. Ele diz mais do que o tamanho: com `HideTabs` o topo é 4, e sem `HideTabs`
 * é 24, a faixa das abas. O palpite fixo de 2/24 que estava aqui deixava toda página 4px
 * larga demais, e 18px baixa demais nos 83 containers sem faixa.
 */
function areaPagina(pai: DfmNode | undefined, cw: number, ch: number): Rect {
  if (!pai?.props.has('clientrecttop')) { return { x: 2, y: 24, w: cw - 4, h: ch - 26 }; }
  const w = num(pai, 'width', cw);
  const h = num(pai, 'height', ch);
  const esq = num(pai, 'clientrectleft', 2);
  const topo = num(pai, 'clientrecttop', 24);
  const dir = w - num(pai, 'clientrectright', w - 2);
  const baixo = h - num(pai, 'clientrectbottom', h - 2);
  return { x: esq, y: topo, w: cw - esq - dir, h: ch - topo - baixo };
}

export function place(
  kids: DfmNode[], cw: number, ch: number, reg: Registry, px = 12, pai?: DfmNode,
): Map<DfmNode, Rect> {
  const rects = new Map<DfmNode, Rect>();
  const clients: DfmNode[] = [];
  const semAlign = !!pai && isLayoutHost(pai, reg);
  /*
   * O recuo da área cliente NÃO entra nas coordenadas.
   *
   * Chegou a entrar, e quebrou a edição: o front lê `style.left` para gravar `Left`, e com o
   * recuo somado ele gravava a posição deslocada. Quem desloca é a borda do container no
   * CSS — para um elemento absoluto o bloco de referência é o padding box, ou seja, já do
   * lado de dentro da borda. É o mesmo modelo do Delphi, e mantém o número gravado igual ao
   * número mostrado.
   */
  let fx = 0, fy = 0, fw = cw, fh = ch;

  for (const k of kids) {
    if (reg.kind(k.cls) === 'tab') {
      rects.set(k, areaPagina(pai, cw, ch));
      continue;
    }
    const align = semAlign ? '' : alignVcl(txt(k, 'align', ''));
    const [w, h] = sizeOf(k, reg, px);
    switch (align) {
      case 'altop':
        rects.set(k, { x: fx, y: fy, w: fw, h }); fy += h; fh -= h; break;
      case 'albottom':
        rects.set(k, { x: fx, y: fy + fh - h, w: fw, h }); fh -= h; break;
      case 'alleft':
        rects.set(k, { x: fx, y: fy, w, h: fh }); fx += w; fw -= w; break;
      case 'alright':
        rects.set(k, { x: fx + fw - w, y: fy, w, h: fh }); fw -= w; break;
      case 'alclient':
        clients.push(k); break;
      default: {
        const [x, y] = posicao(k);
        rects.set(k, { x, y, w, h });
      }
    }
  }
  for (const k of clients) { rects.set(k, { x: fx, y: fy, w: fw, h: fh }); }
  return rects;
}

/** dalNone é a variante DevExpress de alNone: também posiciona por Left/Top. */
export function movable(node: DfmNode, reg: Registry): boolean {
  if (inLayout(node, reg)) { return false; }
  const a = alignVcl(txt(node, 'align', 'alNone'));
  return (a === '' || a === 'alnone' || a === 'dalnone') && reg.kind(node.cls) !== 'tab';
}

// ---- árvore de layout do dxLayoutControl ----

export interface LayoutInfo {
  node: DfmNode;
  group: boolean;
  kids: LayoutInfo[];
}

/**
 * Monta a árvore de layout de um host. O .dfm guarda grupos e itens como lista plana ligada
 * por `Parent` + `Index`; a hierarquia visual é essa árvore, não o aninhamento dos controles.
 */
export function layoutTree(host: DfmNode, reg: Registry): LayoutInfo | null {
  const nodes = new Map<string, LayoutInfo>();
  for (const k of host.kids) {
    const chain = reg.chain(k.cls);
    if (chain.includes('tdxcustomlayoutgroup')) { nodes.set(k.name, { node: k, group: true, kids: [] }); }
    else if (chain.includes('tdxcustomlayoutitem')) { nodes.set(k.name, { node: k, group: false, kids: [] }); }
  }
  if (!nodes.size) { return null; }

  /*
   * `Parent` diz tudo, inclusive quando está vazio — e os dois casos vazios são diferentes.
   *
   * `Parent = nil` é um item que o form descendente TIROU do layout: o `.dfm` continua com o
   * registro, mas o dx não desenha. Ausente é o `Group_Root`, que não tem pai porque é a
   * raiz. Tratar os dois como raiz empilhava os botões excluídos do FinanceiroItemMan abaixo
   * do form e estourava a altura em 70px.
   *
   * E raiz é uma só: o `TdxLayoutControl` tem um único `Root`. Um segundo grupo sem pai é
   * resto de edição no designer, e também não é desenhado.
   */
  const byIndex = (a: LayoutInfo, b: LayoutInfo) => num(a.node, 'index') - num(b.node, 'index');
  const candidatos: LayoutInfo[] = [];
  for (const info of nodes.values()) {
    const bruto = info.node.props.get('parent')?.raw?.trim() ?? '';
    if (bruto.toLowerCase() === 'nil') { continue; }
    const pai = txt(info.node, 'parent', '');
    const alvo = pai && pai !== info.node.name ? nodes.get(pai) : undefined;
    if (alvo) { alvo.kids.push(info); }
    else if (!pai) { candidatos.push(info); }
  }
  for (const info of nodes.values()) { info.kids.sort(byIndex); }
  candidatos.sort(byIndex);
  const raiz = candidatos.find(c => c.group) ?? candidatos[0];
  if (raiz) { return raiz; }
  // nenhum candidato: a árvore veio toda com pai fora do host, então o host faz as vezes
  return { node: host, group: true, kids: [...nodes.values()].sort(byIndex) };
}

export const CAPTION_POS: Record<string, string> = {
  cltop: 'top', clbottom: 'bottom', clright: 'right', clleft: 'left',
};

/**
 * Legenda que o TdxLayoutItem desenha ao lado do controle. É aqui que moram os rótulos
 * visíveis do form — "Empresa:", "Vendedor:" —, não nos controles.
 */
export function layoutCaption(item: DfmNode | undefined): [string, string] {
  if (!item || flag(item, 'captionoptions.visible') === false) { return ['', '']; }
  const raw = item.props.get('captionoptions.text');
  const text = raw ? unquote(raw.raw) : '';
  if (!text || text === 'New Item') { return ['', '']; }
  const pos = CAPTION_POS[txt(item, 'captionoptions.layout', '').toLowerCase()] ?? 'left';
  return [text, pos];
}
