/**
 * O `.delphilsp.json` que o DelphiLSP exige.
 *
 * O que quebra aqui não dá erro visível: o servidor sobe, não compila nada e devolve `null`
 * em tudo — o mesmo sintoma de "o Code Insight não funciona". Daí os testes olharem o formato
 * campo a campo, e não só se o arquivo saiu.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { montarConfig, gravarConfig, paraUri, unitsDoDpr, dllDoCompilador } from '../lsp/config';

/** Um projeto de mentira em disco: `.dproj`, `.dpr` e as pastas que eles citam. */
function projetoFalso(): { dir: string; dproj: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd4vs-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'dcu'));
  const dproj = path.join(dir, 'Meu Projeto.dproj');
  fs.writeFileSync(dproj, [
    '<Project>', '<PropertyGroup>',
    '<DCC_UnitSearchPath>lib;naoExiste;$(BDSLIB)\\x</DCC_UnitSearchPath>',
    '<DCC_Namespace>Vcl;System;$(DCC_Namespace)</DCC_Namespace>',
    '<DCC_Define>MADEXCEPT;$(DCC_Define)</DCC_Define>',
    '<DCC_DcuOutput>dcu</DCC_DcuOutput>',
    '<DCC_UsePackage>cxLibraryD12;dbrtl;$(DCC_UsePackage)</DCC_UsePackage>',
    '</PropertyGroup>', '</Project>',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(dir, 'Meu Projeto.dpr'), [
    'program MeuProjeto;', 'uses',
    "  Vcl.Forms,", "  UnitA in 'lib\\UnitA.pas',",
    "  Sumida in 'lib\\Sumida.pas',", "  UnitA in 'lib\\UnitA.pas';",
    'begin', 'end.',
  ].join('\n'), 'latin1');
  fs.writeFileSync(path.join(dir, 'lib', 'UnitA.pas'), 'unit UnitA;\nend.\n', 'latin1');
  return { dir, dproj };
}

const opcoes = (dproj: string) => ({
  dproj, bdsBin: path.join(os.tmpdir(), 'bds-inexistente', 'bin'),
  versaoBds: '22.0', plataforma: 'Win32', config: 'Debug',
});

test('o caminho vira URI com os dois-pontos escapados, como a IDE escreve', () => {
  const u = paraUri('D:\\Projetos\\Meu App\\X.dpr');
  assert.match(u, /^file:\/\/\/D%3A\//);
  assert.ok(u.includes('Meu%20App'), u);
  // a barra separa segmentos e não pode ser escapada junto
  assert.ok(!u.includes('%2F'), u);
});

test('a DLL do compilador segue a plataforma', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
  fs.writeFileSync(path.join(bin, 'dcc32280.dll'), '');
  fs.writeFileSync(path.join(bin, 'dcc64280.dll'), '');
  assert.equal(dllDoCompilador(bin, 'Win32'), 'dcc32280.dll');
  assert.equal(dllDoCompilador(bin, 'Win64'), 'dcc64280.dll');
});

test('projectFiles sai do uses do .dpr, sem repetido e sem arquivo que não existe', () => {
  const { dir, dproj } = projetoFalso();
  const units = unitsDoDpr(dproj.replace(/\.dproj$/, '.dpr'), dir);
  assert.deepEqual(units.map(u => u.name), ['UnitA']);
  assert.match(units[0].file, /^file:\/\/\/.*UnitA\.pas$/);
});

test('o search path descarta pasta inexistente e variável não resolvida', () => {
  const { dir, dproj } = projetoFalso();
  const dcc = montarConfig(opcoes(dproj)).settings.dccOptions;
  const u = /-U(\S+|"[^"]*"(?:;(?:\S+|"[^"]*"))*)/.exec(dcc)![0];
  assert.ok(u.includes(path.join(dir, 'lib')), u);
  assert.ok(!u.includes('naoExiste'), u);
  assert.ok(!u.includes('$('), 'variável do MSBuild não pode vazar para a linha do dcc');
});

test('caminho com espaço vai entre aspas na linha do dcc', () => {
  const { dproj } = projetoFalso();
  const dcc = montarConfig(opcoes(dproj)).settings.dccOptions;
  const comEspaco = dcc.split(' ').some(t => t.includes('"'));
  assert.ok(comEspaco || !dproj.includes(' '), 'pasta com espaço precisa de aspas');
});

test('namespaces e defines herdados do MSBuild não entram', () => {
  const { dproj } = projetoFalso();
  const dcc = montarConfig(opcoes(dproj)).settings.dccOptions;
  assert.match(dcc, /-NSVcl;System;/);
  assert.match(dcc, /-DMADEXCEPT;DEBUG;FRAMEWORK_VCL/);
});

test('o arquivo fica ao lado do .dproj e só é reescrito quando muda', () => {
  const { dproj } = projetoFalso();
  const primeira = gravarConfig(opcoes(dproj));
  assert.equal(primeira.arquivo, dproj.replace(/\.dproj$/, '.delphilsp.json'));
  assert.equal(primeira.mudou, true);
  assert.equal(gravarConfig(opcoes(dproj)).mudou, false,
    'regravar igual faria o servidor recompilar o projeto inteiro à toa');
  const lido = JSON.parse(fs.readFileSync(primeira.arquivo, 'utf8'));
  assert.deepEqual(Object.keys(lido), ['settings']);
  assert.equal(typeof lido.settings.dccOptions, 'string',
    'dccOptions é a linha de comando inteira, não uma lista');
  assert.equal(lido.settings.includeDCUsInUsesCompletion, true);
});

test('trocar a plataforma muda o arquivo, e portanto o que o servidor compila', () => {
  const { dproj } = projetoFalso();
  const a = montarConfig(opcoes(dproj)).settings.dccOptions;
  const b = montarConfig({ ...opcoes(dproj), plataforma: 'Win64' }).settings.dccOptions;
  assert.notEqual(a, b);
});

test('o -LU leva a lista de pacotes: sem ela o completar morre em qualquer unit Vcl', () => {
  const { dproj } = projetoFalso();
  const dcc = montarConfig(opcoes(dproj)).settings.dccOptions;
  const lu = /-LU(\S*)/.exec(dcc)![1];
  const pacotes = lu.split(';');
  assert.ok(pacotes.includes('cxLibraryD12'), 'o que o .dproj declara tem de ir');
  assert.ok(pacotes.includes('dbrtl'), lu);
  /*
   * `rtl` e `vcl` entram mesmo sem o projeto declarar. Medido contra o DelphiLSP: com `-LU`
   * vazio, um `uses` com `Vcl.Graphics` faz o completar devolver 0 itens e `kkError` no log;
   * nomeando os pacotes, volta a 108. Não é preferência, é requisito do servidor.
   */
  assert.ok(pacotes.includes('rtl'), lu);
  assert.ok(pacotes.includes('vcl'), lu);
  assert.ok(!lu.includes('$('), 'variável do MSBuild não pode virar nome de pacote');
  assert.equal(new Set(pacotes).size, pacotes.length, 'pacote repetido');
});
