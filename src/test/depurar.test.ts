/**
 * Depuração sem a IDE. O que se testa é a decisão — quando reconverter, o que mandar ao
 * conversor e a forma da configuração —, não o depurador em si.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAP_DETALHADO, artefatos, argumentosMap2pdb, candidatosMap2pdb, configDeLancamento,
  estadoDoPdb,
} from '../dfm/depurar';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'd4v-dbg-'));
}

test('os três artefatos saem do nome do executável', () => {
  const a = artefatos(path.join('C:', 'bin', 'App.exe'));
  assert.equal(a.map, path.join('C:', 'bin', 'App.map'));
  assert.equal(a.pdb, path.join('C:', 'bin', 'App.pdb'));
});

test('sem .map não há o que converter, e o motivo diz o que fazer', () => {
  const d = tmp();
  const e = estadoDoPdb(artefatos(path.join(d, 'App.exe')));
  assert.equal(e.converter, false);
  assert.match(e.motivo, /map detalhado/);
});

test('.map sem .pdb manda converter', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'App.map'), 'x');
  assert.equal(estadoDoPdb(artefatos(path.join(d, 'App.exe'))).converter, true);
});

test('.pdb mais velho que o .map manda converter de novo', () => {
  const d = tmp();
  const map = path.join(d, 'App.map');
  const pdb = path.join(d, 'App.pdb');
  fs.writeFileSync(pdb, 'velho');
  fs.writeFileSync(map, 'novo');
  const antes = fs.statSync(map).mtimeMs;
  fs.utimesSync(pdb, new Date(antes - 5000), new Date(antes - 5000));
  const e = estadoDoPdb(artefatos(path.join(d, 'App.exe')));
  assert.equal(e.converter, true);
  assert.match(e.motivo, /velho/);
});

test('.pdb em dia não reconverte', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'App.map'), 'x');
  fs.writeFileSync(path.join(d, 'App.pdb'), 'x');
  assert.equal(estadoDoPdb(artefatos(path.join(d, 'App.exe'))).converter, false);
});

test('o conversor recebe -bind, que grava a referência no executável', () => {
  assert.deepEqual(argumentosMap2pdb('App.map'), ['-bind', 'App.map']);
});

test('o map detalhado é pedido por linha de comando, não gravado no .dproj', () => {
  assert.deepEqual(MAP_DETALHADO, { DCC_MapFile: '3' });
});

test('a configuração é cppvsdbg — cppdbg não serve, o EXE do Delphi não tem DWARF', () => {
  const c = configDeLancamento({ exe: path.join('C:', 'bin', 'App.exe') });
  assert.equal(c.type, 'cppvsdbg');
  assert.equal(c.request, 'launch');
  assert.equal(c.cwd, path.join('C:', 'bin'));
  assert.equal(c.symbolSearchPath, path.join('C:', 'bin'));
});

test('procura o conversor em cada raiz do workspace', () => {
  const c = candidatosMap2pdb([path.join('C:', 'w')]);
  assert.ok(c.includes(path.join('C:', 'w', 'map2pdb.exe')));
  assert.ok(c.includes(path.join('C:', 'w', 'map2pdb', 'Bin', 'map2pdb.exe')));
});
