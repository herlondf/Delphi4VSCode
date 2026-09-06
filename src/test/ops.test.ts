import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDfm } from '../dfm/parser';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';
import {
  alignRects, duplicate, equalizeSize, reindent, reparent, revertInherited, tabOrderOf, zOrder,
} from '../dfm/ops';
import { TextChange } from '../dfm/edit';
import { walk } from '../dfm/model';

const reg = Registry.fromJSON({
  parents: [
    ['tpanel', 'tcustompanel'], ['tcustompanel', 'twincontrol'],
    ['tbutton', 'tcustombutton'], ['tcustombutton', 'twincontrol'],
    ['tedit', 'tcustomedit'], ['tcustomedit', 'twincontrol'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
});

const TEXTO = `object Form1: TForm1
  ClientWidth = 400
  ClientHeight = 300
  object PanelA: TPanel
    Left = 0
    Top = 0
    Width = 200
    Height = 100
    object Botao: TButton
      Left = 10
      Top = 10
      Width = 75
      Height = 25
      Caption = 'OK'
    end
  end
  object PanelB: TPanel
    Left = 200
    Top = 0
    Width = 200
    Height = 100
  end
end
`;

/** Aplica as mudanças em texto, do mesmo jeito que a extensão faz com WorkspaceEdit. */
function aplicar(texto: string, changes: TextChange[]): string {
  const linhas = texto.split('\n');
  for (const c of changes.filter(c => c.kind === 'replace')) {
    linhas[c.line] = c.text!;
  }
  const resto = changes.filter(c => c.kind !== 'replace');
  // inserções e remoções de baixo para cima, para os números seguirem válidos
  const porLinha = new Map<number, string[]>();
  for (const c of resto) {
    if (c.kind === 'insert') { porLinha.set(c.line, [...(porLinha.get(c.line) ?? []), c.text!]); }
  }
  const dels = resto.filter(c => c.kind === 'delete').sort((a, b) => b.line - a.line);
  const ins = [...porLinha.entries()].sort((a, b) => b[0] - a[0]);
  for (const [line, textos] of ins) { linhas.splice(line, 0, ...textos); }
  for (const c of dels) {
    // a linha do delete pode ter deslocado por inserções acima; recalcula pelo deslocamento
    let desloc = 0;
    for (const [line, textos] of ins) { if (line <= c.line) { desloc += textos.length; } }
    linhas.splice(c.line + desloc, c.count ?? 1);
  }
  return linhas.join('\n');
}

function doc(texto = TEXTO): DfmDocument {
  return new DfmDocument('/tmp/F.dfm', texto, reg);
}
function node(d: DfmDocument, nome: string) {
  return [...walk(d.root)].find(n => n.name === nome)!;
}

test('reindent desloca o bloco inteiro sem mexer em linha vazia', () => {
  const out = reindent(['    object X: TY', '      Left = 1', '', '    end'], 4, 8);
  assert.deepEqual(out, ['        object X: TY', '          Left = 1', '', '        end']);
});

test('D05 reparentar: o bloco muda de pai e as coordenadas se ajustam', () => {
  const d = doc();
  const changes = reparent(d, TEXTO, node(d, 'Botao'), node(d, 'PanelB'), 5, 5);
  const novo = aplicar(TEXTO, changes);
  const d2 = new DfmDocument('/tmp/F.dfm', novo, reg);
  const b = node(d2, 'Botao');
  assert.equal(b.parent!.name, 'PanelB', 'o botão passou para o outro painel');
  assert.equal(node(d2, 'PanelA').kids.length, 0, 'e saiu do primeiro');
  assert.match(novo, /Left = 5/);
  assert.match(novo, /Top = 5/);
  assert.ok(novo.includes("Caption = 'OK'"), 'o resto do bloco veio junto');
});

test('D05 recusa mover um container para dentro de si mesmo', () => {
  const d = doc();
  assert.throws(() => reparent(d, TEXTO, node(d, 'PanelA'), node(d, 'Botao'), 0, 0),
    /dentro dele mesmo/);
  assert.throws(() => reparent(d, TEXTO, node(d, 'PanelA'), node(d, 'PanelA'), 0, 0),
    /a si mesmo/);
});

test('D04 duplicar: nome novo, deslocado, com os filhos renomeados', () => {
  const d = doc();
  const { changes, name } = duplicate(d, TEXTO, node(d, 'PanelA'));
  assert.equal(name, 'PanelA1');
  const novo = aplicar(TEXTO, changes);
  const d2 = new DfmDocument('/tmp/F.dfm', novo, reg);
  const nomes = [...walk(d2.root)].map(n => n.name);
  assert.ok(nomes.includes('PanelA') && nomes.includes('PanelA1'));
  assert.ok(nomes.includes('Botao') && nomes.includes('Botao1'),
    'o filho também precisa de nome único, senão o form não carrega');
  assert.equal(new Set(nomes).size, nomes.length, 'nenhum nome repetido');
  assert.equal(node(d2, 'PanelA1').props.get('left')!.raw.trim(), '8', 'deslocado');
});

test('D06 z-order: trazer para a frente move o bloco para o fim', () => {
  const d = doc();
  const novo = aplicar(TEXTO, zOrder(d, TEXTO, node(d, 'PanelA'), 'front'));
  const d2 = new DfmDocument('/tmp/F.dfm', novo, reg);
  assert.deepEqual(d2.root.kids.map(k => k.name), ['PanelB', 'PanelA']);
  assert.ok(novo.includes("Caption = 'OK'"), 'o filho acompanhou o pai');
});

test('D06 recusa quando já está na ponta', () => {
  const d = doc();
  assert.throws(() => zOrder(d, TEXTO, node(d, 'PanelB'), 'front'), /já está na frente/);
  assert.throws(() => zOrder(d, TEXTO, node(d, 'PanelA'), 'back'), /já está atrás/);
});

test('D07 alinhamento: as operações que o Delphi tem', () => {
  const r = [
    { path: 'a', x: 10, y: 5, w: 50, h: 20 },
    { path: 'b', x: 30, y: 40, w: 80, h: 20 },
  ];
  const pai = { w: 200, h: 100 };
  assert.equal(alignRects(r, 'left', pai).get('b')!.x, 10);
  assert.equal(alignRects(r, 'right', pai).get('a')!.x, 110 - 50);
  assert.equal(alignRects(r, 'top', pai).get('b')!.y, 5);
  assert.equal(alignRects(r, 'bottom', pai).get('a')!.y, 60 - 20);
  assert.equal(alignRects(r, 'centerInParentH', pai).get('a')!.x, 75);
  assert.equal(alignRects(r, 'centerInParentV', pai).get('a')!.y, 40);
  // centralizar entre si: os dois passam a ter o mesmo centro
  const ch = alignRects(r, 'centerH', pai);
  assert.equal(ch.get('a')!.x + 25, ch.get('b')!.x + 40);
});

test('D07 distribuir mantém as pontas e iguala os intervalos', () => {
  const r = [
    { path: 'a', x: 0, y: 0, w: 20, h: 10 },
    { path: 'b', x: 30, y: 0, w: 20, h: 10 },
    { path: 'c', x: 100, y: 0, w: 20, h: 10 },
  ];
  const out = alignRects(r, 'spaceH', { w: 200, h: 100 });
  assert.equal(out.get('a')!.x, 0, 'a primeira não se move');
  assert.equal(out.get('c')!.x, 100, 'nem a última');
  const gap1 = out.get('b')!.x - 20;
  const gap2 = 100 - (out.get('b')!.x + 20);
  assert.ok(Math.abs(gap1 - gap2) <= 1, `intervalos desiguais: ${gap1} e ${gap2}`);
});

test('D08 igualar tamanho pelo maior e pelo menor', () => {
  const d = doc();
  const alvos = [node(d, 'PanelA'), node(d, 'Botao')];
  assert.equal([...equalizeSize(alvos, 'w', 'max').values()][0], 200);
  assert.equal([...equalizeSize(alvos, 'w', 'min').values()][0], 75);
  assert.throws(() => equalizeSize([alvos[0]], 'w', 'max'), /ao menos dois/);
});

test('D09 tab order lista os filhos na ordem que vale', () => {
  const texto = `object F: TF
  object P: TPanel
    Left = 0
    Top = 0
    Width = 100
    Height = 100
    object B: TButton
      TabOrder = 2
      Width = 10
      Height = 10
    end
    object E: TEdit
      TabOrder = 0
      Width = 10
      Height = 10
    end
  end
end
`;
  const d = new DfmDocument('/tmp/F.dfm', texto, reg);
  assert.deepEqual(tabOrderOf(node(d, 'P')).map(t => t.name), ['E', 'B']);
});

test('D11 reverter propriedade herdada, e o bloco vazio some junto', () => {
  const frameBase = `object FrX: TFrX
  Left = 0
  Top = 0
  Width = 100
  Height = 40
  object Campo: TEdit
    Left = 5
    Top = 5
    Width = 80
    Height = 21
  end
end
`;
  // simula o merge: o nó do frame ganha um override vindo do form
  const base = parseDfm(frameBase, '/tmp/FrX.dfm')!;
  const over = parseDfm(
    "object F: TF\n  inline Fr1: TFrX\n    inherited Campo: TEdit\n      Width = 120\n    end\n  end\nend\n",
    '/tmp/F.dfm')!;
  const campoBase = base.kids[0];
  const campoOver = over.kids[0].kids[0];
  campoBase.override = campoOver;
  campoBase.props.set('width', campoOver.props.get('width')!);

  const d = doc();
  (d as unknown as { uri: string }).uri = '/tmp/F.dfm';
  const changes = revertInherited(d, campoBase, 'width');
  // o bloco só tinha essa propriedade e nenhum filho: sai inteiro
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'delete');
  assert.equal(changes[0].count, campoOver.endLine - campoOver.line + 1);
});

test('D11 recusa reverter o que não é herdado', () => {
  const d = doc();
  assert.throws(() => revertInherited(d, node(d, 'Botao')), /não é herdado/);
});

test('operações recusam mexer em componente de outro arquivo', () => {
  const d = doc();
  const b = node(d, 'Botao');
  b.uri = '/tmp/Outro.dfm';
  assert.throws(() => duplicate(d, TEXTO, b), /Outro\.dfm/);
  assert.throws(() => zOrder(d, TEXTO, b, 'front'), /Outro\.dfm/);
});
