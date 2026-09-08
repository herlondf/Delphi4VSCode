/**
 * Dobras do Object Pascal. O que se testa aqui é o que a indentação não resolve: `begin` e
 * `end` na mesma coluna do `procedure`, e `end` dentro de string ou comentário.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { dobras } from '../dfm/dobras';

function pares(texto: string): string[] {
  return dobras(texto.split('\n')).map(d => `${d.inicio}-${d.fim}`).sort();
}

test('interface e implementation viram seções dobráveis', () => {
  const p = pares([
    'unit U;',        // 0
    'interface',      // 1
    'type',           // 2
    'implementation', // 3
    'end.',           // 4
  ].join('\n'));
  assert.ok(p.includes('1-2'), `esperava a seção interface, veio ${p.join(' ')}`);
  assert.ok(p.includes('3-4'), `esperava a seção implementation, veio ${p.join(' ')}`);
});

test('begin/end de um método dobra, e o end. da unit não', () => {
  const p = pares([
    'implementation',                  // 0
    'procedure P;',                    // 1
    'begin',                           // 2
    '  X := 1;',                       // 3
    'end;',                            // 4
    'end.',                            // 5
  ].join('\n'));
  assert.ok(p.includes('2-4'), `esperava o corpo do método, veio ${p.join(' ')}`);
  assert.ok(!p.some(x => x.endsWith('-5') && x !== '0-5'), `o end. não abre dobra: ${p.join(' ')}`);
});

test('end dentro de string ou comentário não fecha bloco', () => {
  const p = pares([
    'begin',              // 0
    "  S := 'end';",      // 1
    '  T := 1; // end',   // 2
    'end;',               // 3
  ].join('\n'));
  assert.deepEqual(p, ['0-3']);
});

test('REGION dobra e aninha', () => {
  const p = pares([
    "{$REGION 'fora'}",   // 0
    "{$REGION 'dentro'}", // 1
    '  X := 1;',          // 2
    '{$ENDREGION}',       // 3
    '{$ENDREGION}',       // 4
  ].join('\n'));
  assert.deepEqual(p, ['0-4', '1-3']);
});

test('comentário de bloco de várias linhas dobra', () => {
  const p = pares(['{', '  nota', '}', 'begin', 'end;'].join('\n'));
  assert.ok(p.includes('0-2'), `esperava o comentário, veio ${p.join(' ')}`);
});

test('classe sem ancestral abre bloco; class procedure e forward não', () => {
  const p = pares([
    'type',                       // 0
    '  TA = class;',              // 1  forward: não abre
    '  TB = class',               // 2  abre
    '    class procedure P;',     // 3  não abre
    '    class var N: Integer;',  // 4  não abre
    '  end;',                     // 5  fecha o 2
    '  TRef = class of TB;',      // 6  não abre
  ].join('\n'));
  assert.deepEqual(p, ['2-5']);
});
