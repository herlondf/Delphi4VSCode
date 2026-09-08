/**
 * Calcula o layout do `TdxLayoutControl` em números, em vez de delegar ao flexbox.
 *
 * O motor anterior emitia `display:flex` e deixava o navegador resolver. Funcionava para o
 * caso simples e falhava em três de uma vez, todos vistos em forms reais:
 *
 *  - um controle com `flex: 1 1 auto` encolhia abaixo da altura declarada e o botão saía
 *    cortado ao meio;
 *  - um item que crescia ficava com o controle centrado dentro, deixando um vão enorme;
 *  - e o pior: o controle que o CSS esticava não avisava os próprios filhos, que já tinham
 *    sido posicionados com o tamanho antigo — um `TdxLayoutControl` aninhado numa aba ficava
 *    com a largura gravada no ancestral e cortava tudo dentro.
 *
 * Com o cálculo aqui, o tamanho de cada controle é conhecido antes de desenhar, e os filhos
 * recebem o valor certo. É o que o próprio `TdxLayoutControl` faz em runtime.
 */

import { DfmNode, num, txt, flag } from './model';
import { Registry } from './registry';
import { LayoutInfo, Rect, layoutCaption, sizeOf } from './layout';

/*
 * Os espaçamentos do `TdxLayoutControl`, tirados da fonte do DevExpress e não do olho.
 *
 * `TdxLayoutLookAndFeelOffsets.GetDefaultValue` dá os valores em unidades de diálogo:
 *
 *   ControlOffsetHorz/Vert    3      ItemsAreaOffsetHorz/Vert       0
 *   ItemOffset                4      RootItemsAreaOffsetHorz/Vert   7
 *
 * E `DLUToPixels` converte com a MÉDIA das duas direções, o que é incomum e importa:
 *
 *   (MulDiv(dlu, tmAveCharWidth, 4) + MulDiv(dlu, tmHeight, 8)) div 2
 *
 * Com a fonte padrão de form (largura média 6, altura 13) isso dá 10px para o recuo da área
 * raiz — que era exatamente o erro dominante contra o que a IDE gravou: ±10 em x e em y, em
 * 328 e 259 controles. Os valores em pixel abaixo vêm dessa conta.
 */
const LARGURA_MEDIA = 5;
const ALTURA_FONTE = 13;

/**
 * `MulDiv` do Win32 ARREDONDA, não trunca — e isso muda três das quatro constantes.
 *
 * Com truncamento o topo do grupo dava 17 e a IDE usa 18; com arredondamento (e a largura
 * média de 5 da Tahoma 8) as quatro fecham de uma vez: `ItemOffset` 6, `RootItemsAreaOffset`
 * 10, `ControlOffset` 4 e o topo 18.
 */
function mulDiv(a: number, b: number, c: number): number {
  return Math.floor((a * b + Math.floor(c / 2)) / c);
}

/** A conversão do DevExpress, com a fonte padrão. */
function dlu(unidades: number): number {
  return Math.floor((mulDiv(unidades, LARGURA_MEDIA, 4)
    + mulDiv(unidades, ALTURA_FONTE, 8)) / 2);
}

/** `VDLUToPixels`: só a direção vertical, sem a média. */
function vdlu(unidades: number): number {
  return mulDiv(unidades, ALTURA_FONTE, 8);
}

/** Espaço entre itens irmãos (`ItemOffset`, 4 DLU). */
export const GAP = dlu(4);
/** Recuo da área de itens do grupo RAIZ (`RootItemsAreaOffset`, 7 DLU). */
export const RECUO_RAIZ = dlu(7);

/**
 * Os recuos valem por `LayoutLookAndFeel`, não por instalação.
 *
 * `TdxLayoutLookAndFeelOffsets` é publicado, e um form pode zerar a margem da raiz — é o que
 * um look-and-feel chamado "SemMargem" faz nos forms de teste, e sem ler isso um container de
 * 21px de altura saía com o conteúdo de 1px, porque os 10 de recuo comiam os dois lados.
 */
export interface Recuos {
  gap: number;
  raizH: number;
  raizV: number;
  areaH: number;
  areaV: number;
}

export const RECUOS_PADRAO: Recuos = {
  gap: GAP, raizH: RECUO_RAIZ, raizV: RECUO_RAIZ, areaH: 0, areaV: 0,
};

