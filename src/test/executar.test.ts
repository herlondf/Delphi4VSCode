/**
 * Bloco B — achar o executável que o build gerou, e mexer no uses do `.dpr`.
 *
 * A parte perigosa é remover unit: o `uses` do `.dpr` termina em `;` e as demais linhas em
 * `,`. Tirar a última sem passar o terminador para a anterior deixa o projeto sem `;` — e o
 * Delphi não abre mais o `.dpr`.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exeDoProjeto, unitsDoDpr } from '../dfm/projeto';

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi4vscode-exec-'));
const CRLF = String.fromCharCode(13, 10);

function escrever(rel: string, texto: string): string {
  const alvo = path.join(RAIZ, ...rel.split('/'));
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, texto);
  return alvo;
}

test('o exe sai do DCC_ExeOutput, relativo ao .dproj', () => {
  const dproj = escrever('proj/App.dproj',
    "<Project><PropertyGroup><DCC_ExeOutput>..\\bin</DCC_ExeOutput></PropertyGroup></Project>");
  escrever('bin/App.exe', 'MZ');
  assert.equal(exeDoProjeto(dproj), path.join(RAIZ, 'bin', 'App.exe'));
});

test('sem DCC_ExeOutput, o exe fica ao lado do projeto', () => {
  const dproj = escrever('p2/Outro.dproj', '<Project></Project>');
  escrever('p2/Outro.exe', 'MZ');
  assert.equal(exeDoProjeto(dproj), path.join(RAIZ, 'p2', 'Outro.exe'));
});

test('exe que ainda não foi compilado devolve indefinido, não um caminho falso', () => {
  const dproj = escrever('p3/Nada.dproj', '<Project></Project>');
  assert.equal(exeDoProjeto(dproj), undefined);
});

// ---- o uses do .dpr ----

const DPR = [
  'program App;',
  'uses',
  "  Vcl.Forms,",
  "  Uma in 'Uma.pas' {Form1},",
  "  Duas in 'Duas.pas' {Form2},",
  "  Tres in 'Tres.pas' {Form3};",
  '',
  'begin',
  'end.',
].join(CRLF);

/** Reproduz o que o comando faz: apaga a linha e, se era a última, passa o `;` para cima. */
function removerLinha(texto: string, alvo: string): string {
  const linhas = texto.split(CRLF);
  const i = linhas.findIndex(l => l.includes(`${alvo} in `));
  const ehUltima = /;\s*$/.test(linhas[i]);
  linhas.splice(i, 1);
  if (ehUltima && i > 0) { linhas[i - 1] = linhas[i - 1].replace(/,\s*$/, ';'); }
  return linhas.join(CRLF);
}

test('as units do uses saem com o arquivo entre aspas', () => {
  const us = unitsDoDpr(DPR);
  assert.deepEqual(us.map(u => u.unit), ['Uma', 'Duas', 'Tres']);
  assert.equal(us[0].arquivo, 'Uma.pas');
  assert.ok(!us.some(u => u.unit === 'Vcl.Forms'), 'unit sem `in` não é do projeto');
});

test('remover uma unit do meio não mexe no terminador', () => {
  const novo = removerLinha(DPR, 'Duas');
  assert.ok(!novo.includes('Duas'), novo);
  assert.match(novo, /Tres in 'Tres\.pas' \{Form3\};/, 'o ; continua na última');
  assert.deepEqual(unitsDoDpr(novo).map(u => u.unit), ['Uma', 'Tres']);
});

test('remover a última passa o ponto-e-vírgula para a anterior', () => {
  const novo = removerLinha(DPR, 'Tres');
  assert.ok(!novo.includes('Tres'), novo);
  assert.match(novo, /Duas in 'Duas\.pas' \{Form2\};/,
    'sem isso o .dpr fica sem terminador e o projeto não abre');
  assert.ok(!/Duas in 'Duas\.pas' \{Form2\},/.test(novo));
  assert.deepEqual(unitsDoDpr(novo).map(u => u.unit), ['Uma', 'Duas']);
});
