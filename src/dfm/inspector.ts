/**
 * O que o Object Inspector mostra para um componente.
 *
 * Ficava dentro do editor.ts como uma função só. Saiu para cá porque a tipagem das linhas
 * cresceu — cor, lista de strings, coleção, referência a outro componente, conjunto — e cada
 * uma dessas decisões precisa de teste sem subir uma janela do VS Code.
 */

import { DfmNode, PropKind, Prop, propKind, txt, unquote, walk } from './model';
import { DfmDocument } from './document';
import { Registry } from './registry';
import { ADDABLE } from './edit';
import { descreverItem, itensDaColecao } from './blocks';
import { layoutCaption } from './layout';

export type RowType = PropKind | 'color' | 'strings' | 'collection' | 'ref';

export interface Row {
  key: string;
  label: string;
  cat: string;
  type: RowType;
  /** Valor já legível: string sem aspas, inteiro, nome do enum. */
  value: string;
  scope: 'control' | 'item';
  enum?: string[];
  /** Nomes de componentes aceitáveis, quando a propriedade aponta para outro componente. */
  refs?: string[];
  /** Valores possíveis de um conjunto `[a,b]`, com os que estão ligados. */
  setItems?: { nome: string; on: boolean }[];
  /** Conteúdo de `Lines.Strings = (...)`. */
  lines?: string[];
  /** Resumo dos itens de uma coleção `<item ... end>`. */
  items?: string[];
  /** Cor em #rrggbb, quando dá para resolver. */
  color?: string;
  from: string;
  own: boolean;
  absent?: boolean;
  event: boolean;
  /** I07 — `Font.Name` vira grupo `Font`, sub `Name`. */
  group?: string;
  sub?: string;
  /** Linha do arquivo e quantas linhas o valor ocupa — para reescrever blocos. */
  line?: number;
  span?: number;
}

const CATEGORIAS: [string, string[]][] = [
  ['Layout', ['left', 'top', 'width', 'height', 'align', 'anchors', 'alignhorz', 'alignvert',
    'index', 'parent', 'constraints', 'margins', 'padding', 'explicit', 'sizeoptions',
    'controloptions', 'autosize', 'position', 'tabposition', 'designsize']],
  ['Texto', ['caption', 'text', 'lines', 'hint', 'font', 'parentfont', 'alignment',
    'captionoptions', 'wordwrap']],
  ['Aparência', ['color', 'style', 'bevel', 'border', 'transparent', 'imageindex', 'glyph',
    'picture', 'lookandfeel', 'parentcolor', 'parentbackground', 'visible']],
  ['Dados', ['databinding', 'datasource', 'datafield', 'dataset', 'properties', 'columns',
    'items', 'listcolumns', 'keyfield']],
  ['Comportamento', ['enabled', 'taborder', 'tabstop', 'readonly', 'modalresult', 'default',
    'cancel', 'action', 'popupmenu', 'showhint', 'dragmode', 'options']],
];

export function categoria(label: string): string {
  const low = label.toLowerCase();
  for (const [nome, chaves] of CATEGORIAS) {
    if (chaves.some(k => low === k || low.startsWith(k))) { return nome; }
  }
  return 'Outras';
}

export const ENUM_VALUES: Record<string, string[]> = {
  align: ['alNone', 'alTop', 'alBottom', 'alLeft', 'alRight', 'alClient', 'alCustom'],
  alignment: ['taLeftJustify', 'taCenter', 'taRightJustify'],
  alignhorz: ['ahLeft', 'ahRight', 'ahCenter', 'ahClient', 'ahParentManaged'],
  alignvert: ['avTop', 'avBottom', 'avCenter', 'avClient', 'avParentManaged'],
  borderstyle: ['bsNone', 'bsSingle'],
  tabposition: ['tpTop', 'tpBottom', 'tpLeft', 'tpRight'],
  layoutdirection: ['ldHorizontal', 'ldVertical', 'ldTabbed'],
  'captionoptions.layout': ['clLeft', 'clTop', 'clRight', 'clBottom'],
  modalresult: ['mrNone', 'mrOk', 'mrCancel', 'mrYes', 'mrNo', 'mrAbort', 'mrRetry'],
  bevelinner: ['bvNone', 'bvLowered', 'bvRaised', 'bvSpace'],
  bevelouter: ['bvNone', 'bvLowered', 'bvRaised', 'bvSpace'],
  dragmode: ['dmManual', 'dmAutomatic'],
  cursor: ['crDefault', 'crArrow', 'crHourGlass', 'crIBeam', 'crHandPoint', 'crSizeAll'],
};

