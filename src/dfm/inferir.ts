/**
 * A01 — descobrir a família de um componente pelo que ele declara, não pelo nome.
 *
 * As duas tabelas que existiam antes — ancestral conhecido e substring de nome — cobrem bem
 * o que já foi previsto e nada do que aparece depois. Um `TdxRibbon` cai em `panel`, e um
 * componente novo de qualquer fabricante cai onde o nome mandar.
 *
 * As propriedades publicadas dizem mais. Um controle que publica `Columns` junto de um
 * `DataSource` é uma grade, tenha o nome que tiver; um que publica `ModalResult` é um botão.
 * Isso vale para fonte e para binário, porque o RTTI de um `.bpl` traz a mesma lista.
 *
 * A ordem das regras é a ordem de especificidade: a primeira que casa decide. Uma regra
 * genérica antes de uma específica classificaria toda grade como painel.
 */

import { Kind } from './registry';

export interface Regra {
  kind: Kind;
  /** Todas precisam estar presentes. */
  exige: string[];
  /** Nenhuma pode estar presente — é o que separa rótulo de campo de edição. */
  proibe?: string[];
  motivo: string;
}

export const REGRAS: Regra[] = [
  // grades: o que tem célula em linha e coluna, com ou sem dataset atrás
  { kind: 'grid', exige: ['columns', 'datasource'], motivo: 'colunas ligadas a um dataset' },
  { kind: 'grid', exige: ['datacontroller'], motivo: 'controlador de dados do cx' },
  { kind: 'grid', exige: ['colcount', 'rowcount'], motivo: 'grade de linhas e colunas' },
  { kind: 'grid', exige: ['fixedcols'], motivo: 'grade com colunas fixas' },
  { kind: 'grid', exige: ['viewstyle', 'columns'], motivo: 'lista em colunas' },
  { kind: 'grid', exige: ['items', 'viewstyle'], motivo: 'lista com modo de exibição' },
  { kind: 'grid', exige: ['showroot', 'indent'], motivo: 'árvore com recuo' },
  { kind: 'grid', exige: ['treecolumns'], motivo: 'árvore em colunas' },
  { kind: 'grid', exige: ['views', 'levels'], motivo: 'grade de várias visões' },

  // marcação
  { kind: 'chk', exige: ['checked', 'caption'], proibe: ['modalresult', 'items'],
    motivo: 'marcação com rótulo' },
  { kind: 'chk', exige: ['state', 'allowgrayed'], proibe: ['items'], motivo: 'três estados' },

  // botões
  { kind: 'btn', exige: ['modalresult'], proibe: ['bordericons'], motivo: 'resultado de diálogo' },
  { kind: 'btn', exige: ['default', 'cancel', 'caption'], proibe: ['bordericons'],
    motivo: 'botão padrão/cancelar' },
  { kind: 'btn', exige: ['glyph', 'caption'], motivo: 'rótulo com ícone' },
  { kind: 'btn', exige: ['groupindex', 'allup'], motivo: 'botão de barra' },

  { kind: 'image', exige: ['picture'], proibe: ['columns'], motivo: 'carrega uma imagem' },
  { kind: 'progress', exige: ['position', 'max', 'min'], proibe: ['increment', 'columns'],
    motivo: 'faixa de progresso' },
  { kind: 'spin', exige: ['increment', 'value'], motivo: 'incremento numérico' },

  // entrada de texto e listas de opção
  { kind: 'edit', exige: ['lines'], proibe: ['columns'], motivo: 'texto de várias linhas' },
  { kind: 'edit', exige: ['items', 'itemindex'], proibe: ['columns', 'viewstyle'],
    motivo: 'lista de opções' },
  { kind: 'edit', exige: ['editvalue'], motivo: 'editor de valor do cx' },
  { kind: 'edit', exige: ['text', 'maxlength'], motivo: 'entrada de texto' },
  { kind: 'edit', exige: ['datafield', 'datasource'], proibe: ['columns'],
    motivo: 'campo ligado a dados' },

  // rótulos: o que mostra texto e não recebe foco
  { kind: 'lbl', exige: ['caption', 'transparent'], proibe: ['taborder', 'items'],
    motivo: 'rótulo sem foco' },
  { kind: 'lbl', exige: ['caption', 'wordwrap'], proibe: ['taborder', 'items', 'lines'],
    motivo: 'texto sem foco' },
  { kind: 'lbl', exige: ['caption', 'showaccelchar'], proibe: ['items', 'lines', 'glyph'],
    motivo: 'texto com atalho sublinhado' },

  { kind: 'splitter', exige: ['minsize', 'resizestyle'], motivo: 'divisor arrastável' },
  { kind: 'shape', exige: ['shape', 'brush'], motivo: 'forma geométrica' },
  { kind: 'bevel', exige: ['shape', 'style'], proibe: ['brush', 'caption'], motivo: 'moldura' },
  { kind: 'web', exige: ['url'], motivo: 'navegador' },

  /*
   * Painel é o último de propósito: quase todo container publica `Align` e `BevelOuter`,
   * inclusive grade e árvore. Sem as proibições abaixo, esta regra engoliria as anteriores
   * — foi o que aconteceu na primeira medição, com TcxGrid e TStringGrid virando painel.
   */
  { kind: 'panel', exige: ['bevelouter', 'align'],
    proibe: ['columns', 'colcount', 'items', 'lines', 'picture', 'checked'],
    motivo: 'container com moldura' },
  { kind: 'panel', exige: ['activepage'], motivo: 'container de páginas' },
  { kind: 'panel', exige: ['dockmanager'], motivo: 'container de encaixe' },
];

export interface Palpite {
  kind: Kind;
  motivo: string;
}

/**
 * Aplica as regras ao conjunto de propriedades publicadas da classe e dos ancestrais.
 *
 * Devolve `undefined` quando nada casa — é o resultado honesto, e o chamador cai para o que
 * já fazia. Um palpite fraco aqui vale menos que a heurística de nome, que ao menos acerta
 * os casos que alguém já viu.
 */
export function inferirKind(props: Set<string>): Palpite | undefined {
  if (!props.size) { return undefined; }
  for (const r of REGRAS) {
    if (!r.exige.every(p => props.has(p))) { continue; }
    if (r.proibe?.some(p => props.has(p))) { continue; }
    return { kind: r.kind, motivo: r.motivo };
  }
  return undefined;
}
