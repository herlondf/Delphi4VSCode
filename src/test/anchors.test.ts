/**
 * C02 — o que os Anchors fazem quando o container cresce, e N04/N05 — os modelos de form.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';
import { ajustar, aplicarAnchors, lerAnchors } from '../dfm/anchors';
import { novoEsqueleto } from '../dfm/scaffold';
import { parseDfm } from '../dfm/parser';
import { parsePascal, crossCheck } from '../dfm/pascal';

const reg = Registry.fromJSON({
  parents: [
    ['tform1', 'tform'], ['tform', 'tcustomform'], ['tcustomform', 'twincontrol'],
    ['tbutton', 'tcustombutton'], ['tcustombutton', 'twincontrol'],
    ['tpanel', 'tcustompanel'], ['tcustompanel', 'tcustomcontrol'],
    ['tcustomcontrol', 'twincontrol'],
    ['tmemo', 'tcustommemo'], ['tcustommemo', 'twincontrol'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
});

const SRC = [
  'object Form1: TForm1',
  '  ClientWidth = 400',
  '  ClientHeight = 300',
  '  object Fixo: TButton',
  '    Left = 8',
  '    Top = 8',
  '    Width = 75',
  '    Height = 25',
  '  end',
  '  object Direita: TButton',
  '    Left = 317',
  '    Top = 267',
  '    Width = 75',
  '    Height = 25',
  '    Anchors = [akRight, akBottom]',
  '  end',
  '  object Estica: TMemo',
  '    Left = 8',
  '    Top = 40',
  '    Width = 384',
  '    Height = 200',
  '    Anchors = [akLeft, akTop, akRight, akBottom]',
  '  end',
  '  object Rodape: TPanel',
  '    Left = 0',
  '    Top = 280',
  '    Width = 400',
  '    Height = 20',
  '    Align = alBottom',
  '  end',
  'end',
  '',
].join('\r\n');

function doc(): DfmDocument { return new DfmDocument('/x/Form1.dfm', SRC, reg); }

test('Anchors ausente é [akLeft, akTop]', () => {
  const d = doc();
  assert.deepEqual(lerAnchors(d.byName.get('Fixo')!),
    { left: true, top: true, right: false, bottom: false });
  assert.deepEqual(lerAnchors(d.byName.get('Direita')!),
    { left: false, top: false, right: true, bottom: true });
});

test('a regra por eixo: fica, anda ou estica', () => {
  assert.deepEqual(ajustar(10, 100, 50, true, false), [10, 100], 'só à esquerda: não mexe');
  assert.deepEqual(ajustar(10, 100, 50, false, true), [60, 100], 'só à direita: anda');
  assert.deepEqual(ajustar(10, 100, 50, true, true), [10, 150], 'nos dois: estica');
  assert.deepEqual(ajustar(10, 100, -200, true, true), [10, 1], 'não encolhe abaixo de 1');
});

test('crescer o form move o ancorado e estica o esticável', () => {
  const d = doc();
  const changes = aplicarAnchors(d, d.root, 100, 50, reg);
  const textos = changes.map(c => c.text ?? '');
  assert.ok(textos.some(t => t.includes('Left = 417')), 'Direita andou 100: ' + textos.join('|'));
  assert.ok(textos.some(t => t.includes('Top = 317')), textos.join('|'));
  assert.ok(textos.some(t => t.includes('Width = 484')), 'Estica cresceu: ' + textos.join('|'));
  assert.ok(textos.some(t => t.includes('Height = 250')), textos.join('|'));
  assert.ok(!textos.some(t => /Left = 8\b/.test(t)), 'Fixo não podia se mexer');
});

test('quem tem Align fica de fora: quem manda nele é o alinhamento', () => {
  const d = doc();
  const changes = aplicarAnchors(d, d.root, 100, 50, reg);
  const rodape = d.byName.get('Rodape')!;
  assert.ok(!changes.some(c => c.line >= rodape.line && c.line <= rodape.endLine),
    'o painel alinhado não podia entrar: ' + JSON.stringify(changes));
});

test('container do mesmo tamanho não gera edição nenhuma', () => {
  const d = doc();
  assert.deepEqual(aplicarAnchors(d, d.root, 0, 0, reg), []);
});

// ---- N04 / N05 ----

test('modelo de diálogo nasce com OK e Cancelar ligados', () => {
  const e = novoEsqueleto('Confirma', 'form', { modelo: 'dialogo' });
  const pas = e.arquivos[0].conteudo;
  const dfm = e.arquivos[1].conteudo;
  assert.match(pas, /BotaoOk: TButton;/);
  assert.match(pas, /Vcl\.StdCtrls/, 'a unit dos botões precisa entrar no uses');
  assert.match(dfm, /ModalResult = 1/);
  assert.match(dfm, /ModalResult = 2/);
  assert.match(dfm, /ClientWidth = 360/, 'o modelo define o tamanho');
  // o par continua íntegro: parseável e sem diagnóstico cruzado
  const raiz = parseDfm(dfm, 'Confirma.dfm')!;
  assert.equal(raiz.kids.length, 2);
  const unit = parsePascal(pas);
  const comps = raiz.kids.map(k => ({ nome: k.name, cls: k.cls, linha: k.line }));
  assert.deepEqual(crossCheck(unit, comps, []), []);
});

test('modelo de consulta traz painel e grade alinhados', () => {
  const e = novoEsqueleto('Clientes', 'form', { modelo: 'consulta' });
  const dfm = e.arquivos[1].conteudo;
  assert.match(dfm, /Align = alTop/);
  assert.match(dfm, /Align = alClient/);
  assert.match(e.arquivos[0].conteudo, /Vcl\.DBGrids/);
});

test('herdar de um form existente gera .dfm inherited e uses do ancestral', () => {
  const e = novoEsqueleto('Filho', 'form',
    { ancestral: { cls: 'TFormBase', unit: 'FormBase' } });
  assert.match(e.arquivos[0].conteudo, /TFormFilho = class\(TFormBase\)/);
  assert.match(e.arquivos[0].conteudo, /FormBase/, 'a unit do ancestral entra no uses');
  assert.match(e.arquivos[1].conteudo, /^inherited FormFilho: TFormFilho/,
    e.arquivos[1].conteudo);
  const raiz = parseDfm(e.arquivos[1].conteudo, 'Filho.dfm')!;
  assert.equal(raiz.kind, 'inherited');
});

test('frame ignora modelo de form: o modelo é só para form', () => {
  const e = novoEsqueleto('Busca', 'frame', { modelo: 'dialogo' });
  assert.ok(!/ModalResult/.test(e.arquivos[1].conteudo), e.arquivos[1].conteudo);
});

test('Anchors ausente pode ser acrescentado pelo inspetor', async () => {
  const { inspect } = await import('../dfm/inspector');
  const { setProperty } = await import('../dfm/edit');
  const d = doc();
  const fixo = d.byName.get('Fixo')!;
  const linha = inspect(d, fixo, reg).rows.find(r => r.key === 'anchors');
  assert.ok(linha, 'Anchors tinha de aparecer como acrescentável');
  assert.equal(linha!.absent, true);
  assert.equal(linha!.type, 'set');
  assert.deepEqual(linha!.setItems!.map(i => i.nome),
    ['akLeft', 'akTop', 'akRight', 'akBottom'], 'a caixa não pode abrir vazia');

  const changes = setProperty(d, fixo, 'anchors', '[akRight, akBottom]', 'control');
  assert.equal(changes.length, 1);
  assert.match(changes[0].text!, /Anchors = \[akRight, akBottom\]/);
});
