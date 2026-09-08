/**
 * O script de build.
 *
 * Testado à parte porque o erro que ele corrige é de quoting, e um teste escrito com escapes
 * errados esconderia exatamente o defeito que deveria pegar.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { comandoBuild, scriptBuild } from '../dfm/project';

const CRLF = String.fromCharCode(13, 10);
const ASPA = String.fromCharCode(34);
const RSVARS = String.raw`C:\Program Files (x86)\Embarcadero\Studio\37.0\bin\rsvars.bat`;
const DPROJ = String.raw`d:\Projetos\Exemplo\app-desktop\app\delphi\App.dproj`;

test('o script carrega o ambiente antes de compilar', () => {
  const bat = scriptBuild(RSVARS, DPROJ, 'Build', 'Debug', 'Win32');
  const linhas = bat.split(CRLF);
  assert.equal(linhas[0], '@echo off');
  assert.ok(linhas.some(l => l.startsWith('call ' + ASPA + 'C:')), bat);
  // sem checar o errorlevel do rsvars, uma falha de ambiente vira erro de compilação confuso
  assert.ok(linhas.some(l => l.startsWith('if errorlevel 1')), bat);
  assert.ok(linhas.some(l => l.includes('msbuild') && l.includes('/t:Build')), bat);
  assert.ok(linhas.some(l => l.includes('/p:Config=Debug')
    && l.includes('/p:Platform=Win32')), bat);
  assert.ok(bat.endsWith(CRLF), 'o cmd precisa da última linha terminada');
});

test('caminhos com espaço ficam entre aspas', () => {
  const bat = scriptBuild(RSVARS, DPROJ, 'Rebuild', 'Release', 'Win64');
  assert.ok(bat.includes(ASPA + RSVARS + ASPA), 'rsvars sem aspas quebraria em "Program Files"');
  assert.ok(bat.includes(ASPA + DPROJ + ASPA), 'o .dproj também precisa');
  assert.ok(bat.includes('/t:Rebuild') && bat.includes('/p:Config=Release'), bat);
});

test('o caminho do .bat vai sem aspas: quem executa é que faz o quoting', () => {
  const caminho = String.raw`C:\Users\x\AppData\Roaming\Code\delphi4vscode\build.bat`;
  const c = comandoBuild(caminho);
  assert.equal(c, caminho);
  // aspas postas aqui chegariam escapadas como \" e o cmd não acharia o arquivo
  assert.equal((c.match(/"/g) || []).length, 0);
  assert.ok(!c.startsWith(ASPA));
});

/**
 * O teste que de fato prova: escreve o script e executa. Só roda onde há Delphi instalado —
 * em outra máquina ele se ignora em vez de falhar.
 */
test('o script realmente roda no cmd e carrega o ambiente', () => {
  const rs = [
    RSVARS,
    String.raw`C:\Program Files (x86)\Embarcadero\Studio\22.0\bin\rsvars.bat`,
  ].find(p => fs.existsSync(p));
  if (!rs) { return; }

  // nome único: os arquivos de teste rodam em paralelo e compartilhariam o mesmo .bat
  const bat = path.join(os.tmpdir(), `delphi4vscode-teste-${process.pid}.bat`);
  // sem projeto: pede só a versão, para provar o ambiente sem compilar nada
  const script = scriptBuild(rs, 'x', 'Build', 'Debug', 'Win32')
    .replace(/^msbuild .*$/m, 'msbuild /version');
  fs.writeFileSync(bat, script, 'latin1');
  try {
    const r = spawnSync('cmd.exe', ['/d', '/c', comandoBuild(bat)], {
      encoding: 'latin1', timeout: 60000,
    });
    const saida = (r.stdout ?? '') + (r.stderr ?? '');
    assert.ok(!/n.o . reconhecido|not recognized/i.test(saida),
      'o caminho com espaço quebrou o comando: ' + saida.slice(0, 200));
    assert.match(saida, /\d+\.\d+\.\d+/,
      `o msbuild precisa responder a versão (status ${r.status}): ${saida.slice(0, 200)}`);
  } finally {
    fs.rmSync(bat, { force: true });
  }
});
