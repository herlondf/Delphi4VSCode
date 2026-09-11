/**
 * Desenha o form em HTML.
 *
 * Duas modalidades: as coordenadas que o designer gravou (exatas, mas estáticas) e o layout
 * recalculado por medir.ts para as áreas sob `TdxLayoutControl` — nesse modo, reordenar e
 * redimensionar têm efeito visível, que é o ponto de poder editar.
 */

import { DfmNode, num, txt, flag, unquote, stripAccel, walk } from './model';
import { Registry, Kind } from './registry';
import { DfmDocument, lookAndFeelDe } from './document';
import {
  Rect, place, visualKids, layoutTree, insetCliente,
  layoutCaption, isLayoutHost, inLayout, movable,
} from './layout';
import { Medida, medirLayout, recuosDe } from './medir';

export interface RenderOptions {
  /** Recalcular o layout do dxLayoutControl em vez de usar as coordenadas gravadas. */
  flexLayout: boolean;
  /** Nonce da webview para o CSP. */
  nonce: string;
  cssUri: string;
  jsUri: string;
  /** Módulo da paleta, carregado à parte do front principal. */
  paletaUri: string;
  /** Módulo do Object Inspector. */
  inspetorUri: string;
  /** Módulo das caixas de frame, modelos e menu. */
  dialogosUri: string;
}

/**
 * Controles fixos da barra: travar o designer e o zoom.
 *
 * Ficam no HTML e não no JS porque o CSP proíbe handler inline — o JS só se liga neles por
 * id, e o teste que cruza o front com o render cobra a existência de cada um.
 */
const BOTOES_BARRA =
  '<span class="sp2"></span>' +
  '<button id="lock" class="barbtn" title="Travar posições (Ctrl+L)">🔓</button>' +
  '<button id="zout" class="barbtn" title="Reduzir (Ctrl+-)">−</button>' +
  '<button id="zlvl" class="barbtn" title="Voltar a 100% (Ctrl+0)">100%</button>' +
  '<button id="zin" class="barbtn" title="Ampliar (Ctrl++)">+</button>' +
  '<button id="zfit" class="barbtn" title="Encaixar na janela (Ctrl+Shift+F)">⤢</button>' +
  '<button id="pal-btn" class="barbtn" title="Paleta de componentes (Insert)">⊞</button>' +
  '<button id="pal-busca" class="barbtn" ' +
  'title="Procurar componente (Ctrl+Espaço)">🔍</button>' +
  '<button id="build-btn" class="barbtn" title="Compilar o projeto ativo (Ctrl+F9)">▶</button>';

/** A faixa da paleta: o conteúdo é montado pelo palette.js na primeira abertura. */
const FAIXA_PALETA = '<div id="pal" class="pal" hidden></div>';

/*
 * Altura da barra de título do form desenhado.
 *
 * Precisa ser a mesma no HTML e no CSS. Antes era o número 26 escrito nos dois lugares, e o
 * CSS chegava nele por soma de `padding` e `line-height` — bastava mudar a fonte para a área
 * cliente sair de lugar e todo componente deslizar alguns pixels.
 */
export const ALTURA_TITULO = 26;
export const ALTURA_MENU = 20;

export interface RenderResult {
  html: string;
  stats: { visuais: number; editaveis: number; travados: number; externos: number };
}

interface Font {
  family: string; px: number; bold: boolean; italic: boolean; underline: boolean; color: string;
}

const DEFAULT_FONT: Font = {
  family: 'Segoe UI', px: 12, bold: false, italic: false, underline: false, color: '#000000',
};

const VCL_COLORS: Record<string, string> = {
  clbtnface: '#f0f0f0', clwindow: '#ffffff', clwindowtext: '#000000', clwhite: '#ffffff',
  clblack: '#000000', clred: '#ff0000', clgreen: '#008000', clblue: '#0000ff',
  clyellow: '#ffff00', clsilver: '#c0c0c0', clgray: '#808080', clmaroon: '#800000',
  clnavy: '#000080', clolive: '#808000', clpurple: '#800080', clteal: '#008080',
  cllime: '#00ff00', claqua: '#00ffff', clfuchsia: '#ff00ff', clcream: '#fffbf0',
  clmoneygreen: '#c0dcc0', clskyblue: '#a6caf0', clbtnhighlight: '#ffffff',
  clbtnshadow: '#a0a0a0', cl3dlight: '#e3e3e3', clhighlight: '#0078d7', clinfobk: '#ffffe1',
};

const ALIGNMENT: Record<string, string> = {
  taleftjustify: 'left', tacenter: 'center', tarightjustify: 'right',
};
const TAB_POS: Record<string, string> = {
  tptop: 'top', tpbottom: 'bottom', tpleft: 'left', tpright: 'right',
};

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function cssColor(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('$')) {
    const n = parseInt(v.slice(1), 16);
    if (isNaN(n)) { return ''; }
    const hex = (x: number) => x.toString(16).padStart(2, '0');
    return `#${hex(n & 0xff)}${hex((n >> 8) & 0xff)}${hex((n >> 16) & 0xff)}`;
  }
  return VCL_COLORS[v.toLowerCase()] ?? '';
}

