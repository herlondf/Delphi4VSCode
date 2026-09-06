/**
 * N06 — ida e volta pelo formato binário.
 *
 * Não dá para conferir byte a byte contra o Delphi aqui, mas dá para exigir a única coisa
 * que importa: o que sai do codificador é lido de volta pelo nosso decodificador e produz a
 * mesma árvore. Um byte de terminação a mais ou a menos quebra isso na hora.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDfm } from '../dfm/parser';
import { encodeBinaryDfm } from '../dfm/encode';
import { decodeBinaryDfm, isBinaryDfm } from '../dfm/binary';
import { DfmNode, walk } from '../dfm/model';

const SRC = [
  'object Form1: TForm1',
  "  Caption = 'Tela de vendas'",
  '  ClientWidth = 400',
  '  ClientHeight = 300',
  '  Color = clBtnFace',
  '  Font.Height = -12',
  "  Font.Name = 'Segoe UI'",
  '  Font.Style = [fsBold, fsItalic]',
  '  Visible = False',
  '  PixelsPerInch = 96',
  '  object Memo1: TMemo',
  '    Left = 8',
  '    Top = 8',
  '    Width = 200',
  '    Height = 90',
  '    Lines.Strings = (',
  "      'primeira'",
  "      'com ''aspas'' e acento: ação')",
  '  end',
  '  object Grid1: TDBGrid',
  '    Left = 8',
  '    Top = 110',
  '    Width = 30000',
  '    Columns = <',
  '      item',
  "        FieldName = 'NOME'",
  "        Title.Caption = 'Nome'",
  '        Width = 120',
  '      end',
  '      item',
  "        FieldName = 'IDADE'",
  '      end>',
  '  end',
  '  inline Frame1: TFrameBusca',
  '    Left = 0',
  '    Top = 200',
  '  end',
  'end',
  '',
].join('\r\n');

function chaves(n: DfmNode): string[] {
  return [...walk(n)].map(x => `${x.kind} ${x.name}: ${x.cls}`);
}

function normalizar(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

test('a saída é reconhecida como .dfm binário', () => {
  const raiz = parseDfm(SRC, '/x/Form1.dfm')!;
  const bytes = encodeBinaryDfm(raiz);
  assert.equal(isBinaryDfm(bytes), true);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'TPF0');
});

test('a árvore sobrevive à ida e volta', () => {
  const raiz = parseDfm(SRC, '/x/Form1.dfm')!;
  const volta = parseDfm(decodeBinaryDfm(encodeBinaryDfm(raiz)), '/x/Form1.dfm');
  assert.ok(volta, 'o binário gerado precisa ser decodificável');
  assert.deepEqual(chaves(volta!), chaves(raiz));
});

test('valores escalares voltam iguais, inclusive fora do byte', () => {
  const raiz = parseDfm(SRC, '/x/Form1.dfm')!;
  const volta = parseDfm(decodeBinaryDfm(encodeBinaryDfm(raiz)), '/x/Form1.dfm')!;
  const antes = new Map([...walk(raiz)].map(n => [n.path, n]));
  for (const n of walk(volta)) {
    const orig = antes.get(n.path)!;
    for (const [k, p] of orig.props) {
      assert.equal(normalizar(n.props.get(k)?.raw ?? ''), normalizar(p.raw),
        `${n.path}.${k}`);
    }
  }
});

test('acento sobrevive: o texto vai em UTF-8, não em latin1', () => {
  const raiz = parseDfm(SRC, '/x/Form1.dfm')!;
  const texto = decodeBinaryDfm(encodeBinaryDfm(raiz));
  assert.ok(texto.includes('ação'), texto.slice(0, 400));
});

test('o inline continua inline, e o inherited continua inherited', () => {
  const src = ['inherited FormFilho: TFormFilho', "  Caption = 'Filho'", 'end', ''].join('\n');
  const raiz = parseDfm(src, '/x/F.dfm')!;
  const volta = parseDfm(decodeBinaryDfm(encodeBinaryDfm(raiz)), '/x/F.dfm')!;
  assert.equal(volta.kind, 'inherited');
  const comInline = parseDfm(SRC, '/x/Form1.dfm')!;
  const v2 = parseDfm(decodeBinaryDfm(encodeBinaryDfm(comInline)), '/x/Form1.dfm')!;
  assert.equal(v2.kids.find(k => k.name === 'Frame1')?.kind, 'inline');
});

test('inteiro grande não é truncado para um byte', () => {
  const raiz = parseDfm(SRC, '/x/Form1.dfm')!;
  const volta = parseDfm(decodeBinaryDfm(encodeBinaryDfm(raiz)), '/x/Form1.dfm')!;
  const grid = volta.kids.find(k => k.name === 'Grid1')!;
  assert.equal(grid.props.get('width')?.raw.trim(), '30000');
  const form = volta;
  assert.equal(form.props.get('font.height')?.raw.trim(), '-12', 'negativo com sinal');
});

test('conjunto e coleção voltam com os mesmos itens', () => {
  const raiz = parseDfm(SRC, '/x/Form1.dfm')!;
  const volta = parseDfm(decodeBinaryDfm(encodeBinaryDfm(raiz)), '/x/Form1.dfm')!;
  assert.equal(normalizar(volta.props.get('font.style')!.raw), '[fsBold, fsItalic]');
  const cols = volta.kids.find(k => k.name === 'Grid1')!.props.get('columns')!.raw;
  assert.equal((cols.match(/\bitem\b/g) ?? []).length, 2, cols);
  assert.ok(cols.includes("FieldName = 'IDADE'"), cols);
});

test('lista de strings volta com as linhas na ordem', () => {
  const raiz = parseDfm(SRC, '/x/Form1.dfm')!;
  const volta = parseDfm(decodeBinaryDfm(encodeBinaryDfm(raiz)), '/x/Form1.dfm')!;
  const linhas = volta.kids.find(k => k.name === 'Memo1')!.props.get('lines.strings')!.raw;
  assert.ok(linhas.indexOf('primeira') < linhas.indexOf('aspas'), linhas);
});
