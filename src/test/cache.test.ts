/**
 * Cache do índice de classes.
 *
 * A regra central tem nome e causa: **índice vazio não é cache válido**. Sem ela, um cache
 * gravado com zero classe sobrevive a todos os reinícios, e o designer abre o form sem
 * nenhum componente — porque `isVisual` recusa o que não está indexado.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CACHE_VERSION, conteudoDoCache, lerCache, mesmasRaizes } from '../dfm/cache';
import { Registry } from '../dfm/registry';

const RAIZES = ['C:/a', 'C:/b'];

function cheio(): Registry {
  return Registry.fromJSON({
    parents: [['tform1', 'tform'], ['tform', 'twincontrol']],
  });
}

test('cache íntegro volta com as classes', () => {
  const texto = conteudoDoCache(cheio(), RAIZES)!;
  const lido = lerCache(texto, RAIZES);
  assert.ok(lido);
  assert.equal(lido.size, 2);
});

test('índice vazio NÃO é gravado — gravar zero é o que perpetua o erro', () => {
  assert.equal(conteudoDoCache(new Registry(), RAIZES), undefined);
});

test('índice vazio NÃO é aceito, mesmo com versão e pastas corretas', () => {
  const texto = JSON.stringify(
    { version: CACHE_VERSION, roots: RAIZES, data: new Registry().toJSON() });
  assert.equal(lerCache(texto, RAIZES), undefined,
    'aceitar isto abre o form sem nenhum componente, para sempre e em silêncio');
});

test('versão de outro formato é descartada', () => {
  const texto = JSON.stringify(
    { version: CACHE_VERSION - 1, roots: RAIZES, data: cheio().toJSON() });
  assert.equal(lerCache(texto, RAIZES), undefined);
});

test('pastas diferentes das de agora são descartadas', () => {
  const texto = conteudoDoCache(cheio(), RAIZES)!;
  assert.equal(lerCache(texto, ['C:/a']), undefined);
  assert.equal(lerCache(texto, ['C:/b', 'C:/a']), undefined, 'a ordem faz parte da identidade');
});

test('JSON quebrado não derruba a ativação', () => {
  assert.equal(lerCache('{isto não é json', RAIZES), undefined);
  assert.equal(lerCache('', RAIZES), undefined);
});

test('comparação de raízes é por conteúdo e ordem', () => {
  assert.equal(mesmasRaizes(['a', 'b'], ['a', 'b']), true);
  assert.equal(mesmasRaizes(['b', 'a'], ['a', 'b']), false);
  assert.equal(mesmasRaizes('a,b', ['a', 'b']), false);
  assert.equal(mesmasRaizes(undefined, []), false);
});