/** ParentFont: herda tudo e sobrescreve só as chaves Font.* declaradas. */
function fontOf(node: DfmNode, inherited: Font): Font {
  const own = [...node.props.keys()].filter(k => k.startsWith('font.'));
  if (!own.length) { return inherited; }
  const f = { ...inherited };
  if (node.props.has('font.name')) {
    f.family = `${txt(node, 'font.name')}, Segoe UI, sans-serif`;
  }
  if (node.props.has('font.height')) { f.px = Math.abs(num(node, 'font.height', -12)) || 12; }
  else if (node.props.has('font.size')) { f.px = Math.max(7, Math.round(num(node, 'font.size', 9) * 4 / 3)); }
  if (node.props.has('font.color')) { f.color = cssColor(txt(node, 'font.color')) || f.color; }
  if (node.props.has('font.style')) {
    const st = (node.props.get('font.style')!.raw || '').toLowerCase();
    f.bold = st.includes('fsbold');
    f.italic = st.includes('fsitalic');
    f.underline = st.includes('fsunderline');
  }
  return f;
}

function fontCss(f: Font, inherited: Font): string[] {
  const out: string[] = [];
  if (f.family !== inherited.family) { out.push(`font-family:${f.family}`); }
  if (f.px !== inherited.px) { out.push(`font-size:${f.px}px`); }
  if (f.bold !== inherited.bold) { out.push(`font-weight:${f.bold ? 700 : 400}`); }
  if (f.italic !== inherited.italic) { out.push(`font-style:${f.italic ? 'italic' : 'normal'}`); }
  if (f.underline !== inherited.underline) {
    out.push(`text-decoration:${f.underline ? 'underline' : 'none'}`);
  }
  if (f.color !== inherited.color) { out.push(`color:${f.color}`); }
  return out;
}

/** Texto que o componente mostra: próprio, ou o da Action ligada a ele. */
/**
 * O conteúdo de `Lines.Strings` e `Items.Strings`, com as quebras de linha preservadas.
 *
 * O `.dfm` guarda esses dois como lista de literais entre parênteses, um por linha. O `txt`
 * comum emenda tudo num string só — o que num `TMemo` produzia "…o NCMantes de emitir" —,
 * e num campo de uma linha isso nem aparece. Aqui cada literal vira uma linha de verdade.
 */
function linhasDe(n: DfmNode): string {
  const p = n.props.get('lines.strings') ?? n.props.get('items.strings');
  if (!p) { return ''; }
  return [...p.raw.matchAll(/'((?:[^']|'')*)'/g)]
    .map(m => m[1].replace(/''/g, "'"))
    .join(String.fromCharCode(10));
}

function captionOf(node: DfmNode, doc: DfmDocument): string {
  let cap = txt(node, 'caption') || txt(node, 'text');
  if (!cap && node.props.has('action')) {
    const act = doc.byName.get(txt(node, 'action'));
    if (act) { cap = txt(act, 'caption'); }
  }
  return cap ? stripAccel(cap.split('\n')[0]) : '';
}

function dataField(node: DfmNode): string {
  return txt(node, 'properties.editmask') || txt(node, 'editmask')
    || txt(node, 'databinding.datafield') || txt(node, 'datafield')
    || txt(node, 'properties.datafield');
}

const COLL_ITEM = /^[ \t]*item[ \t]*$([\s\S]*?)^[ \t]*end\b/gm;
const PROP_LINE = /^([\w.]+)\s*=\s*(.*)$/;

/** `<item A = 1 ... end ...>` -> lista de dicionários. Grids VCL declaram colunas assim. */
export function parseCollection(raw: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  COLL_ITEM.lastIndex = 0;
  for (const m of raw.matchAll(COLL_ITEM)) {
    const d: Record<string, string> = {};
    for (const line of m[1].split('\n')) {
      const p = PROP_LINE.exec(line.trim());
      if (p) { d[p[1].toLowerCase()] = p[2].trim(); }
    }
    items.push(d);
  }
  return items;
}

export interface Column { label: string; width: number; }

/** Colunas do grid, venham de objetos filhos (cx) ou de uma coleção (VCL). */
export function gridColumns(node: DfmNode, reg: Registry): Column[] {
  const views: DfmNode[] = [];
  const stack = [...node.kids];
  while (stack.length) {
    const n = stack.shift()!;
    const chain = reg.chain(n.cls);
    if (chain.some(c => c.includes('gridtableview') || c.includes('gridcardview')
                        || c.includes('gridbandedview'))) {
      views.push(n);
    }
    stack.push(...n.kids);
  }
  if (views.length) {
    const cols: Column[] = [];
    for (const k of views[0].kids) {
      const chain = reg.chain(k.cls);
      if (!chain.some(c => c.includes('gridcolumn') || c.includes('cardviewrow'))) { continue; }
      cols.push({
        label: txt(k, 'caption') || txt(k, 'databinding.fieldname') || k.name,
        width: num(k, 'width', 64),
      });
    }
    if (cols.length) { return cols; }
  }
  const coll = node.props.get('columns');
  if (coll) {
    return parseCollection(coll.raw).map(it => ({
      label: unquote(it['title.caption'] ?? it['caption'] ?? it['fieldname'] ?? '') || '(coluna)',
      width: /^\d+$/.test(it['width'] ?? '') ? parseInt(it['width'], 10) : 64,
    }));
  }
  return [];
}

