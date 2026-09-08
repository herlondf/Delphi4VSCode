/**
 * O layout do `TdxLayoutControl` calculado em números — as regras que os forms reais do
 * projeto quebraram quando o cálculo era do flexbox.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Registry } from '../dfm/registry';
import { parseDfm } from '../dfm/parser';
import { layoutTree, isLayoutHost, Rect } from '../dfm/layout';
import {
  medirLayout, Medida, GAP, RECUO_RAIZ, RECUO_GRUPO, RECUO_GRUPO_TOPO, recuosDe,
} from '../dfm/medir';
import { DfmNode, walk } from '../dfm/model';

const reg = Registry.fromJSON({
  parents: [
    ['tform1', 'tform'], ['tform', 'twincontrol'],
    ['tdxlayoutcontrol', 'tdxcustomlayoutcontrol'],
    ['tdxcustomlayoutcontrol', 'twincontrol'],
    ['tdxlayoutgroup', 'tdxcustomlayoutgroup'], ['tdxcustomlayoutgroup', 'tcomponent'],
    ['tdxlayoutitem', 'tdxcustomlayoutitem'], ['tdxcustomlayoutitem', 'tcomponent'],
    ['tcxbutton', 'twincontrol'], ['tcxtextedit', 'twincontrol'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
});

/** Idem, com os recuos vindos de um componente de look-and-feel do próprio form. */
function medirComLnf(linhas: string[], area: Rect, lnf: string): Map<string, Medida> {
  return medir(linhas, area, lnf);
}

/** Monta o .dfm, acha o host e devolve as medidas indexadas por nome. */
function medir(linhas: string[], area: Rect, lnf?: string): Map<string, Medida> {
  const doc = parseDfm(linhas.join('\n'), 'x.dfm');
  let host: DfmNode | undefined;
  (function rec(n: DfmNode) {
    if (!host && isLayoutHost(n, reg)) { host = n; }
    n.kids.forEach(rec);
  })(doc!);
  const tree = layoutTree(host!, reg)!;
  const fora = new Map<string, Medida>();
  (function rec(m: Medida) {
    fora.set(m.info.node.name, m);
    m.filhos.forEach(rec);
  })(medirLayout(tree, reg, area, true, recuosDe(
    lnf ? [...walk(doc!)].find(n => n.name === lnf) : undefined)));
  return fora;
}

const CABECA = [
  'object Form1: TForm1',
  '  object dxLayoutControl1: TdxLayoutControl',
  '    object Grupo: TdxLayoutGroup',
  '      LayoutDirection = ldHorizontal',
  '      Index = 0',
  '    end',
];

function botao(nome: string, indice: number, alinha: string): string[] {
  return [
    `    object Ctl${nome}: TcxButton`,
    '    end',
    `    object Item${nome}: TdxLayoutItem`,
    '      Parent = Grupo',
    ...(alinha ? [`      AlignHorz = ${alinha}`] : []),
    `      Control = Ctl${nome}`,
    '      ControlOptions.OriginalWidth = 75',
    '      ControlOptions.OriginalHeight = 25',
    '      CaptionOptions.Visible = False',
    `      Index = ${indice}`,
    '    end',
  ];
}

test('ahRight ancora no fim do grupo, como o rodapé de OK/Cancelar', () => {
  const m = medir(
    [...CABECA, ...botao('Esq', 0, 'ahLeft'), ...botao('Ok', 1, 'ahRight'),
     ...botao('Cancelar', 2, 'ahRight'), '  end', 'end'],
    { x: 0, y: 0, w: 400, h: 25 });
  assert.equal(m.get('ItemEsq')!.rect.x, RECUO_RAIZ);
  // Cancelar cola na borda; OK fica logo antes, com o vão no meio
  assert.equal(m.get('ItemCancelar')!.rect.x + 75, 400 - RECUO_RAIZ);
  assert.equal(m.get('ItemOk')!.rect.x + 75, 400 - RECUO_RAIZ - 75 - GAP);
});

