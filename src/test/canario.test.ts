/**
 * Canário contra caractere de controle no fonte.
 *
 * Isto existe por causa de um defeito que aconteceu três vezes nesta base, sempre igual e
 * sempre mudo: escrever `\b` numa regex por um caminho que interpreta escapes produz um
 * **backspace literal** (0x08) no arquivo. A regex compila, não dá aviso nenhum, e nunca
 * casa — o que se vê é uma funcionalidade que simplesmente não faz nada:
 *
 *   `/^\s*begin\b/` virou `/^\s*begin\x08/` → variável de unidade sumia do índice;
 *   `/(private|...)\b/` virou `/(private|...)\x08/` → método de `private` virava teste.
 *
 * Um teste que lê os bytes custa nada e pega a classe inteira do problema.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '..', '..');

function fontes(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const cheio = path.join(dir, e.name);
    if (e.isDirectory()) { fontes(cheio, out); }
    else if (/\.(ts|js|json|css)$/i.test(e.name)) { out.push(cheio); }
  }
  return out;
}

/** Só tabulação, LF e CR são caracteres de controle legítimos num fonte. */
const PERMITIDOS = new Set([0x09, 0x0a, 0x0d]);

test('nenhum caractere de controle no fonte da extensão', () => {
  const suspeitos: string[] = [];
  for (const arquivo of [...fontes(path.join(RAIZ, 'src')),
                         ...fontes(path.join(RAIZ, 'media')),
                         ...fontes(path.join(RAIZ, 'snippets'))]) {
    const bytes = fs.readFileSync(arquivo);
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x20 && !PERMITIDOS.has(b)) {
        const linha = bytes.subarray(0, i).toString('latin1').split('\n').length;
        suspeitos.push(
          `${path.relative(RAIZ, arquivo)}:${linha} tem 0x${b.toString(16).padStart(2, '0')}`);
        break;
      }
    }
  }
  assert.deepEqual(suspeitos, [],
    'caractere de controle no fonte quase sempre é um escape de regex que virou byte');
});

test('nenhuma regex do código compilado tem caractere de controle', () => {
  /*
   * O fonte pode estar limpo e o compilado não — foi assim que o defeito apareceu na
   * primeira vez, porque o arquivo tinha sido escrito por uma ferramenta que interpretou
   * o escape.
   */
  const out = path.join(RAIZ, 'out');
  if (!fs.existsSync(out)) { return; }
  const suspeitos: string[] = [];
  for (const arquivo of fontes(out).filter(f => f.endsWith('.js'))) {
    const bytes = fs.readFileSync(arquivo);
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] < 0x20 && !PERMITIDOS.has(bytes[i])) {
        suspeitos.push(`${path.relative(RAIZ, arquivo)} tem 0x${bytes[i].toString(16)}`);
        break;
      }
    }
  }
  assert.deepEqual(suspeitos, []);
});