/**
 * Linhas de um grid vertical (`TcxVerticalGrid`), na ordem e na hierarquia em que aparecem.
 *
 * Duas coisas que a primeira versao errava e ficam visiveis no form real:
 *
 * 1. o rotulo. `TcxDBMultiEditorRow` nao tem `Properties.Caption` — os textos moram na
 *    colecao `Properties.Editors`, um `Caption` por editor. Sem ler dali, a tela mostrava
 *    `MultiEditorRowIRValor` no lugar de "IR  Valor".
 * 2. a ordem. As linhas se ligam por `ID`/`ParentID`/`Index`, como os itens do
 *    `TdxLayoutControl` — a ordem do arquivo nao e a ordem da tela, e as linhas de uma
 *    categoria apareciam soltas em vez de sob ela.
 */
export interface LinhaVertical {
  label: string;
  cat: boolean;
  /** Profundidade sob a categoria, para o recuo. */
  nivel: number;
}

export function verticalRows(node: DfmNode, reg: Registry): LinhaVertical[] {
  interface Bruta {
    node: DfmNode;
    id: number;
    pai: number;
    indice: number;
    cat: boolean;
    filhos: Bruta[];
  }
  const porId = new Map<number, Bruta>();
  const todas: Bruta[] = [];
  const pilha = [...node.kids];
  while (pilha.length) {
    const n = pilha.shift()!;
    const cadeia = reg.chain(n.cls);
    if (cadeia.some(c => c.includes('customrow') || c.endsWith('categoryrow'))) {
      const b: Bruta = {
        node: n,
        id: num(n, 'id', -1),
        pai: num(n, 'parentid', -1),
        indice: num(n, 'index', todas.length),
        cat: cadeia.some(c => c.includes('categoryrow')),
        filhos: [],
      };
      todas.push(b);
      if (b.id >= 0) { porId.set(b.id, b); }
    }
    pilha.push(...n.kids);
  }
  if (!todas.length) { return []; }

  const raizes: Bruta[] = [];
  for (const b of todas) {
    const pai = b.pai >= 0 ? porId.get(b.pai) : undefined;
    if (pai && pai !== b) { pai.filhos.push(b); } else { raizes.push(b); }
  }
  const porIndice = (a: Bruta, b: Bruta): number => a.indice - b.indice;
  raizes.sort(porIndice);
  for (const b of todas) { b.filhos.sort(porIndice); }

  const out: LinhaVertical[] = [];
  const desce = (b: Bruta, nivel: number): void => {
    out.push({ label: rotuloDaLinha(b.node), cat: b.cat, nivel });
    for (const f of b.filhos) { desce(f, nivel + 1); }
  };
  for (const r of raizes) { desce(r, 0); }
  return out;
}

/** O texto que a linha mostra: caption proprio, os captions dos editores, ou o campo. */
function rotuloDaLinha(n: DfmNode): string {
  const proprio = txt(n, 'properties.caption') || txt(n, 'caption');
  if (proprio) { return proprio; }

  const editores = n.props.get('properties.editors');
  if (editores) {
    const textos = parseCollection(editores.raw)
      .map(it => unquote(it['caption'] ?? '') || unquote(it['databinding.fieldname'] ?? ''))
      .filter(Boolean);
    if (textos.length) { return textos.join('  '); }
  }
  return txt(n, 'properties.databinding.fieldname')
    || txt(n, 'databinding.fieldname') || n.name;
}

const ITEM_NAME = /ItemName\s*=\s*'([^']*)'/g;

/**
 * Botões da TdxBar ancorada num dock control. A barra aponta para o dock por nome, lista os
 * itens em `ItemLinks`, e o botão quase nunca tem Caption próprio — o texto vem da Action.
 */
export function toolbarItems(dock: DfmNode, doc: DfmDocument): string[] {
  for (const n of doc.byName.values()) {
    const p = n.props.get('dockcontrol');
    if (!p || p.raw.trim() !== dock.name || !n.props.has('itemlinks')) { continue; }
    const out: string[] = [];
    for (const m of n.props.get('itemlinks')!.raw.matchAll(ITEM_NAME)) {
      const item = doc.byName.get(m[1]);
      if (!item) { continue; }
      let cap = txt(item, 'caption');
      if (!cap && item.props.has('action')) {
        cap = txt(doc.byName.get(txt(item, 'action')) ?? item, 'caption');
      }
      out.push(stripAccel(cap || m[1]));
    }
    return out;
  }
  return [];
}

/** Itens de primeiro nível do menu principal, que ocupa faixa no topo do form. */
export function menuItems(doc: DfmDocument, reg: Registry): string[] {
  for (const n of doc.byName.values()) {
    if (n.cls.toLowerCase() === 'tmainmenu' || reg.chain(n.cls).includes('tmainmenu')) {
      return n.kids.filter(k => txt(k, 'caption') !== '-')
        .map(k => stripAccel(txt(k, 'caption', k.name)));
    }
  }
  return [];
}

const IMG_SIGS: [number[], string][] = [
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'], [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'], [[0x42, 0x4d], 'image/bmp'],
];

/**
 * Picture.Data / Glyph.Data guardam o bitmap em hex dentro do próprio .dfm. O blob vem
 * precedido de um cabeçalho do Delphi, então procuramos a assinatura em vez de assumir offset.
 */
