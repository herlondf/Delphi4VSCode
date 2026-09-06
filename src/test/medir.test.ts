/**
 * O layout do `TdxLayoutControl` calculado em números — as regras que os forms reais do
 * projeto quebraram quando o cálculo era do flexbox.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Registry } from '../dfm/registry';
import { parseDfm } from '../dfm/parser';
import { layoutTree, isLayoutHost, Rect } from '../dfm/layout';
import { medirLayout, Medida } from '../dfm/medir';
import { DfmNode } from '../dfm/model';

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

/** Monta o .dfm, acha o host e devolve as medidas indexadas por nome. */
function medir(linhas: string[], area: Rect): Map<string, Medida> {
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
  })(medirLayout(tree, reg, area));
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
  assert.equal(m.get('ItemEsq')!.rect.x, 0);
  // Cancelar cola na borda; OK fica logo antes, com o vão no meio
  assert.equal(m.get('ItemCancelar')!.rect.x + 75, 400);
  assert.equal(m.get('ItemOk')!.rect.x + 75, 400 - 75 - 3);
});

test('o controle não encolhe abaixo do tamanho gravado — era o botão cortado', () => {
  const m = medir(
    [...CABECA, ...botao('Ok', 0, 'ahLeft'), '  end', 'end'],
    { x: 0, y: 0, w: 400, h: 12 });
  assert.equal(m.get('ItemOk')!.controle!.rect.h, 25);
});

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
  ], { x: 0, y: 0, w: 803, h: 21 });
  const largo = m.get('ItemLargo')!.rect.w;
  const estreito = m.get('ItemEstreito')!.rect.w;
  assert.equal(largo + estreito + 3, 803);
  assert.equal(largo, 600);
  assert.equal(estreito, 200);
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
