/**
 * Renomear unit. O que se testa é a fronteira entre o que pode ser trocado sem pensar e o
 * que não pode — errar para o lado do "troca tudo" quebra código em silêncio.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  noCabecalho, noDproj, noDpr, noUses, qualificadosForaDoUses, regioesUses,
} from '../dfm/renomear';

const PAS = [
  'unit Pedido;',                                  // 0
  'interface',                                     // 1
  'uses',                                          // 2
  '  System.SysUtils, Pedido.Util, Cliente;',      // 3
  'implementation',                                // 4
  'uses Cliente, Item;',                           // 5
  'var',                                           // 6
  '  Cliente: TObject;',                           // 7
  'begin',                                         // 8
  '  Cliente.Free;',                               // 9
  '  Item.Fazer;',                                 // 10
  'end.',                                          // 11
].join('\n');

test('as duas cláusulas uses são encontradas, e param no ponto e vírgula', () => {
  assert.equal(regioesUses(PAS).length, 2);
});

test('o cabeçalho da unit é uma ocorrência, na coluna do nome', () => {
  assert.deepEqual(noCabecalho(PAS, 'Pedido'), { linha: 0, coluna: 5, tamanho: 6 });
});

test('só o que está em uses conta — variável de mesmo nome não é tocada', () => {
  const u = noUses(PAS, 'Cliente');
  assert.equal(u.length, 2, 'interface e implementation, e nada além');
  assert.deepEqual(u.map(o => o.linha), [3, 5]);
});

test('unit pontuada é outra unit: renomear Pedido não mexe em Pedido.Util', () => {
  assert.equal(noUses(PAS, 'Pedido').length, 0);
});

test('uso qualificado fora de uses é listado, não trocado', () => {
  const q = qualificadosForaDoUses(PAS, 'Item');
  assert.equal(q.length, 1);
  assert.equal(q[0].linha, 10);
});

test('o que está dentro de uses não entra na lista de qualificados', () => {
  // `Pedido.Util` está numa cláusula uses: é nome de unit, não uso qualificado
  assert.equal(qualificadosForaDoUses(PAS, 'Pedido').length, 0);
});

test('no .dpr trocam o nome e o arquivo dentro do caminho', () => {
  const dpr = [
    'program P;',
    'uses',
    "  Pedido in 'src\\Pedido.pas',",
    "  Item in 'Item.pas';",
    'begin',
    'end.',
  ].join('\n');
  const o = noDpr(dpr, 'Pedido');
  assert.equal(o.length, 2);
  assert.deepEqual(o.map(x => x.linha), [2, 2]);
  assert.ok(o[1].coluna > o[0].coluna, 'o do caminho vem depois do nome');
});

test('no .dproj troca só o nome do arquivo do Include', () => {
  const dproj = '<DCCReference Include="src\\Pedido.pas"><Form>FormPedido</Form></DCCReference>';
  const o = noDproj(dproj, 'Pedido');
  assert.equal(o.length, 1, 'o <Form> é nome de classe e não muda com a unit');
  assert.equal(dproj.slice(o[0].coluna, o[0].coluna + o[0].tamanho), 'Pedido');
});

test('nome que não existe no arquivo não produz troca', () => {
  assert.deepEqual(noUses(PAS, 'Inexistente'), []);
  assert.equal(noCabecalho(PAS, 'Inexistente'), undefined);
});