/** Valores possíveis de conjuntos comuns — é o que permite marcar com caixinha (I04). */
export const SET_VALUES: Record<string, string[]> = {
  'font.style': ['fsBold', 'fsItalic', 'fsUnderline', 'fsStrikeOut'],
  anchors: ['akLeft', 'akTop', 'akRight', 'akBottom'],
  bordericons: ['biSystemMenu', 'biMinimize', 'biMaximize', 'biHelp'],
};

/*
 * Cores nomeadas da VCL. As `clSys*` dependem do tema do Windows e não têm valor fixo: o hex
 * abaixo é o do tema claro padrão, só para a amostra na tela não ficar vazia — quem grava é
 * sempre o nome, nunca o hex resolvido.
 */
const CORES: Record<string, string> = {
  clblack: '#000000', clmaroon: '#800000', clgreen: '#008000', clolive: '#808000',
  clnavy: '#000080', clpurple: '#800080', clteal: '#008080', clgray: '#808080',
  clsilver: '#c0c0c0', clred: '#ff0000', cllime: '#00ff00', clyellow: '#ffff00',
  clblue: '#0000ff', clfuchsia: '#ff00ff', claqua: '#00ffff', clwhite: '#ffffff',
  clmoneygreen: '#c0dcc0', clskyblue: '#a6caf0', clcream: '#fffbf0', clmedgray: '#a0a0a4',
  clbtnface: '#f0f0f0', clbtnshadow: '#a0a0a0', clbtnhighlight: '#ffffff',
  clwindow: '#ffffff', clwindowtext: '#000000', clwindowframe: '#646464',
  clhighlight: '#0078d7', clhighlighttext: '#ffffff',
  clinfobk: '#ffffe1', clinfotext: '#000000', clmenu: '#f0f0f0', clmenutext: '#000000',
  clcaptiontext: '#000000', clinactivecaption: '#bfcddb', clappworkspace: '#ababab',
  cl3dlight: '#e3e3e3', cl3ddkshadow: '#696969', clgraytext: '#6d6d6d',
  clscrollbar: '#c8c8c8', clbackground: '#000000', clactivecaption: '#99b4d1',
  clnone: '', cldefault: '',
};

export const NOMES_DE_COR = Object.keys(CORES).filter(k => CORES[k]);

/** `$00BBGGRR` ou `clRed` -> `#rrggbb`. Devolve vazio quando não dá para resolver. */
export function corHex(raw: string): string {
  const v = raw.trim();
  const m = /^\$([0-9A-Fa-f]{1,8})$/.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    if (n & 0xff000000) { return ''; }   // cor de sistema codificada: não é RGB
    const b = (n >> 16) & 0xff, g = (n >> 8) & 0xff, r = n & 0xff;
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  return CORES[v.toLowerCase()] ?? '';
}

/** `#rrggbb` -> `$00BBGGRR`, que é como o Delphi grava. */
export function corDfm(hex: string): string {
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!m) { throw new Error(`cor inválida: ${hex}`); }
  const r = m[1].slice(0, 2), g = m[1].slice(2, 4), b = m[1].slice(4, 6);
  return ('$00' + b + g + r).toUpperCase();
}

function ehCor(key: string, raw: string): boolean {
  const v = raw.trim();
  if (/^\$[0-9A-Fa-f]{1,8}$/.test(v) && /color|cor$/i.test(key)) { return true; }
  return /^cl[A-Z]/.test(v);
}

/** Base esperada por propriedades que apontam para outro componente (I08). */
const REFS: Record<string, string> = {
  datasource: 'TComponent', dataset: 'TDataSet', popupmenu: 'TPopupMenu',
  action: 'TBasicAction', actionlist: 'TActionList', images: 'TCustomImageList',
  imagelist: 'TCustomImageList', smallimages: 'TCustomImageList',
  largeimages: 'TCustomImageList', disabledimages: 'TCustomImageList',
  hotimages: 'TCustomImageList', focuscontrol: 'TControl', control: 'TControl',
  'databinding.datasource': 'TComponent', 'properties.images': 'TCustomImageList',
};

/** `(\n'a'\n'b')` -> `['a','b']`. */
export function lerStrings(raw: string): string[] {
  const corpo = raw.trim().replace(/^\(/, '').replace(/\)$/, '');
  return corpo.split('\n').map(l => l.trim()).filter(Boolean).map(unquote);
}