test('o controle não encolhe abaixo do tamanho gravado — era o botão cortado', () => {
  const m = medir(
    [...CABECA, ...botao('Ok', 0, 'ahLeft'), '  end', 'end'],
    { x: 0, y: 0, w: 400, h: 12 });
  assert.equal(m.get('ItemOk')!.controle!.rect.h, 25);
});

/* O espaço útil, escolhido divisível por 4 para a divisão 300:100 ser exata. */
const UTIL = 800;

test('dois ahClient dividem o espaço proporcionalmente ao que pedem', () => {
  const m = medir([
    'object Form1: TForm1',
    '  object dxLayoutControl1: TdxLayoutControl',
    '    object Grupo: TdxLayoutGroup',
    '      LayoutDirection = ldHorizontal',
    '      Index = 0',
    '    end',
    '    object CtlLargo: TcxTextEdit',
    '    end',
    '    object ItemLargo: TdxLayoutItem',
    '      Parent = Grupo',
    '      AlignHorz = ahClient',
    '      Control = CtlLargo',
    '      ControlOptions.OriginalWidth = 300',
    '      ControlOptions.OriginalHeight = 21',
    '      CaptionOptions.Visible = False',
    '      Index = 0',
    '    end',
    '    object CtlEstreito: TcxTextEdit',
    '    end',
    '    object ItemEstreito: TdxLayoutItem',
    '      Parent = Grupo',
    '      AlignHorz = ahClient',
    '      Control = CtlEstreito',
    '      ControlOptions.OriginalWidth = 100',
    '      ControlOptions.OriginalHeight = 21',
    '      CaptionOptions.Visible = False',
    '      Index = 1',
    '    end',
    '  end',
    'end',
  ], { x: 0, y: 0, w: UTIL + RECUO_RAIZ * 2 + GAP, h: 21 });
  const largo = m.get('ItemLargo')!.rect.w;
  const estreito = m.get('ItemEstreito')!.rect.w;
  assert.equal(largo + estreito, UTIL);
  assert.equal(largo, UTIL * 3 / 4);
  assert.equal(estreito, UTIL / 4);
});

test('Parent = nil tira o item da árvore em vez de empilhá-lo abaixo do form', () => {
  const m = medir([
    'object Form1: TForm1',
    '  object dxLayoutControl1: TdxLayoutControl',
    '    object Grupo: TdxLayoutGroup',
    '      Index = 0',
    '    end',
    '    object CtlSumido: TcxButton',
    '    end',
    '    object ItemSumido: TdxLayoutItem',
    '      Parent = nil',
    '      Control = CtlSumido',
    '      ControlOptions.OriginalWidth = 75',
    '      ControlOptions.OriginalHeight = 25',
    '      Index = 1',
    '    end',
    '  end',
    'end',
  ], { x: 0, y: 0, w: 200, h: 100 });
  assert.equal(m.has('ItemSumido'), false);
  assert.equal(m.get('Grupo')!.rect.h, 100);
});

test('ldTabbed sobrepõe as páginas, uma faixa de abas acima', () => {
  const m = medir([
    'object Form1: TForm1',
    '  object dxLayoutControl1: TdxLayoutControl',
    '    object Grupo: TdxLayoutGroup',
    '      LayoutDirection = ldTabbed',
    '      Index = 0',
    '    end',
    '    object PaginaA: TdxLayoutGroup',
    '      Parent = Grupo',
    "      CaptionOptions.Text = 'Um'",
    '      Index = 0',
    '    end',
    '    object PaginaB: TdxLayoutGroup',
    '      Parent = Grupo',
    "      CaptionOptions.Text = 'Dois'",
    '      Index = 1',
    '    end',
    '  end',
    'end',
  ], { x: 0, y: 0, w: 300, h: 200 });
  assert.deepEqual(m.get('Grupo')!.abas, ['Um', 'Dois']);
  const a = m.get('PaginaA')!.rect;
  const b = m.get('PaginaB')!.rect;
  assert.deepEqual(a, b);
  assert.equal(a.y + a.h, 200);
});