/** Lê `Offsets.*` do componente de look-and-feel; o que ele não disser fica no padrão. */
export function recuosDe(lnf: DfmNode | undefined): Recuos {
  if (!lnf) { return RECUOS_PADRAO; }
  const em = (chave: string, padrao: number): number => {
    const p = num(lnf, `offsets.${chave}`, NaN);
    return Number.isNaN(p) ? padrao : dlu(p);
  };
  return {
    gap: em('itemoffset', GAP),
    raizH: em('rootitemsareaoffsethorz', RECUO_RAIZ),
    raizV: em('rootitemsareaoffsetvert', RECUO_RAIZ),
    areaH: em('itemsareaoffsethorz', 0),
    areaV: em('itemsareaoffsetvert', 0),
  };
}
/** Recuo do controle dentro do item (`ControlOffset`, 3 DLU). */
export const RECUO_CONTROLE = dlu(3);
/*
 * Grupo que não é raiz tem `ItemsAreaOffset` ZERO — a implementação em
 * `TdxLayoutGroupViewInfoSpecific.GetItemsAreaOffset` devolve 0, e só cresce com barra de
 * rolagem. O que recua um grupo com moldura é a largura da própria moldura, e essa vem de
 * `TdxLayoutStandardLookAndFeel.GetGroupBorderWidth`:
 *
 *   lado != caption:  FrameWidths + GetGroupBorderOffset
 *   lado == caption:  VDLUToPixels(4) + FrameWidths div 2 + GetGroupBorderOffset
 *
 * `FrameWidths` é 2 no estilo padrão (`lbsFlat`/`lbsStandard`) e `GetGroupBorderOffset` é
 * `DLUToPixels(fonte, 7)`. Dá 12 nos lados e 17 no topo — e 12 era exatamente o que faltava:
 * o recuo de 5 deixava 40 controles 7px à esquerda do que a IDE gravou, e 14px mais largos.
 */
const MOLDURA = 2;
export const RECUO_GRUPO = MOLDURA + dlu(7);
export const RECUO_GRUPO_TOPO = vdlu(4) + Math.floor(MOLDURA / 2) + dlu(7);
export const ALTO_CAPTION = 14;
/** Faixa de abas de um grupo `ldTabbed`. */
export const ALTO_ABA = 22;
/** Largura reservada ao rótulo à esquerda de um item. */
export const LARGURA_CAPTION = 8;

export interface Medida {
  /** Retângulo do item ou grupo, relativo ao host. */
  rect: Rect;
  /** Retângulo do controle dentro do item, quando há um. */
  controle?: { node: DfmNode; rect: Rect };
  info: LayoutInfo;
  filhos: Medida[];
  /** Rótulo do item e onde ele fica. */
  caption?: { texto: string; pos: string; rect: Rect };
  /** Rótulos das abas, quando o grupo é `ldTabbed`; os filhos são as páginas. */
  abas?: string[];
}

function direcao(info: LayoutInfo): string {
  return txt(info.node, 'layoutdirection', 'ldVertical').toLowerCase();
}

function ehHorizontal(info: LayoutInfo): boolean {
  return direcao(info) === 'ldhorizontal';
}

/** Grupo em abas: os filhos são páginas sobrepostas, não irmãos numa fila. */
function ehTabbed(info: LayoutInfo): boolean {
  return direcao(info) === 'ldtabbed';
}

function alinhamento(n: DfmNode): { h: string; v: string } {
  return {
    h: txt(n, 'alignhorz', '').toLowerCase(),
    v: txt(n, 'alignvert', '').toLowerCase(),
  };
}

/**
 * Item empilhado ocupa a largura do grupo, mas não a altura.
 *
 * É a regra do dx que menos se documenta e mais se nota quando falta: sem ela um
 * `TcxPageControl` fica com a largura que o ancestral gravou, dentro de um item largo.
 */
function estica(valor: string, eixoHorizontal: boolean): boolean {
  if (valor === 'ahclient' || valor === 'avclient') { return true; }
  if (valor === '' || valor.endsWith('parentmanaged')) { return eixoHorizontal; }
  return false;
}

function ehClient(valor: string): boolean {
  return valor === 'ahclient' || valor === 'avclient';
}

