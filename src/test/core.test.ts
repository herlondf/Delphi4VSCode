import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDfm } from '../dfm/parser';
import { decodeBinaryDfm, isBinaryDfm } from '../dfm/binary';
import { Registry } from '../dfm/registry';
import { formatValue, propKind, num, txt, unquote, walk, DfmNode } from '../dfm/model';

const SAMPLE = `object MainForm: TMainForm
  Caption = 'It''s a test'
  ClientWidth = 600
  ClientHeight = 400
  object ToolbarPanel: TPanel
    Left = 0
    Top = 0
    Width = 600
    Height = 40
    Align = alTop
    object NewButton: TsButton
      Left = 8
      Top = 8
      Caption = '&New'
    end
  end
  object Grid: TDBGrid
    Align = alClient
    Columns = <
      item
        FieldName = 'NOME'
        Title.Caption = 'Cliente'
        Width = 180
      end
      item
        FieldName = 'UF'
      end>
  end
  object Query: TFDQuery
    Left = 200
  end
end
`;

test('parser: hierarquia, linhas e fim de bloco', () => {
  const root = parseDfm(SAMPLE, 'x.dfm')!;
  assert.equal(root.cls, 'TMainForm');
  assert.equal(txt(root, 'caption'), "It's a test");
  assert.equal(root.kids.length, 3);

  const panel = root.kids[0];
  assert.equal(panel.path, 'MainForm/ToolbarPanel');
  assert.equal(num(panel, 'height'), 40);
  assert.ok(panel.endLine > panel.line, 'o end precisa ser localizado');
  assert.equal(panel.kids[0].name, 'NewButton');
});

test('parser: coleção multilinha não quebra a estrutura', () => {
  const root = parseDfm(SAMPLE, 'x.dfm')!;
  const grid = root.kids[1];
  const cols = grid.props.get('columns')!;
  assert.ok(cols.raw.startsWith('<'), cols.raw);
  assert.ok(cols.raw.trimEnd().endsWith('>'), cols.raw);
  assert.equal(propKind(cols.raw), 'block');
  // o objeto seguinte continua sendo irmão, não filho da coleção
  assert.equal(root.kids[2].name, 'Query');
});

test('unquote: escape de aspas e códigos de caractere', () => {
  assert.equal(unquote("'It''s'"), "It's");
  assert.equal(unquote("'a' + #13#10 + 'b'"), 'a\r\nb');
  assert.equal(unquote('alClient'), 'alClient');
});

test('registry: herança decide o desenho, e o genérico é o último recurso', () => {
  const r = Registry.fromJSON({
    parents: [
      ['tsbutton', 'tbitbtn'], ['tbitbtn', 'tcustombutton'],
      ['tcustombutton', 'twincontrol'], ['twincontrol', 'tcontrol'],
      ['tcontrol', 'tcomponent'],
      ['tcxgrid', 'tcxcustomgrid'], ['tcxcustomgrid', 'tcxcontrol'],
      ['tcxcontrol', 'twincontrol'],
      ['tfdquery', 'tfdrdbmsdataset'], ['tfdrdbmsdataset', 'tdataset'],
      ['tdataset', 'tcomponent'],
    ],
  });
  // componente de terceiro desenha como o ancestral VCL dele
  assert.deepEqual(r.kindSource('TsButton'), ['btn', 'heranca']);
  // toda árvore cx passa por TWinControl: o específico tem de vencer o genérico
  assert.deepEqual(r.kindSource('TcxGrid'), ['grid', 'heranca']);
  // classe fora do índice ainda cai na heurística de nome
  assert.deepEqual(r.kindSource('TAdvStringGrid'), ['grid', 'nome']);

  const root = parseDfm(SAMPLE, 'x.dfm')!;
  const q = [...walk(root)].find(n => n.cls === 'TFDQuery')!;
  assert.equal(r.isVisual(q), false, 'TFDQuery herda de TComponent: nunca vai para a tela');
});

test('registry: cadeia truncada não pode sumir com o componente', () => {
  // TcxButton para em TcxBaseButton, que o DevExpress não declara nas sources
  const r = Registry.fromJSON({
    parents: [['tcxbutton', 'tcxcustombutton'], ['tcxcustombutton', 'tcxbasebutton']],
  });
  const node = parseDfm('object F: TF\n  object B: TcxButton\n  end\nend\n', 'x.dfm')!.kids[0];
  assert.equal(r.isVisual(node), true);
  assert.deepEqual(r.kindSource('TcxButton'), ['btn', 'heranca']);
});