test('grupo com moldura recua 12 nos lados e 18 no topo, como o look-and-feel padrão', () => {
  const m = medir([
    'object Form1: TForm1',
    '  object dxLayoutControl1: TdxLayoutControl',
    '    object Raiz: TdxLayoutGroup',
    '      Index = 0',
    '    end',
    '    object Moldura: TdxLayoutGroup',
    "      CaptionOptions.Text = 'Forma de pagamento'",
    '      Parent = Raiz',
    '      Index = 0',
    '    end',
    '    object Ctl: TcxButton',
    '    end',
    '    object ItemCtl: TdxLayoutItem',
    '      Parent = Moldura',
    '      Control = Ctl',
    '      ControlOptions.OriginalWidth = 75',
    '      ControlOptions.OriginalHeight = 25',
    '      CaptionOptions.Visible = False',
    '      Index = 0',
    '    end',
    '  end',
    'end',
  ], { x: 0, y: 0, w: 400, h: 200 });
  // o retângulo de cada medida é relativo ao grupo que a contém, não ao host
  assert.equal(m.get('Moldura')!.rect.x, RECUO_RAIZ);
  assert.equal(m.get('ItemCtl')!.rect.x, RECUO_GRUPO);
  assert.equal(m.get('ItemCtl')!.rect.y, RECUO_GRUPO_TOPO);
  assert.equal(RECUO_GRUPO, 12);
  assert.equal(RECUO_GRUPO_TOPO, 18);
});

test('Offsets do item é margem: entra no que ele pede e sai da área do conteúdo', () => {
  const m = medir([
    'object Form1: TForm1',
    '  object dxLayoutControl1: TdxLayoutControl',
    '    object Raiz: TdxLayoutGroup',
    '      Index = 0',
    '    end',
    '    object Ctl: TcxButton',
    '    end',
    '    object ItemCtl: TdxLayoutItem',
    '      Parent = Raiz',
    '      Offsets.Left = 20',
    '      Offsets.Top = 5',
    '      Control = Ctl',
    '      ControlOptions.OriginalWidth = 75',
    '      ControlOptions.OriginalHeight = 25',
    '      CaptionOptions.Visible = False',
    '      Index = 0',
    '    end',
    '  end',
    'end',
  ], { x: 0, y: 0, w: 400, h: 200 });
  // o item ocupa o espaço com a margem; o controle começa depois dela
  assert.equal(m.get('ItemCtl')!.rect.x, RECUO_RAIZ);
  assert.equal(m.get('ItemCtl')!.controle!.rect.x, 20);
  assert.equal(m.get('ItemCtl')!.controle!.rect.y, 5);
});

test('LayoutLookAndFeel com margem zerada não recua a raiz', () => {
  const linhas = (lnf: string): string[] => [
    'object Form1: TForm1',
    '  object dxLayoutControl1: TdxLayoutControl',
    ...lnf ? [`    LayoutLookAndFeel = ${lnf}`] : [],
    '    object SemMargem: TdxLayoutSkinLookAndFeel',
    '      Offsets.RootItemsAreaOffsetHorz = 0',
    '      Offsets.RootItemsAreaOffsetVert = 0',
    '    end',
    '    object Raiz: TdxLayoutGroup',
    '      Index = 0',
    '    end',
    '    object Ctl: TcxButton',
    '    end',
    '    object ItemCtl: TdxLayoutItem',
    '      Parent = Raiz',
    '      Control = Ctl',
    '      ControlOptions.OriginalWidth = 75',
    '      ControlOptions.OriginalHeight = 21',
    '      CaptionOptions.Visible = False',
    '      Index = 0',
    '    end',
    '  end',
    'end',
  ];
  const area = { x: 0, y: 0, w: 400, h: 21 };
  assert.equal(medir(linhas(''), area).get('ItemCtl')!.rect.y, RECUO_RAIZ);
  // com a margem zerada o controle cabe; com os 10 padrão sobrava 1px de altura
  const semMargem = medirComLnf(linhas('SemMargem'), area, 'SemMargem');
  assert.equal(semMargem.get('ItemCtl')!.rect.y, 0);
  assert.equal(semMargem.get('ItemCtl')!.controle!.rect.h, 21);
});