/**
 * `Offsets` do item — margem em volta dele, dentro do espaço que o grupo lhe deu.
 *
 * Vale para item e para grupo (ambos herdam de `TdxCustomLayoutItem`), entra no tamanho que
 * o item pede (`Item.Width + OffsetsWidth`) e sai da área do conteúdo
 * (`cxRectWidth(OriginalBounds) - OffsetsWidth`). Nos forms de teste são ~300 usos, do
 * `Offsets.Left = 20` que indenta um rádio ao `Offsets.Bottom = -3` que encosta dois campos.
 */
function recuos(n: DfmNode): { l: number; t: number; r: number; b: number } {
  return {
    l: num(n, 'offsets.left', 0), t: num(n, 'offsets.top', 0),
    r: num(n, 'offsets.right', 0), b: num(n, 'offsets.bottom', 0),
  };
}

/** O controle que um item posiciona, se houver. */
function controleDe(info: LayoutInfo): DfmNode | undefined {
  const nome = txt(info.node, 'control', '');
  return nome ? info.node.parent?.kids.find(k => k.name === nome) : undefined;
}

/**
 * Tamanho do controle dentro do item, sem o rótulo.
 *
 * `ControlOptions.OriginalWidth/Height` é o que o designer gravou e o que o dx restaura; o
 * tamanho do próprio controle só entra quando o item não gravou nada.
 */
function tamanhoDoControle(info: LayoutInfo, reg: Registry): { w: number; h: number } {
  const n = info.node;
  const ctl = controleDe(info);
  let w = num(n, 'controloptions.originalwidth');
  let h = num(n, 'controloptions.originalheight');
  if (ctl) {
    const [cw, ch] = sizeOf(ctl, reg);
    return { w: w || cw || 120, h: h || ch || 21 };
  }
  // separador, rótulo solto, item de imagem
  w = w || 60;
  h = h || (/separator/i.test(n.cls) ? 6 : 15);
  return { w, h };
}

/** Tamanho que um item pede, antes de crescer ou dividir espaço. */
function pedido(info: LayoutInfo, reg: Registry, rec: Recuos): { w: number; h: number } {
  const off = recuos(info.node);
  const mais = (p: { w: number; h: number }): { w: number; h: number } =>
    ({ w: p.w + off.l + off.r, h: p.h + off.t + off.b });
  if (info.group) {
    const [cap] = layoutCaption(info.node);
    const moldura = flag(info.node, 'showborder') !== false && !!cap;
    if (ehTabbed(info)) {
      const p = info.kids.map(k => pedido(k, reg, rec));
      return mais({
        w: Math.max(0, ...p.map(x => x.w)),
        h: Math.max(0, ...p.map(x => x.h)) + ALTO_ABA,
      });
    }
    const horiz = ehHorizontal(info);
    let w = 0;
    let h = 0;
    for (const k of info.kids) {
      const p = pedido(k, reg, rec);
      if (horiz) { w += p.w + rec.gap; h = Math.max(h, p.h); }
      else { h += p.h + rec.gap; w = Math.max(w, p.w); }
    }
    if (info.kids.length) { if (horiz) { w -= rec.gap; } else { h -= rec.gap; } }
    if (moldura) { w += RECUO_GRUPO * 2; h += RECUO_GRUPO + RECUO_GRUPO_TOPO; }
    return mais({ w, h });
  }

  const n = info.node;
  const ctl = tamanhoDoControle(info, reg);
  const [cap, pos] = layoutCaption(n);
  if (!cap) { return mais(ctl); }
  return mais(pos === 'top' || pos === 'bottom'
    ? { w: ctl.w, h: ctl.h + ALTO_CAPTION }
    : { w: ctl.w + cap.length * 6 + LARGURA_CAPTION, h: ctl.h });
}

/**
 * Distribui `disponivel` entre os filhos na direção principal.
 *
 * Quem é `client` fica com o que sobrou depois dos tamanhos pedidos — inclusive quando isso
 * é MENOS do que ele pediria: `client` quer dizer "o que sobrar", nos dois sentidos. Cobrir o
 * caso só para cima deixava o grupo de nome/endereço do CadastroMan com os 647px que a soma dos
 * filhos pedia, ao lado de uma imagem de 422, num container de 848 — 224px para fora.
 *
 * Quando não há nenhum `client` e falta espaço, aí sim ninguém encolhe: transbordar é visível
 * e diz a verdade, encolher em silêncio esconde um layout que também estoura no Delphi.
 */