export function embeddedImage(node: DfmNode): string | undefined {
  for (const key of ['picture.data', 'glyph.data', 'image.data']) {
    const p = node.props.get(key);
    if (!p) { continue; }
    const hex = (p.raw.match(/[0-9A-Fa-f]{8,}/g) ?? []).join('');
    if (hex.length < 64) { continue; }
    const bytes = Buffer.from(hex.slice(0, hex.length - (hex.length % 2)), 'hex');
    for (const [sig, mime] of IMG_SIGS) {
      const at = bytes.indexOf(Buffer.from(sig), 0);
      if (at >= 0 && at < 256) {
        return `data:${mime};base64,${bytes.subarray(at).toString('base64')}`;
      }
    }
  }
  return undefined;
}

/**
 * Tamanho da imagem de um `TdxLayoutImageItem`.
 *
 * O item raramente declara tamanho — quem manda é a imagem. O cabeçalho do PNG traz largura
 * e altura em dois inteiros de 32 bits logo depois do IHDR, e o do BMP nos offsets 18 e 22;
 * ler dali evita a imagem entrar com o tamanho errado e empurrar o resto do layout.
 */
export function dimensaoImagem(item: DfmNode, dataUri: string): [number, number] {
  const w = num(item, 'controloptions.originalwidth');
  const h = num(item, 'controloptions.originalheight');
  if (w && h) { return [w, h]; }
  const virgula = dataUri.indexOf(',');
  if (virgula < 0) { return [w, h]; }
  const bytes = Buffer.from(dataUri.slice(virgula + 1), 'base64');
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.length > 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return [bytes.readInt32LE(18), Math.abs(bytes.readInt32LE(22))];
  }
  return [w, h];
}

/**
 * Um data module não tem área visual: é uma superfície onde o designer guarda a posição do
 * ÍCONE de cada componente, em Left/Top. Como essas coordenadas são reais e gravadas, os
 * ícones se movem como qualquer outro componente.
 *
 * A mesma mecânica vale para a bandeja de não visuais de um form comum (D13).
 */
export function isDataModule(root: DfmNode, reg: Registry): boolean {
  if (reg.chain(root.cls).some(c => c.includes('datamodule') || c === 'tdatamod')) { return true; }
  // sem área cliente declarada e sem nenhum filho visual: é uma superfície de ícones
  return !root.props.has('clientwidth') && !root.kids.some(k => reg.isVisual(k));
}

/** Componentes que aparecem como ícone: filhos diretos, não visuais e com posição gravada. */
export function trayItems(root: DfmNode, reg: Registry): DfmNode[] {
  return root.kids.filter(k => !reg.isVisual(k) && k.props.has('left') && k.props.has('top'));
}

/**
 * P05 — todos os não visuais do form, venham de onde vierem.
 *
 * O Delphi desenha os ícones sobre o canvas, nas coordenadas gravadas. Aqui eles ficam numa
 * faixa abaixo do form: sobre o canvas eles cobririam controles reais, e o que se quer deles
 * é selecionar para inspecionar, não posicionar. Filhos de não visual (itens de menu, ações
 * de uma action list) ficam de fora — eles pertencem ao pai, e a árvore já os mostra.
 *
 * A faixa mostra só os filhos diretos do form. O que está aninhado num controle pertence a
 * ele — a view e o level de um `TcxGrid`, os itens de um menu, as ações de uma action list —
 * e aparece na árvore de estrutura, no lugar certo. Sem esse corte, um form grande como o
 * VendaMan enfileira 60 fichas e a faixa deixa de ajudar.
 */
export function naoVisuaisDoForm(root: DfmNode, reg: Registry): DfmNode[] {
  return root.kids.filter(n => !reg.isVisual(n));
}

function trayIcon(n: DfmNode, doc: DfmDocument, reg: Registry, painter: Painter): string {
  const x = num(n, 'left');
  const y = num(n, 'top');
  const editavel = doc.canOverride(n) && !doc.binary;
  painter.visuais++;
  if (editavel) { painter.editaveis++; } else { painter.travados++; }
  if (n.external) { painter.externos++; }
  const kids = n.kids.length;
  return `<div class="tray ${editavel ? 'drag' : 'ro'}" style="left:${x}px;top:${y}px" ` +
    `data-path="${esc(n.path)}" data-name="${esc(n.name)}" data-cls="${esc(n.cls)}" ` +
    `data-mode="${editavel ? 'free' : ''}" data-why="" ` +
    `data-inherited="${n.external ? 1 : 0}" ` +
    `title="${esc(`${n.name}: ${n.cls}${kids ? ` — ${kids} itens` : ''}`)}">` +
    `<i class="tico k-${reg.kind(n.cls)}"></i><em>${esc(n.name)}</em>` +
    (kids ? `<b>${kids}</b>` : '') +
    (editavel ? '<i class="grip g-se" data-dir="se"></i>' : '') + '</div>';
}

// ---- desenho ----

class Painter {
  out: string[] = [];
  visuais = 0; editaveis = 0; travados = 0; externos = 0;

  constructor(
    private doc: DfmDocument,
    private reg: Registry,
    private opts: RenderOptions,
  ) {}