test('registry: uma lista de imagens não é um controle, mesmo com Width/Height', () => {
  const r = Registry.fromJSON({
    parents: [['tcximagelist', 'tcxcustomimagelist'], ['tcxcustomimagelist', 'tcomponent']],
  });
  const node = parseDfm(
    'object F: TF\n  object IL: TcxImageList\n    Width = 16\n    Height = 16\n  end\nend\n',
    'x.dfm')!.kids[0];
  assert.equal(r.kind('TcxImageList'), 'image', 'o nome sugere imagem');
  assert.equal(r.isVisual(node), false, 'mas a herança manda');
});

test('formatValue: preserva o tipo e recusa injeção de linha', () => {
  assert.equal(formatValue('str', "It's"), "'It''s'");
  assert.equal(formatValue('bool', 'true'), 'True');
  assert.equal(formatValue('int', ' 42 '), '42');
  assert.equal(formatValue('enum', 'alClient'), 'alClient');
  assert.throws(() => formatValue('int', 'abc'));
  assert.throws(() => formatValue('bool', 'talvez'));
  assert.throws(() => formatValue('enum', 'a\n    Left = 9'));
  assert.throws(() => formatValue('block', 'x'));
});

test('propKind: coleção vazia numa linha ainda é bloco; set continua editável', () => {
  assert.equal(propKind('<>'), 'block');
  assert.equal(propKind('()'), 'block');
  assert.equal(propKind('{0A0B}'), 'block');
  assert.equal(propKind('[akLeft, akTop]'), 'set');
  assert.equal(propKind("'x'"), 'str');
  assert.equal(propKind('-5'), 'int');
  assert.equal(propKind('True'), 'bool');
  assert.equal(propKind('alTop'), 'enum');
});

// ---- formato binário ----

function pstr(s: string): number[] {
  return [s.length, ...[...s].map(c => c.charCodeAt(0))];
}

const BIN_CORPO = new Uint8Array([
  ...pstr('TPF0').slice(1),                       // assinatura sem o byte de tamanho
  ...pstr('TForm1'), ...pstr('Form1'),
  ...pstr('Left'), 2, 10,                         // vaInt8 = 10
  ...pstr('Caption'), 20, 4, 0, 0, 0, 0x4f, 0x6c, 0xc3, 0xa1,  // vaUTF8String 'Olá'
  ...pstr('Visible'), 9,                          // vaTrue
  ...pstr('Anchors'), 11, ...pstr('akLeft'), ...pstr('akTop'), 0,
  0,
  0xf2, 2, 1,                                     // ffChildPos: posição ANTES da classe
  ...pstr('TButton'), ...pstr('Btn'),
  ...pstr('Width'), 2, 75,
  0, 0,
  0,
]);

test('binário: decodifica os tipos e respeita ffChildPos', () => {
  assert.ok(isBinaryDfm(BIN_CORPO));
  const texto = decodeBinaryDfm(BIN_CORPO);
  assert.match(texto, /object Form1: TForm1/);
  assert.match(texto, /Left = 10/);
  assert.match(texto, /Caption = 'Olá'/);
  assert.match(texto, /Visible = True/);
  assert.match(texto, /Anchors = \[akLeft, akTop\]/);
  assert.match(texto, /object Btn: TButton/);
  assert.match(texto, /Width = 75/);
  // e o resultado tem de ser parseável como qualquer .dfm de texto
  const root = parseDfm(texto, 'b.dfm')!;
  assert.equal(root.name, 'Form1');
  assert.equal(root.kids[0].name, 'Btn');
});

test('binário: o embrulho de recurso do convert.exe dá o mesmo texto', () => {
  const recurso = new Uint8Array([0xff, 0x0a, 0x00, ...BIN_CORPO]);
  assert.ok(isBinaryDfm(recurso));
  assert.equal(decodeBinaryDfm(recurso), decodeBinaryDfm(BIN_CORPO));
});

test('binário: texto comum não é confundido com binário', () => {
  const txtBytes = new TextEncoder().encode(SAMPLE);
  assert.equal(isBinaryDfm(txtBytes), false);
});

test('binário: tipo desconhecido falha alto, em vez de gerar lixo', () => {
  const ruim = new Uint8Array([
    ...pstr('TPF0').slice(1), ...pstr('TF'), ...pstr('F'), ...pstr('X'), 99, 0, 0,
  ]);
  assert.throws(() => decodeBinaryDfm(ruim), /tipo de valor desconhecido/);
});

test('caminhos são únicos e estáveis na árvore', () => {
  const root = parseDfm(SAMPLE, 'x.dfm')!;
  const paths = [...walk(root)].map((n: DfmNode) => n.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes('MainForm/ToolbarPanel/NewButton'));
});
