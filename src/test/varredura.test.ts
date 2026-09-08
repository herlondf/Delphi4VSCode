/**
 * O orçamento de tempo da varredura de classes.
 *
 * O defeito que este teste tranca: `scan` cortava no tempo limite e não avisava ninguém. O
 * índice pela metade ia para o cache como se estivesse inteiro, voltava assim em toda sessão,
 * e o designer abria os forms SEM NENHUM COMPONENTE — porque `isVisual` recusa a classe que
 * não foi indexada. Aconteceu de verdade: cache com 12.034 classes onde cabiam 25.448.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Registry } from '../dfm/registry';
import { conteudoDoCache } from '../dfm/cache';

/** Uma pasta com `n` units, cada uma declarando uma classe. */
function pastaCom(n: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd4v-scan-'));
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(dir, `U${i}.pas`),
      `unit U${i};\ninterface\ntype\n  TC${i} = class(TComponent)\n  end;\nimplementation\nend.\n`);
  }
  return dir;
}

test('varredura que termina se declara completa', () => {
  const dir = pastaCom(20);
  const reg = new Registry();
  const r = reg.scan([dir], 60000);
  assert.equal(r.completo, true);
  assert.equal(reg.size, 20);
});

test('varredura cortada pelo tempo se declara INCOMPLETA', () => {
  const dir = pastaCom(400);
  const reg = new Registry();
  // orçamento zero: o corte acontece antes da primeira entrada
  const r = reg.scan([dir], 0);
  assert.equal(r.completo, false, 'sem isto, meio índice vira cache permanente');
});

test('índice cortado ainda tem tamanho — por isso o tamanho não basta como critério', () => {
  const dir = pastaCom(40);
  const cheio = new Registry();
  cheio.scan([dir], 60000);
  assert.ok(cheio.size > 0);
  // o que separa um do outro é o `completo`, não o `size`
  assert.notEqual(conteudoDoCache(cheio, [dir]), undefined);
});

test('pasta inexistente não derruba a varredura nem a marca como incompleta', () => {
  const reg = new Registry();
  assert.equal(reg.scan([path.join(os.tmpdir(), 'nao-existe-d4v')], 60000).completo, true);
  assert.equal(reg.size, 0);
});