  node(n: DfmNode, rect: Rect, inherited: Font, tabIndex?: number): void {
    const kind = this.reg.kind(n.cls);
    const font = fontOf(n, inherited);
    const kids = visualKids(n, this.reg);
    const rects = place(kids, rect.w, rect.h, this.reg, font.px, n);
    const tabs = kids.filter(k => this.reg.kind(k.cls) === 'tab');

    this.visuais++;
    if (n.external) { this.externos++; }
    const canWrite = this.doc.canOverride(n);
    const mode = !canWrite ? '' : this.doc.byControl.has(n) ? 'layout'
      : movable(n, this.reg) ? 'free' : '';
    if (mode) { this.editaveis++; } else { this.travados++; }

    const style = [
      `left:${rect.x}px`, `top:${rect.y}px`, `width:${rect.w}px`, `height:${rect.h}px`,
      ...fontCss(font, inherited),
    ];
    for (const key of ['color', 'style.color']) {
      const c = n.props.has(key) ? cssColor(n.props.get(key)!.raw) : '';
      if (c) { style.push(`background:${c}`); break; }
    }
    for (const key of ['alignment', 'properties.alignment.horz']) {
      const a = ALIGNMENT[txt(n, key, '').toLowerCase()];
      if (a) { style.push(`text-align:${a}`); break; }
    }
    if (['bsnone', 'cxcbsnone', 'ebsnone'].includes(txt(n, 'borderstyle', '').toLowerCase())) {
      style.push('border:0');
    }
    /*
     * A borda do container é o recuo da área cliente, e sai do que o `.dfm` declara.
     *
     * Um `TPanel` com `BevelOuter = bvNone` não recua nada; com `BorderWidth = 4` recua
     * quatro. Fixar 1px no CSS descontava mesmo quando o form dizia que não havia bevel — e
     * o erro somava a cada nível de aninhamento.
     */
    const recuo = insetCliente(n, this.reg);
    if (recuo.x || recuo.y) {
      style.push(`border-style:solid`, `border-color:transparent`,
                 `border-width:${recuo.y}px ${recuo.x}px ${recuo.x}px ${recuo.x}px`);
    }

    const cls = ['c', kind];
    /*
     * GroupBox e RadioGroup são família `panel`, mas não se DESENHAM como painel: o rótulo
     * deles fica no alto, à esquerda, recortando a moldura — e não centrado no meio, que é o
     * do `TPanel`. Sem separar os dois, o rótulo aparecia flutuando no centro do quadro, por
     * cima do conteúdo.
     */
    // o MESMO critério de `insetCliente`: quem reserva o espaço do rótulo e quem o desenha
    // têm de concordar, senão o texto cai fora da faixa que foi reservada para ele
    if (/groupbox|radiogroup/i.test(n.cls)) { cls.push('gb'); }
    /*
     * Marcado é informação do form, não enfeite: um grupo de rádios desenhado todo vazio não
     * diz qual opção é a padrão, que é metade do que se quer ver ao abrir a tela. `TCheckBox`
     * grava `State = cbChecked` além de `Checked`, e os dois valem.
     */
    if (kind === 'chk') {
      if (/radio/i.test(n.cls)) { cls.push('rad'); }
      const estado = txt(n, 'state', '').toLowerCase();
      if (flag(n, 'checked') === true || estado === 'cbchecked') { cls.push('on'); }
    }
    if (flag(n, 'visible') === false) { cls.push('invis'); }
    if (flag(n, 'default') === true) { cls.push('is-default'); }
    if (flag(n, 'cancel') === true) { cls.push('is-cancel'); }
    if (kind === 'splitter') {
      cls.push(['altop', 'albottom'].includes(txt(n, 'align', '').toLowerCase()) ? 'sp-h' : 'sp-v');
    }
    cls.push(mode === 'free' ? 'drag' : mode === 'layout' ? 'lay' : 'ro');

    const hint = n.props.has('hint') ? `\n${txt(n, 'hint')}` : '';
    const why = mode ? '' : this.whyLocked(n);
    let extra = tabs.length > 1 ? ' data-pages="1"' : '';
    if (tabIndex !== undefined) {
      extra += ` data-tab-pane="${tabIndex}"${tabIndex ? ' hidden' : ''}`;
    }

    this.out.push(
      `<div class="${cls.join(' ')}" style="${style.join(';')}" data-path="${esc(n.path)}" ` +
      `data-name="${esc(n.name)}" data-cls="${esc(n.cls)}" data-mode="${mode}" ` +
      `data-why="${esc(why)}" data-inherited="${n.external ? 1 : 0}" title="${esc(`${n.name}: ${n.cls}   ${rect.x},${rect.y}  ` +
        `${rect.w}x${rect.h}${hint}`)}"${extra}>`);
    // D02: uma alça por direção; a do canto sudeste continua sendo a padrão
    if (mode === 'free') {
      for (const d of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        this.out.push(`<i class="grip g-${d}" data-dir="${d}"></i>`);
      }
    } else if (mode) {
      this.out.push('<i class="grip g-se" data-dir="se"></i>');
    }

    // `HideTabs` some com a faixa; sem isso ela cobria o topo da página, que o `ClientRect`
    // do próprio `.dfm` já diz começar em 4 e não em 24.
    if (tabs.length > 1 && flag(n, 'properties.hidetabs') !== true) {
      const pos = TAB_POS[txt(n, 'tabposition', '').toLowerCase()] ?? 'top';
      this.out.push(`<div class="tabbar tb-${pos}">`);
      tabs.forEach((t, i) => this.out.push(
        `<span class="tabbtn${i ? '' : ' on'}" data-tab-btn="${i}">` +
        `${esc(txt(t, 'caption', t.name))}</span>`));
      this.out.push('</div>');
    }

    if (this.reg.chain(n.cls).includes('tdxdockcontrol')) {
      const items = toolbarItems(n, this.doc);
      if (items.length) {
        this.out.push(`<div class="tbar">${items.map(i => `<span>${esc(i)}</span>`).join('')}</div>`);
      }
    }

    if (kind === 'grid') {
      const rows = verticalRows(n, this.reg);
      if (rows.length) {
        // o recuo mostra a que categoria a linha pertence, que e o que a tela do Delphi faz
        this.out.push('<div class="vrows">' + rows.map(r =>
          `<div class="vrow${r.cat ? ' vcat' : ''}">` +
          `<span${r.nivel ? ` style="padding-left:${4 + r.nivel * 9}px"` : ''}>` +
          `${esc(r.label)}</span><i></i></div>`)
          .join('') + '</div>');
      } else {
        const cols = gridColumns(n, this.reg);
        if (cols.length) {
          this.out.push('<div class="ghead">' + cols.map(c =>
            `<span style="width:${c.width}px">${esc(c.label)}</span>`).join('') + '</div>');
        }
      }
    }

    if (kind === 'image') {
      const uri = embeddedImage(n);
      if (uri) { this.out.push(`<img class="emb" src="${uri}" alt="">`); }
    } else if (n.props.has('imageindex')) {
      this.out.push(`<span class="ico" title="ImageIndex ${num(n, 'imageindex', -1)}"></span>`);
    }

    const cap = tabIndex === undefined ? captionOf(n, this.doc) : '';
    const multi = cap ? '' : linhasDe(n);
    if (cap) { this.out.push(`<span class="cap">${esc(cap)}</span>`); }
    else if (multi) { this.out.push(`<span class="cap ml">${esc(multi)}</span>`); }
    else if (['edit', 'lbl', 'grid'].includes(kind)) {
      const df = dataField(n);
      if (df) { this.out.push(`<span class="cap ph">${esc(df)}</span>`); }
    }
    if (flag(n, 'properties.readonly') === true || flag(n, 'readonly') === true) {
      this.out.push('<span class="ro-mark" title="ReadOnly"></span>');
    }

    // sob layout control, o navegador refaz o layout como o engine faria
    const tree = this.opts.flexLayout && isLayoutHost(n, this.reg)
      ? layoutTree(n, this.reg) : null;
    if (tree) {
      this.layout(
        medirLayout(tree, this.reg, { x: 0, y: 0, w: rect.w, h: rect.h }, true,
          recuosDe(lookAndFeelDe(this.doc, n, this.reg))),
        font, true);
      this.out.push('</div>');
      return;
    }

    let ti = 0;
    for (const kid of kids) {
      const r = rects.get(kid)!;
      if (tabs.length > 1 && this.reg.kind(kid.cls) === 'tab') { this.node(kid, r, font, ti++); }
      else {
        this.node(kid, r, font);
        const [text, pos] = layoutCaption(this.doc.byControl.get(kid));
        if (text) { this.out.push(this.sideCaption(text, pos, r)); }
      }
    }
    this.out.push('</div>');
  }