function distribuir(
  filhos: LayoutInfo[], pedidos: { w: number; h: number }[], disponivel: number,
  horiz: boolean, gap: number,
): number[] {
  const eixo = (p: { w: number; h: number }): number => (horiz ? p.w : p.h);
  const clientes: number[] = [];
  let fixo = 0;
  filhos.forEach((f, i) => {
    const a = alinhamento(f.node);
    if (ehClient(horiz ? a.h : a.v)) { clientes.push(i); }
    else { fixo += eixo(pedidos[i]); }
  });
  const gaps = Math.max(0, filhos.length - 1) * gap;
  const sobra = Math.max(0, disponivel - fixo - gaps);

  /*
   * Com mais de um `client`, o rateio é proporcional ao que cada um pediu — não em partes
   * iguais. É o que se vê no CadastroMan: o bloco de nome/endereço e a moldura da foto são
   * ambos `ahClient`, e meio a meio daria uma foto do tamanho do formulário inteiro.
   */
  const total = clientes.reduce((acc, i) => acc + eixo(pedidos[i]), 0);
  const fatias = new Map<number, number>();
  let dado = 0;
  clientes.forEach((i, pos) => {
    const parte = pos === clientes.length - 1 ? sobra - dado
      : total ? Math.round((sobra * eixo(pedidos[i])) / total)
        : Math.floor(sobra / clientes.length);
    fatias.set(i, Math.max(0, parte));
    dado += parte;
  });

  return filhos.map((f, i) => (fatias.has(i) ? fatias.get(i)! : eixo(pedidos[i])));
}