function tipoDe(key: string, p: Prop): RowType {
  const kind = propKind(p.raw);
  if (kind === 'block') {
    const c = p.raw.trim()[0];
    if (c === '(') { return 'strings'; }
    if (c === '<') { return 'collection'; }
    return 'block';
  }
  if (ehCor(key, p.raw)) { return 'color'; }
  if (kind === 'enum' && REFS[key]) { return 'ref'; }
  return kind;
}

/** Componentes do form que servem de destino para uma propriedade de referência. */
function candidatos(doc: DfmDocument, reg: Registry, base: string): string[] {
  const nomes: string[] = [];
  for (const n of walk(doc.root)) {
    if (!n.name || n === doc.root) { continue; }
    if (base === 'TComponent' || reg.isA(n.cls, base)) { nomes.push(n.name); }
  }
  return nomes.sort();
}

/**
 * A05 — só oferece a lista do índice quando o valor gravado está nela.
 *
 * O casamento entre propriedade e tipo é por nome, subindo a herança, e nome se repete: o
 * `BorderStyle` de um form e o de um edit são enumerações diferentes. Quando a lista não
 * contém o que o `.dfm` gravou, ela é de outro tipo — e uma lista errada no inspetor é pior
 * que lista nenhuma, porque convida a gravar um valor que não compila.
 */
function valoresConfiaveis(
  reg: Registry, cls: string, prop: string, chave: string, atual: string,
): string[] | undefined {
  const cabe = (v: string[] | undefined): string[] | undefined =>
    v && (!atual || v.some(x => x.toLowerCase() === atual.toLowerCase())) ? v : undefined;
  // o índice primeiro; a tabela conhecida como reserva — as duas passam pela mesma conferência
  return cabe(reg.valoresDe(cls, prop)) ?? cabe(ENUM_VALUES[chave]);
}

function montarLinha(
  doc: DfmDocument, reg: Registry, key: string, p: Prop, scope: 'control' | 'item',
  dono: DfmNode,
): Row {
  const type = tipoDe(key, p);
  const ponto = p.label.indexOf('.');
  /*
   * A05 — os valores vêm do índice quando ele os conhece.
   *
   * A tabela `ENUM_VALUES` só sabe o que alguém escreveu nela; o índice sabe o que a unit
   * declarou e o que o RTTI do pacote expõe. Um `Variant = bvPrimary` de componente de
   * terceiro não estaria em tabela nenhuma.
   */
  const listaEnum = valoresConfiaveis(reg, dono.cls, p.label, key, p.raw.trim());
  const row: Row = {
    key, label: p.label, cat: categoria(p.label), type,
    value: type === 'str' ? unquote(p.raw) : p.raw.trim(),
    scope, enum: listaEnum,
    from: p.uri.split(/[\\/]/).pop() ?? '', own: p.uri === doc.uri,
    event: /^on[a-z]/i.test(p.label),
    line: p.line, span: p.raw.split('\n').length,
  };
  if (ponto > 0) {
    row.group = p.label.slice(0, ponto);
    row.sub = p.label.slice(ponto + 1);
  }
  if (type === 'color') { row.color = corHex(p.raw); row.value = p.raw.trim(); }
  if (type === 'strings') { row.lines = lerStrings(p.raw); row.value = `${row.lines.length} linhas`; }
  if (type === 'collection') {
    row.items = itensDaColecao(p.raw).map(descreverItem);
    row.value = `${row.items.length} itens`;
  }
  if (type === 'set') {
    const ligados = new Set(p.raw.replace(/[[\]]/g, '').split(',')
      .map(s => s.trim()).filter(Boolean));
    const conhecidos = SET_VALUES[key] ?? [...ligados];
    row.setItems = conhecidos.map(nome => ({ nome, on: ligados.has(nome) }));
  }
  if (type === 'ref') { row.refs = candidatos(doc, reg, REFS[key]); }
  return row;
}

export interface Inspecao {
  name: string;
  cls: string;
  file: string;
  editable: boolean;
  via: string;
  item: string | null;
  rows: Row[];
  groups: { name: string; cls: string; path: string; caption: string }[];
  crumbs: { name: string; path: string }[];
  /** Quantos componentes esta inspeção cobre — >1 é edição em lote (I10). */
  alvos: number;
}