  private sideCaption(text: string, pos: string, r: Rect): string {
    const anchor = pos === 'right' ? `left:${r.x + r.w + 5}px;top:${r.y + 3}px`
      : pos === 'top' ? `left:${r.x}px;top:${r.y - 15}px`
      : pos === 'bottom' ? `left:${r.x}px;top:${r.y + r.h + 2}px`
      : `left:${r.x - 5}px;top:${r.y + 3}px;transform:translateX(-100%)`;
    return `<span class="lcap" style="${anchor}">${esc(text)}</span>`;
  }

  /**
   * Desenha a árvore do `TdxLayoutControl` a partir das medidas já resolvidas.
   *
   * Os retângulos vêm de `medirLayout`, e são absolutos dentro do grupo que os contém — o
   * mesmo modelo do modo gravado. A versão anterior emitia `display:flex` e deixava o cálculo
   * para o navegador; o custo apareceu no aninhamento, porque um container esticado pelo CSS
   * não conta o tamanho novo para os próprios filhos, que já haviam sido posicionados com o
   * antigo. Um `TdxLayoutControl` dentro de uma aba ficava com a largura gravada no ancestral
   * e cortava o conteúdo. Com a medida em mãos, o filho recebe o número certo.
   */
  private layout(m: Medida, font: Font, topo: boolean, aba?: number): void {
    const n = m.info.node;
    if (flag(n, 'visible') === false) { return; }
    const r = m.rect;
    const caixa = [`left:${r.x}px`, `top:${r.y}px`, `width:${r.w}px`, `height:${r.h}px`];
    const pagina = aba === undefined ? '' : ` data-tab-pane="${aba}"${aba ? ' hidden' : ''}`;

    if (m.info.group) {
      const [cap] = layoutCaption(n);
      const borda = flag(n, 'showborder') !== false && !!cap;
      const style = ['position:absolute', ...caixa, 'box-sizing:border-box'];
      // só a raiz rola: um grupo interno com barra de rolagem esconde o transbordo real
      if (topo) { style.push('overflow:auto'); }
      if (borda) { style.push('border:1px solid #c8c8c8'); }
      this.out.push(`<div class="lgroup" data-path="${esc(n.path)}" data-name="${esc(n.name)}" ` +
        `data-cls="${esc(n.cls)}" style="${style.join(';')}"${pagina}` +
        `${m.abas ? ' data-pages="1"' : ''}>`);
      if (borda) { this.out.push(`<span class="lgcap">${esc(cap)}</span>`); }
      // `ldTabbed`: as páginas se sobrepõem, e a faixa segue o mesmo contrato do PageControl
      if (m.abas) {
        this.out.push('<div class="tabbar tb-top">');
        m.abas.forEach((rotulo, i) => this.out.push(
          `<span class="tabbtn${i ? '' : ' on'}" data-tab-btn="${i}">${esc(rotulo)}</span>`));
        this.out.push('</div>');
      }
      m.filhos.forEach((kid, i) => this.layout(kid, font, false, m.abas ? i : undefined));
      this.out.push('</div>');
      return;
    }

    this.out.push(`<div class="litem" style="position:absolute;${caixa.join(';')}"${pagina}>`);
    if (m.caption) {
      const c = m.caption.rect;
      const alinha = m.caption.pos === 'left' ? 'text-align:right;' : '';
      this.out.push(`<span class="lcap-i" style="position:absolute;left:${c.x}px;top:${c.y}px;` +
        `width:${c.w}px;${alinha}">${esc(m.caption.texto)}</span>`);
    }
    if (!m.controle) {
      /*
       * Item sem `Control`. Nem todos são vazios: o `TdxLayoutImageItem` carrega a imagem
       * dentro do próprio item, em `Image.Data` — é assim que a logo de uma tela de login
       * chega ao form, sem nenhum TImage no meio. Sem tratar aqui, ela some.
       */
      const img = embeddedImage(n);
      if (img) {
        const [iw, ih] = dimensaoImagem(n, img);
        this.out.push(
          `<img class="limg" src="${img}" alt="${esc(n.name)}"` +
          (iw ? ` width="${iw}"` : '') + (ih ? ` height="${ih}"` : '') + '></div>');
        return;
      }
      this.out.push(`<span class="${n.cls.toLowerCase().includes('separator') ? 'lsep' : 'llabel'}">` +
        '</span></div>');
      return;
    }
    this.node(m.controle.node, m.controle.rect, font);
    this.out.push('</div>');
  }