/** Percorre a árvore e devolve o retângulo de tudo, já resolvido. */
export function medirLayout(
  info: LayoutInfo, reg: Registry, area: Rect, raiz = true, rec: Recuos = RECUOS_PADRAO,
): Medida {
  const medida: Medida = { rect: area, info, filhos: [] };
  const off = recuos(info.node);
  /* O retângulo devolvido é o que o grupo reservou; o conteúdo mora dentro dos `Offsets`. */
  const util: Rect = {
    x: off.l, y: off.t,
    w: Math.max(0, area.w - off.l - off.r), h: Math.max(0, area.h - off.t - off.b),
  };

  if (!info.group) {
    const ctl = controleDe(info);
    const [cap, pos] = layoutCaption(info.node);
    let dentro = { ...util };
    if (cap) {
      const largura = cap.length * 6 + LARGURA_CAPTION;
      if (pos === 'top') {
        medida.caption = {
          texto: cap, pos, rect: { x: util.x, y: util.y, w: util.w, h: ALTO_CAPTION },
        };
        dentro = {
          x: util.x, y: util.y + ALTO_CAPTION,
          w: util.w, h: Math.max(0, util.h - ALTO_CAPTION),
        };
      } else if (pos === 'bottom') {
        medida.caption = {
          texto: cap, pos,
          rect: { x: util.x, y: util.y + util.h - ALTO_CAPTION, w: util.w, h: ALTO_CAPTION },
        };
        dentro = { x: util.x, y: util.y, w: util.w, h: Math.max(0, util.h - ALTO_CAPTION) };
      } else if (pos === 'right') {
        medida.caption = {
          texto: cap, pos,
          rect: { x: util.x + util.w - largura, y: util.y, w: largura, h: util.h },
        };
        dentro = { x: util.x, y: util.y, w: Math.max(0, util.w - largura), h: util.h };
      } else {
        medida.caption = {
          texto: cap, pos: 'left', rect: { x: util.x, y: util.y, w: largura, h: util.h },
        };
        dentro = {
          x: util.x + largura, y: util.y, w: Math.max(0, util.w - largura), h: util.h,
        };
      }
    }
    if (ctl) {
      const p = tamanhoDoControle(info, reg);
      const a = alinhamento(info.node);
      /*
       * No eixo em que o item estica, o controle acompanha. No outro, ele fica com o tamanho
       * gravado — inclusive quando o item ficou menor, e aí transborda de propósito. Cortar
       * para caber é o que serrava os botões de OK e Cancelar ao meio: some 6px de um botão
       * de 25 e nada na tela diz que o layout não coube.
       */
      const w = estica(a.h, true) || ehClient(a.h) ? dentro.w : p.w;
      const h = ehClient(a.v) ? dentro.h : p.h;
      const x = a.h === 'ahright' ? dentro.x + dentro.w - w
        : a.h === 'ahcenter' ? dentro.x + Math.max(0, (dentro.w - w) / 2) : dentro.x;
      const y = a.v === 'avbottom' ? dentro.y + dentro.h - h
        : a.v === 'avcenter' ? dentro.y + Math.max(0, (dentro.h - h) / 2) : dentro.y;
      medida.controle = { node: ctl, rect: { x: Math.round(x), y: Math.round(y), w, h } };
    }
    return medida;
  }

  if (ehTabbed(info)) {
    medida.abas = info.kids.map(k => layoutCaption(k.node)[0] || k.node.name);
    const pagina: Rect = {
      x: util.x, y: util.y + ALTO_ABA, w: util.w, h: Math.max(0, util.h - ALTO_ABA),
    };
    for (const k of info.kids) { medida.filhos.push(medirLayout(k, reg, pagina, false, rec)); }
    return medida;
  }

  const horiz = ehHorizontal(info);
  const [cap] = layoutCaption(info.node);
  const moldura = flag(info.node, 'showborder') !== false && !!cap;
  /*
   * Só o grupo RAIZ recua a área de itens, e recua `RootItemsAreaOffset` — 7 unidades de
   * diálogo, 10px na fonte padrão. Grupo interno tem `ItemsAreaOffset` zero; o que ele
   * eventualmente recua é a moldura que desenha quando tem rótulo, não espaçamento.
   */
  const ladoRaiz = raiz ? rec.raizH : rec.areaH;
  const topoRaiz = raiz ? rec.raizV : rec.areaV;
  const lado = (moldura ? RECUO_GRUPO : 0) + ladoRaiz;
  const topo = (moldura ? RECUO_GRUPO_TOPO : 0) + topoRaiz;
  const interna = {
    x: util.x + lado, y: util.y + topo,
    w: Math.max(0, util.w - lado * 2),
    h: Math.max(0, util.h - topo - (moldura ? RECUO_GRUPO : 0) - topoRaiz),
  };

  const pedidos = info.kids.map(k => pedido(k, reg, rec));
  const principal = distribuir(
    info.kids, pedidos, horiz ? interna.w : interna.h, horiz, rec.gap);

  /*
   * No eixo principal o grupo tem duas âncoras, não uma: `ahLeft`/`avTop` empacotam a partir
   * do início, `ahRight`/`avBottom` a partir do fim, e o que sobra no meio fica vazio (ou vai
   * para quem é `client`). É o que põe OK e Cancelar no canto direito do rodapé sem nenhum
   * espaçador — empilhar tudo da esquerda jogava os dois 38px para fora do grupo.
   */
  const inicio = horiz ? interna.x : interna.y;
  const offsets: number[] = new Array(info.kids.length);
  let fimCursor = inicio + (horiz ? interna.w : interna.h);
  for (let i = info.kids.length - 1; i >= 0; i--) {
    const a = alinhamento(info.kids[i].node);
    const principalDele = horiz ? a.h : a.v;
    if (principalDele !== 'ahright' && principalDele !== 'avbottom') { continue; }
    fimCursor -= principal[i];
    offsets[i] = fimCursor;
    fimCursor -= rec.gap;
  }
  let cursor = inicio;
  info.kids.forEach((k, i) => {
    if (offsets[i] !== undefined) { return; }
    offsets[i] = cursor;
    cursor += principal[i] + rec.gap;
  });

  info.kids.forEach((k, i) => {
    const a = alinhamento(k.node);
    const cruzado = horiz ? a.v : a.h;
    const cruzadoTotal = horiz ? interna.h : interna.w;
    const pedidoCruzado = horiz ? pedidos[i].h : pedidos[i].w;
    const tamCruzado = estica(cruzado, !horiz) ? cruzadoTotal
      : Math.min(pedidoCruzado, cruzadoTotal) || pedidoCruzado;
    const base = horiz ? interna.y : interna.x;
    const offCruzado = cruzado === 'ahright' || cruzado === 'avbottom'
      ? base + cruzadoTotal - tamCruzado
      : cruzado === 'ahcenter' || cruzado === 'avcenter'
        ? base + Math.max(0, Math.round((cruzadoTotal - tamCruzado) / 2))
        : base;

    const filhoArea: Rect = horiz
      ? { x: offsets[i], y: offCruzado, w: principal[i], h: tamCruzado }
      : { x: offCruzado, y: offsets[i], w: tamCruzado, h: principal[i] };
    medida.filhos.push(medirLayout(k, reg, filhoArea, false, rec));
  });
  return medida;
}
