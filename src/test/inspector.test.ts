/**
 * O que o inspetor mostra e como os valores compostos voltam ao arquivo.
 *
 * As cores e as coleções são as duas partes onde um erro é silencioso: um `$00BBGGRR`
 * invertido pinta a tela errada sem falhar, e uma coleção reescrita torto apaga colunas de
 * um grid. Por isso os dois têm ida e volta testada.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';
import { corDfm, corHex, inspect, inspectMany, lerStrings } from '../dfm/inspector';
import {
  descreverItem, escreverColecao, itensDaColecao, setCollectionProp, setStringsProp,
} from '../dfm/blocks';
import { mudancasDfm, mudancasPascal, planejar } from '../dfm/rename';
import { EditError } from '../dfm/edit';

const reg = Registry.fromJSON({
  parents: [
    ['tform1', 'tform'], ['tform', 'tcustomform'], ['tcustomform', 'twincontrol'],
    ['tmemo', 'tcustommemo'], ['tcustommemo', 'twincontrol'],
    ['tdbgrid', 'tcustomdbgrid'], ['tcustomdbgrid', 'twincontrol'],
    ['tdatasource', 'tcomponent'], ['timagelist', 'tcustomimagelist'],
    ['tcustomimagelist', 'tcomponent'],
    ['tbutton', 'tcustombutton'], ['tcustombutton', 'twincontrol'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
});

const SRC = [
  'object Form1: TForm1',
  "  Caption = 'Tela'",
  '  ClientWidth = 400',
  '  ClientHeight = 300',
  '  Color = clBtnFace',
  '  Font.Charset = DEFAULT_CHARSET',
  '  Font.Color = clWindowText',
  '  Font.Height = -12',
  "  Font.Name = 'Segoe UI'",
  '  Font.Style = [fsBold]',
  '  object Memo1: TMemo',
  '    Left = 8',
  '    Top = 8',
  '    Width = 200',
  '    Height = 90',
  '    Lines.Strings = (',
  "      'primeira'",
  "      'com ''aspas''')",
  '    Color = $00E1FFFF',
  '  end',
  '  object Grid1: TDBGrid',
  '    Left = 8',
  '    Top = 110',
  '    Width = 380',
  '    Height = 150',
  '    DataSource = DS1',
  '    Columns = <',
  '      item',
  "        FieldName = 'NOME'",
  "        Title.Caption = 'Nome'",
  '        Width = 120',
  '      end',
  '      item',
  "        FieldName = 'IDADE'",
  '        Width = 60',
  '      end>',
  '  end',
  '  object Botao: TButton',
  '    Left = 8',
  '    Top = 260',
  '    Width = 75',
  '    Height = 25',
  "    Caption = 'OK'",
  '    OnClick = BotaoClick',
  '  end',
  '  object DS1: TDataSource',
  '    Left = 300',
  '    Top = 8',
  '  end',
  'end',
  '',
].join('\r\n');

function doc(): DfmDocument { return new DfmDocument('/x/Form1.dfm', SRC, reg); }
function no(d: DfmDocument, nome: string) {
  const n = d.byName.get(nome);
  assert.ok(n, `não achei ${nome}`);
  return n!;
}

// ---- cores (I03) ----

test('cor ida e volta: o .dfm é BGR, o seletor é RGB', () => {
  // $00E1FFFF -> BB=E1 GG=FF RR=FF -> #ffffe1 (o amarelo de dica do Windows)
  assert.equal(corHex('$00E1FFFF'), '#ffffe1');
  assert.equal(corDfm('#ffffe1'), '$00E1FFFF');
  assert.equal(corHex(corDfm('#123456')), '#123456');
});

test('cor nomeada vira amostra, cor de sistema codificada não', () => {
  assert.equal(corHex('clRed'), '#ff0000');
  assert.equal(corHex('clNone'), '');
  assert.equal(corHex('$80000005'), '', 'o bit alto marca cor de sistema, não RGB');
});

test('cor inválida falha em vez de gravar lixo', () => {
  assert.throws(() => corDfm('vermelho'), /cor inválida/);
});

test('a linha de cor chega ao inspetor com a amostra', () => {
  const d = doc();
  const linha = inspect(d, no(d, 'Memo1'), reg).rows.find(r => r.key === 'color');
  assert.equal(linha?.type, 'color');
  assert.equal(linha?.color, '#ffffe1');
  assert.equal(linha?.value, '$00E1FFFF', 'o valor mostrado é o que está no arquivo');
});

// ---- sub-propriedades (I07) ----

test('Font.Name se agrupa sob Font', () => {
  const d = doc();
  const rows = inspect(d, d.root, reg).rows.filter(r => r.group === 'Font');
  assert.equal(rows.length, 5, JSON.stringify(rows.map(r => r.label)));
  assert.deepEqual(rows.find(r => r.sub === 'Name')?.value, 'Segoe UI');
});

test('conjunto vira caixinhas com os valores conhecidos', () => {
  const d = doc();
  const estilo = inspect(d, d.root, reg).rows.find(r => r.key === 'font.style');
  assert.equal(estilo?.type, 'set');
  assert.deepEqual(estilo?.setItems,
    [{ nome: 'fsBold', on: true }, { nome: 'fsItalic', on: false },
     { nome: 'fsUnderline', on: false }, { nome: 'fsStrikeOut', on: false }]);
});

// ---- referências a componentes (I08) ----

test('DataSource oferece os componentes do próprio form', () => {
  const d = doc();
  const linha = inspect(d, no(d, 'Grid1'), reg).rows.find(r => r.key === 'datasource');
  assert.equal(linha?.type, 'ref');
  assert.ok(linha!.refs!.includes('DS1'), JSON.stringify(linha!.refs));
  assert.ok(!linha!.refs!.includes('Form1'), 'o próprio form não é destino');
});

// ---- listas de strings (I05) ----

test('lista de strings é lida sem as aspas do Pascal', () => {
  const d = doc();
  const linha = inspect(d, no(d, 'Memo1'), reg).rows.find(r => r.key === 'lines.strings');
  assert.equal(linha?.type, 'strings');
  assert.deepEqual(linha?.lines, ['primeira', "com 'aspas'"]);
});

test('gravar a lista devolve o bloco inteiro, com as aspas duplicadas', () => {
  const d = doc();
  const [c] = setStringsProp(d, no(d, 'Memo1'), 'lines.strings',
    ['nova', "d'agua"], 'control');
  assert.equal(c.kind, 'replace');
  assert.equal(c.count, 3, 'o bloco antigo ocupava três linhas');
  assert.equal(c.text, [
    '    Lines.Strings = (',
    "      'nova'",
    "      'd''agua')",
  ].join(String.fromCharCode(10)));
  // e o que foi escrito volta a ser lido igual
  assert.deepEqual(lerStrings(c.text!.slice(c.text!.indexOf('('))), ['nova', "d'agua"]);
});

test('lista vazia não vira bloco quebrado', () => {
  const d = doc();
  const [c] = setStringsProp(d, no(d, 'Memo1'), 'lines.strings', [], 'control');
  assert.equal(c.text, '    Lines.Strings = ()');
});

// ---- coleções (I06) ----

test('a coleção é quebrada nos itens, com o aninhamento preservado', () => {
  const d = doc();
  const itens = itensDaColecao(no(d, 'Grid1').props.get('columns')!.raw);
  assert.equal(itens.length, 2);
  assert.deepEqual(itens[0].map(l => l.texto),
    ["FieldName = 'NOME'", "Title.Caption = 'Nome'", 'Width = 120']);
  assert.equal(descreverItem(itens[0]), 'NOME');
  assert.equal(descreverItem(itens[1]), 'IDADE');
});

test('reordenar reescreve a coleção no formato do Delphi', () => {
  const d = doc();
  const [c] = setCollectionProp(d, no(d, 'Grid1'), 'columns', [1, 0], 'control');
  assert.equal(c.count, 10, 'a coleção ocupava dez linhas');
  const texto = c.text!;
  assert.ok(texto.indexOf('IDADE') < texto.indexOf('NOME'), texto);
  assert.ok(texto.trimEnd().endsWith('end>'), 'o último end fecha a coleção: ' + texto);
  // e o resultado é relido pelo mesmo parser, com os mesmos itens
  const relido = itensDaColecao(texto.slice(texto.indexOf('<')));
  assert.deepEqual(relido.map(descreverItem), ['IDADE', 'NOME']);
});

test('remover item mantém a coleção válida; esvaziar é recusado', () => {
  const d = doc();
  const [c] = setCollectionProp(d, no(d, 'Grid1'), 'columns', [0], 'control');
  assert.deepEqual(itensDaColecao(c.text!.slice(c.text!.indexOf('<'))).map(descreverItem),
    ['NOME']);
  assert.throws(() => setCollectionProp(d, no(d, 'Grid1'), 'columns', [], 'control'),
    /coleção vazia/);
});

test('coleção com objeto aninhado não perde o aninhamento na volta', () => {
  const raw = ['<', 'item', "Caption = 'A'", 'Sub = <', 'item', 'X = 1', 'end>', 'end>']
    .join(String.fromCharCode(10));
  const itens = itensDaColecao(raw);
  assert.equal(itens.length, 1);
  const texto = escreverColecao(itens, 2, 'Coisas');
  const relido = itensDaColecao(texto.slice(texto.indexOf('<')));
  assert.equal(relido.length, 1, texto);
  assert.deepEqual(relido[0].map(l => l.texto), itens[0].map(l => l.texto));
});

// ---- seleção múltipla (I10) ----

test('com vários selecionados sobra só o que todos têm', () => {
  const d = doc();
  const r = inspectMany(d, [no(d, 'Memo1'), no(d, 'Botao')], reg);
  assert.equal(r.alvos, 2);
  const chaves = r.rows.map(x => x.key);
  assert.ok(chaves.includes('left'), 'os dois têm Left');
  assert.ok(!chaves.includes('lines.strings'), 'bloco não se funde: ' + chaves.join(','));
  assert.ok(!chaves.includes('onclick'), 'só um tem OnClick');
});

test('valor divergente aparece como (vários)', () => {
  const d = doc();
  const r = inspectMany(d, [no(d, 'Memo1'), no(d, 'Botao')], reg);
  assert.equal(r.rows.find(x => x.key === 'left')?.value, '8', 'os dois estão em Left = 8');
  assert.equal(r.rows.find(x => x.key === 'top')?.value, '(vários)');
});

// ---- renomear (I11) ----

const PAS = [
  'unit Form1;',
  'interface',
  'type',
  '  TForm1 = class(TForm)',
  '    Botao: TButton;',
  '    procedure BotaoClick(Sender: TObject);',
  '  end;',
  'implementation',
  'procedure TForm1.BotaoClick(Sender: TObject);',
  'begin',
  "  ShowMessage('Botao');   // o Botao aqui é texto",
  '  Botao.Enabled := False;',
  'end;',
  'end.',
].join(String.fromCharCode(13, 10));

test('renomear leva junto o handler derivado do nome', () => {
  const d = doc();
  const p = planejar(d, no(d, 'Botao'), 'Salvar');
  assert.deepEqual(p.metodos, [{ de: 'BotaoClick', para: 'SalvarClick' }]);
});

test('renomear reescreve o cabeçalho e o evento no .dfm', () => {
  const d = doc();
  const node = no(d, 'Botao');
  const cs = mudancasDfm(d, node, planejar(d, node, 'Salvar'));
  const textos = cs.map(c => c.text);
  assert.ok(textos.some(t => t === '  object Salvar: TButton'), textos.join(' | '));
  assert.ok(textos.some(t => t === '    OnClick = SalvarClick'), textos.join(' | '));
});

test('renomear atualiza quem apontava para o componente', () => {
  const d = doc();
  const node = no(d, 'DS1');
  const p = planejar(d, node, 'DataSourcePrincipal');
  assert.deepEqual(p.referencias, ['Grid1.DataSource']);
  const cs = mudancasDfm(d, node, p);
  assert.ok(cs.some(c => c.text === '    DataSource = DataSourcePrincipal'),
    JSON.stringify(cs));
});

test('no .pas troca o código e não o texto entre aspas', () => {
  const d = doc();
  const node = no(d, 'Botao');
  const edicoes = mudancasPascal(PAS, planejar(d, node, 'Salvar'));
  const porLinha = new Map(edicoes.map(e => [e.linha, e.texto]));
  assert.equal(porLinha.get(4), '    Salvar: TButton;');
  assert.equal(porLinha.get(5), '    procedure SalvarClick(Sender: TObject);');
  assert.equal(porLinha.get(8), 'procedure TForm1.SalvarClick(Sender: TObject);');
  assert.equal(porLinha.get(11), '  Salvar.Enabled := False;');
  assert.equal(porLinha.get(10), undefined,
    'string e comentário ficam como estavam: ' + porLinha.get(10));
});

test('renomear recusa nome inválido, repetido ou de outro arquivo', () => {
  const d = doc();
  const node = no(d, 'Botao');
  assert.throws(() => planejar(d, node, '1Botao'), EditError);
  assert.throws(() => planejar(d, node, 'Memo1'), /já existe/);
  assert.throws(() => planejar(d, node, 'Botao'), /o nome é o mesmo/);
});