export function inspect(doc: DfmDocument, node: DfmNode, reg: Registry): Inspecao {
  const rows: Row[] = [];
  for (const key of [...node.props.keys()].sort()) {
    rows.push(montarLinha(doc, reg, key, node.props.get(key)!, 'control', node));
  }
  for (const label of Object.keys(ADDABLE).sort()) {
    const key = label.toLowerCase();
    if (!node.props.has(key)) {
      const tipo = ADDABLE[label];
      rows.push({
        key, label, cat: categoria(label), type: tipo,
        // conjunto ausente ainda precisa das opções, ou a caixa abre vazia
        value: tipo === 'set' ? '[]' : '', setItems: tipo === 'set'
          ? (SET_VALUES[key] ?? []).map(nome => ({ nome, on: false })) : undefined,
        scope: 'control', absent: true,
        // propriedade ausente não tem valor para conferir: vale a tabela conhecida
        enum: ENUM_VALUES[key] ?? reg.valoresDe(node.cls, label),
        from: '', own: true, event: false,
      });
    }
  }
  const item = doc.byControl.get(node);
  if (item) {
    for (const key of [...item.props.keys()].sort()) {
      rows.push(montarLinha(doc, reg, key, item.props.get(key)!, 'item', item));
    }
  }

  // grupos de layout acima: é onde moram os captions das seções, invisíveis na tela
  const groups: Inspecao['groups'] = [];
  let cur = item ? txt(item, 'parent', '') : '';
  const vistos = new Set<string>();
  while (cur && !vistos.has(cur)) {
    vistos.add(cur);
    const g = doc.byName.get(cur);
    if (!g) { break; }
    groups.push({ name: g.name, cls: g.cls, path: g.path, caption: layoutCaption(g)[0] ?? '' });
    cur = txt(g, 'parent', '');
  }

  const crumbs: Inspecao['crumbs'] = [];
  for (let n: DfmNode | null = node; n; n = n.parent) {
    crumbs.unshift({ name: n.name || n.cls, path: n.path });
  }
  const target = doc.writeTarget(node);
  return {
    name: node.name, cls: node.cls, file: node.uri.split(/[\\/]/).pop() ?? '',
    editable: doc.canOverride(node) && !doc.binary,
    via: target && target !== node ? 'bloco inherited neste .dfm' : '',
    item: item?.name ?? null, rows, groups, crumbs, alvos: 1,
  };
}

const VARIOS = '(vários)';

/**
 * I10 — inspeção de vários componentes ao mesmo tempo.
 *
 * Só sobrevive o que todos têm: mesma chave, mesmo escopo, mesmo tipo. Valores diferentes
 * viram `(vários)` e, se o usuário gravar por cima, todos recebem o mesmo valor — que é
 * exatamente o comportamento do inspetor do Delphi.
 */
export function inspectMany(
  doc: DfmDocument, nodes: DfmNode[], reg: Registry,
): Inspecao {
  if (!nodes.length) { throw new Error('nada selecionado'); }
  if (nodes.length === 1) { return inspect(doc, nodes[0], reg); }

  const todas = nodes.map(n => inspect(doc, n, reg));
  const chave = (r: Row): string => `${r.scope}:${r.key}`;
  const primeiro = new Map(todas[0].rows.map(r => [chave(r), r]));
  const rows: Row[] = [];

  for (const [k, base] of primeiro) {
    const iguais = todas.map(i => i.rows.find(r => chave(r) === k));
    if (iguais.some(r => !r || r.type !== base.type)) { continue; }
    const valores = new Set(iguais.map(r => r!.value));
    const absent = iguais.every(r => r!.absent);
    // bloco só faz sentido individualmente: lista de strings de dois memos não se funde
    if (base.type === 'strings' || base.type === 'collection' || base.type === 'block') { continue; }
    rows.push({
      ...base,
      value: valores.size === 1 ? base.value : VARIOS,
      color: valores.size === 1 ? base.color : '',
      own: iguais.every(r => r!.own),
      absent,
      line: undefined, span: undefined,
    });
  }

  const nomes = nodes.map(n => n.name || n.cls);
  const classes = new Set(nodes.map(n => n.cls));
  return {
    name: nomes.join(', '),
    cls: classes.size === 1 ? [...classes][0] : `${classes.size} classes`,
    file: '', editable: todas.every(i => i.editable), via: '', item: null,
    rows, groups: [], crumbs: [], alvos: nodes.length,
  };
}

export { VARIOS };