  private whyLocked(n: DfmNode): string {
    if (!this.doc.canOverride(n)) {
      return `vem de ${n.uri.split(/[\\/]/).pop()} e não pode ser sobrescrito aqui`;
    }
    if (inLayout(n, this.reg)) {
      return 'sob TdxLayoutControl sem TdxLayoutItem próprio';
    }
    if (n.props.has('align')) {
      return `Align=${txt(n, 'align')}: Left/Top não valem`;
    }
    return 'sem Left/Top próprios';
  }
}

export function renderForm(
  doc: DfmDocument, reg: Registry, opts: RenderOptions,
): RenderResult {
  const root = doc.root;
  if (isDataModule(root, reg)) { return renderDataModule(doc, reg, opts); }
  const w = num(root, 'clientwidth') || num(root, 'width', 400);
  let h = num(root, 'clientheight') || num(root, 'height', 300);
  const font = fontOf(root, DEFAULT_FONT);

  const menu = menuItems(doc, reg);
  const menuH = menu.length ? ALTURA_MENU : 0;
  h -= menuH;

  const kids = visualKids(root, reg);
  const rects = place(kids, w, h, reg, font.px, root);
  const painter = new Painter(doc, reg, opts);
  for (const kid of kids) {
    const r = rects.get(kid)!;
    painter.node(kid, r, font);
    const [text, pos] = layoutCaption(doc.byControl.get(kid));
    if (text) {
      const anchor = pos === 'top' ? `left:${r.x}px;top:${r.y - 15}px`
        : `left:${r.x - 5}px;top:${r.y + 3}px;transform:translateX(-100%)`;
      painter.out.push(`<span class="lcap" style="${anchor}">${esc(text)}</span>`);
    }
  }

  const naoVisuais = [...walk(root)].filter(n => n !== root && !reg.isVisual(n)).length;
  const bandeja = naoVisuaisDoForm(root, reg);
  const faixa = bandeja.length
    ? `<div class="nv-tray" style="width:${w}px">` +
      `<div class="nv-h">não visuais<b>${bandeja.length}</b></div>` +
      bandeja.map(n => nvChip(n, doc, reg)).join('') + '</div>'
    : '';
  const body =
    `<div class="wrap"><div class="form" style="width:${w}px;height:${h + ALTURA_TITULO + menuH}px">` +
    `<div class="title">${esc(txt(root, 'caption', root.name))}</div>` +
    (menu.length ? `<div class="menubar">${menu.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : '') +
    `<div class="client" style="left:0;top:${ALTURA_TITULO + menuH}px;width:${w}px;height:${h}px">` +
    painter.out.join('') +
    '</div><i class="grip g-se form-grip" data-dir="se" ' +
    'title="arrastar redimensiona o form (Anchors acompanham)"></i>' +
    '</div>' + faixa + '</div>';

  const bar =
    `<div class="bar"><b>${esc(root.name || root.cls)}</b>` +
    `<span>${esc(root.cls)}</span>` + BOTOES_BARRA +
    `<span class="sp"></span><span id="stats"></span>` +
    `<span class="sp"></span><span id="st" class="st"></span></div>`;
  const painel =
    '<div id="side">' +
    `<div class="pane-h">ESTRUTURA<span id="st-info"></span></div><div id="struct"></div>` +
    '<div class="pane-h">PROPRIEDADES</div>' +
    '<div id="oi"><div class="oi-empty">selecione um componente</div></div>' +
    '</div>';

  const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${'${cspSource}'} 'unsafe-inline'; script-src 'nonce-${opts.nonce}';">
<link rel="stylesheet" href="${opts.cssUri}"></head>
<body class="has-side" data-visuais="${painter.visuais}" data-naovisuais="${naoVisuais}" data-flex="${opts.flexLayout ? 1 : 0}">
${bar}${FAIXA_PALETA}${painel}${body}
<div id="guides"></div><div id="lasso" hidden></div><div id="ctx" hidden></div>
<div id="dlg" hidden></div><div id="hud" hidden></div>
<script nonce="${opts.nonce}" src="${opts.jsUri}"></script>
<script nonce="${opts.nonce}" src="${opts.inspetorUri}"></script>
<script nonce="${opts.nonce}" src="${opts.paletaUri}"></script>
<script nonce="${opts.nonce}" src="${opts.dialogosUri}"></script>
</body></html>`;

  return {
    html,
    stats: {
      visuais: painter.visuais, editaveis: painter.editaveis,
      travados: painter.travados, externos: painter.externos,
    },
  };
}

/** Ficha de um componente não visual na faixa abaixo do form. */
function nvChip(n: DfmNode, doc: DfmDocument, reg: Registry): string {
  const kids = n.kids.length;
  const editavel = doc.canOverride(n) && !doc.binary;
  return `<div class="nv-i${n.external ? ' ro' : ''}" data-path="${esc(n.path)}" ` +
    `data-name="${esc(n.name || n.cls)}" data-cls="${esc(n.cls)}" ` +
    `data-mode="" data-why="não visual: sem posição na tela" ` +
    `data-inherited="${n.external ? 1 : 0}" ` +
    `title="${esc(`${n.name}: ${n.cls}`)}${editavel ? '' : ' (somente leitura)'}">` +
    `<i class="tico k-${reg.kind(n.cls)}"></i><em>${esc(n.name || n.cls)}</em>` +
    (kids ? `<b>${kids}</b>` : '') + '</div>';
}

/** Desenha um data module: a superfície com os ícones dos componentes. */
function renderDataModule(
  doc: DfmDocument, reg: Registry, opts: RenderOptions,
): RenderResult {
  const root = doc.root;
  const w = num(root, 'width', 420);
  const h = num(root, 'height', 280);
  const painter = new Painter(doc, reg, opts);
  const itens = trayItems(root, reg);
  const corpo = itens.map(n => trayIcon(n, doc, reg, painter)).join('');
  const semPos = root.kids.filter(k => !itens.includes(k)).length;

  const body =
    `<div class="wrap"><div class="form dm" style="width:${w}px;height:${h + 26}px">` +
    `<div class="title">${esc(root.name)} — data module</div>` +
    `<div class="client dm-surface" style="left:0;top:${ALTURA_TITULO}px;` +
    `width:${w}px;height:${h}px">` +
    corpo + '</div></div></div>';

  const bar =
    `<div class="bar"><b>${esc(root.name || root.cls)}</b><span>${esc(root.cls)}</span>` +
    BOTOES_BARRA +
    `<span class="sp"></span><span id="stats"></span>` +
    `<span class="sp"></span><span id="st" class="st"></span></div>`;
  const painel =
    '<div id="side">' +
    `<div class="pane-h">ESTRUTURA<span id="st-info"></span></div><div id="struct"></div>` +
    '<div class="pane-h">PROPRIEDADES</div>' +
    '<div id="oi"><div class="oi-empty">selecione um componente</div></div></div>';

  const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${'${cspSource}'} 'unsafe-inline'; script-src 'nonce-${opts.nonce}';">
<link rel="stylesheet" href="${opts.cssUri}"></head>
<body class="has-side" data-visuais="${painter.visuais}" data-naovisuais="${semPos}" data-flex="0">
${bar}${FAIXA_PALETA}${painel}${body}
<div id="guides"></div><div id="lasso" hidden></div><div id="ctx" hidden></div>
<div id="dlg" hidden></div><div id="hud" hidden></div>
<script nonce="${opts.nonce}" src="${opts.jsUri}"></script>
<script nonce="${opts.nonce}" src="${opts.inspetorUri}"></script>
<script nonce="${opts.nonce}" src="${opts.paletaUri}"></script>
<script nonce="${opts.nonce}" src="${opts.dialogosUri}"></script>
</body></html>`;

  return {
    html,
    stats: {
      visuais: painter.visuais, editaveis: painter.editaveis,
      travados: painter.travados, externos: painter.externos,
    },
  };
}

export type { Kind };
