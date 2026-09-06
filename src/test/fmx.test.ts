/**
 * C08 — um form FireMonkey no mesmo designer.
 *
 * O arquivo tem o mesmo formato; o que muda é onde a geometria mora. Estes testes fixam a
 * tradução nos dois sentidos: ler `Position.X`/`Size.Width` para desenhar, e escrever de
 * volta no mesmo par quando o componente é arrastado.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';
import { alignVcl, camposDe, documentoFmx, ehFmx, posicao, tamanho } from '../dfm/fmx';
import { place, sizeOf, visualKids, movable } from '../dfm/layout';
import { moveNode, resizeNode } from '../dfm/edit';

const reg = Registry.fromJSON({
  parents: [
    ['tform1', 'tform'], ['tform', 'tcommoncustomform'],
    ['tcommoncustomform', 'tfmxobject'], ['tfmxobject', 'tcomponent'],
    ['tlabel', 'ttextcontrol'], ['ttextcontrol', 'tstyledcontrol'],
    ['tstyledcontrol', 'tcontrol'],
    ['tbutton', 'ttextcontrol'],
    ['tlayout', 'tcontrol'],
    ['tcontrol', 'tfmxobject'],
  ],
});

const FMX = [
  'object Form1: TForm1',
  '  Left = 0',
  '  Top = 0',
  "  Caption = 'Form1'",
  '  ClientHeight = 480',
  '  ClientWidth = 640',
  '  object Barra: TLayout',
  '    Align = Top',
  '    Size.Width = 640.000000000000000000',
  '    Size.Height = 60.000000000000000000',
  '    Size.PlatformDefault = False',
  '  end',
  '  object Botao: TButton',
  '    Position.X = 24.000000000000000000',
  '    Position.Y = 120.000000000000000000',
  '    Size.Width = 96.000000000000000000',
  '    Size.Height = 32.000000000000000000',
  '    Size.PlatformDefault = False',
  "    Text = 'Salvar'",
  '  end',
  'end',
  '',
].join('\r\n');

function doc(): DfmDocument { return new DfmDocument('/x/Form1.fmx', FMX, reg); }

test('reconhece o form como FireMonkey pela geometria', () => {
  const d = doc();
  assert.equal(documentoFmx(d.root), true);
  assert.equal(ehFmx(d.byName.get('Botao')!), true);
  assert.equal(ehFmx(d.root), false, 'a raiz usa ClientWidth como no VCL');
});

test('posição e tamanho saem do par certo, arredondados', () => {
  const d = doc();
  assert.deepEqual(posicao(d.byName.get('Botao')!), [24, 120]);
  assert.deepEqual(tamanho(d.byName.get('Botao')!), [96, 32]);
  assert.deepEqual(sizeOf(d.byName.get('Botao')!, reg), [96, 32]);
});

test('Align do FMX vira o do VCL para o motor de layout', () => {
  assert.equal(alignVcl('Top'), 'altop');
  assert.equal(alignVcl('Client'), 'alclient');
  assert.equal(alignVcl('alTop'), 'altop', 'a grafia antiga continua valendo');
  assert.equal(alignVcl('Contents'), 'alclient');
  assert.equal(alignVcl('VertCenter'), 'alnone', 'sem equivalente: fica solto');
  assert.equal(alignVcl(''), '');
});

test('o layout coloca cada um no lugar', () => {
  const d = doc();
  const rects = place(visualKids(d.root, reg), 640, 480, reg);
  const barra = rects.get(d.byName.get('Barra')!)!;
  assert.deepEqual([barra.x, barra.y, barra.w, barra.h], [0, 0, 640, 60],
    'Align = Top ocupa a largura toda');
  const botao = rects.get(d.byName.get('Botao')!)!;
  assert.deepEqual([botao.x, botao.y, botao.w, botao.h], [24, 120, 96, 32]);
});

test('quem tem Align não é arrastável; quem não tem, é', () => {
  const d = doc();
  assert.equal(movable(d.byName.get('Barra')!, reg), false);
  assert.equal(movable(d.byName.get('Botao')!, reg), true);
});

test('mover grava em Position.X/Y, não em Left/Top', () => {
  const d = doc();
  const changes = moveNode(d, d.byName.get('Botao')!, 40, 200);
  const textos = changes.map(c => c.text);
  assert.ok(textos.some(t => t!.includes('Position.X = 40.000000000000000000')), textos.join('|'));
  assert.ok(textos.some(t => t!.includes('Position.Y = 200.000000000000000000')), textos.join('|'));
  assert.ok(!textos.some(t => /\bLeft =/.test(t!)), 'não pode inventar Left: ' + textos.join('|'));
  // e substitui a linha existente em vez de acrescentar outra
  assert.ok(changes.every(c => c.kind === 'replace'), JSON.stringify(changes));
});

test('redimensionar grava em Size.Width/Height', () => {
  const d = doc();
  const textos = resizeNode(d, d.byName.get('Botao')!, 120, 40).map(c => c.text);
  assert.ok(textos.some(t => t!.includes('Size.Width = 120.000000000000000000')), textos.join('|'));
  assert.ok(textos.some(t => t!.includes('Size.Height = 40.000000000000000000')), textos.join('|'));
});

test('form VCL continua gravando Left/Top e Width/Height', () => {
  const vclReg = Registry.fromJSON({
    parents: [['tform1', 'tform'], ['tform', 'tcustomform'], ['tcustomform', 'twincontrol'],
      ['tbutton', 'tcustombutton'], ['tcustombutton', 'twincontrol'],
      ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent']],
  });
  const src = ['object Form1: TForm1', '  ClientWidth = 400', '  ClientHeight = 300',
    '  object Botao: TButton', '    Left = 8', '    Top = 8', '    Width = 75',
    '    Height = 25', '  end', 'end', ''].join('\r\n');
  const d = new DfmDocument('/x/Form1.dfm', src, vclReg);
  const node = d.byName.get('Botao')!;
  assert.equal(camposDe(node).left[1], 'Left');
  const textos = moveNode(d, node, 20, 30).map(c => c.text);
  assert.ok(textos.some(t => t!.includes('Left = 20')), textos.join('|'));
  assert.ok(!textos.some(t => t!.includes('Position')), textos.join('|'));
});
