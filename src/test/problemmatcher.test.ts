/**
 * O problem matcher, conferido contra saída REAL do compilador.
 *
 * Ele estava declarado desde o começo e nunca casou com nada: a regex esperava o formato do
 * `dcc32` chamado direto, e o build vai por MSBuild, que embrulha a linha de outro jeito. O
 * sintoma era mudo — erro de compilação simplesmente não aparecia no painel Problems, e
 * ninguém repara na ausência de uma coisa.
 *
 * As linhas abaixo foram capturadas nesta máquina compilando um `.dpr` quebrado de propósito.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Padrao {
  regexp: string; file: number; line: number; severity: number; code: number; message: number;
}
interface Matcher { name: string; pattern: Padrao[]; }

const pkg = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const matchers: Matcher[] = pkg.contributes.problemMatchers;
const de = (nome: string): Padrao =>
  matchers.find(m => m.name === nome)!.pattern[0];

/** Saída literal do `msbuild /v:minimal` compilando um projeto com erro. */
const MSBUILD_ERRO =
  String.raw`Quebrado.dpr(13): error E2003: Undeclared identifier: 'NaoExiste' [C:\Users\x\Quebrado.dproj]`;
/** O MSBuild reclassifica o Hint do Delphi como warning e mantém a palavra original antes. */
const MSBUILD_HINT =
  String.raw`Quebrado.dpr(9): Hint warning H2164: Variable 'NaoUsada' is declared but never used in 'Quebrado' [C:\Users\x\Quebrado.dproj]`;
/** `dcc32` chamado direto, que é o caso de quem usa script de build próprio. */
const DCC_ERRO = String.raw`Q2.dpr(6) Error: E2003 Undeclared identifier: 'NaoExiste'`;

function casar(p: Padrao, linha: string) {
  const m = new RegExp(p.regexp).exec(linha);
  if (!m) { return undefined; }
  return {
    arquivo: m[p.file], linha: m[p.line],
    severidade: m[p.severity], codigo: m[p.code], mensagem: m[p.message],
  };
}

test('erro do MSBuild vira item clicável, sem o [projeto.dproj] no fim', () => {
  const r = casar(de('delphi4vscode-msbuild'), MSBUILD_ERRO);
  assert.ok(r, 'não casou com a saída real do MSBuild');
  assert.deepEqual(r, {
    arquivo: 'Quebrado.dpr', linha: '13', severidade: 'error', codigo: 'E2003',
    mensagem: "Undeclared identifier: 'NaoExiste'",
  });
});

test('Hint do Delphi entra com a severidade que o MSBuild deu', () => {
  const r = casar(de('delphi4vscode-msbuild'), MSBUILD_HINT);
  assert.ok(r, 'não casou com a linha de hint');
  assert.equal(r!.severidade, 'warning');
  assert.equal(r!.codigo, 'H2164');
  assert.ok(!r!.mensagem.includes('['), 'o caminho do projeto não é parte da mensagem');
});

test('o formato do dcc32 direto tem matcher próprio', () => {
  const r = casar(de('delphi4vscode-dcc'), DCC_ERRO);
  assert.ok(r, 'não casou com a saída do dcc32');
  assert.equal(r!.arquivo, 'Q2.dpr');
  assert.equal(r!.linha, '6');
  assert.equal(r!.codigo, 'E2003');
});

test('cada matcher só reconhece o seu formato, sem casar linha à toa', () => {
  assert.equal(casar(de('delphi4vscode-dcc'), MSBUILD_ERRO), undefined);
  assert.equal(casar(de('delphi4vscode-msbuild'), DCC_ERRO), undefined);
  for (const nome of ['delphi4vscode-msbuild', 'delphi4vscode-dcc']) {
    assert.equal(casar(de(nome), '  Embarcadero Delphi for Win32 compiler version 35.0'),
      undefined, 'linha de banner não pode virar problema');
    assert.equal(casar(de(nome), '  19 lines, 0.11 seconds, 129220 bytes code'), undefined);
  }
});

test('a task usa os dois matchers, e os dois estão declarados no manifesto', () => {
  const build = fs.readFileSync(
    path.join(__dirname, '..', '..', 'out', 'build.js'), 'utf8');
  for (const nome of ['delphi4vscode-msbuild', 'delphi4vscode-dcc']) {
    assert.ok(build.includes(`$${nome}`), `${nome} não é usado pela task`);
    assert.ok(matchers.some(m => m.name === nome), `${nome} não está no package.json`);
  }
});

test('os snippets existem, sao validos e nao repetem prefixo', () => {
  const caminhos: { language: string; path: string }[] = pkg.contributes.snippets ?? [];
  assert.ok(caminhos.length, 'nenhum snippet declarado');
  for (const c of caminhos) {
    const arq = path.join(__dirname, '..', '..', c.path);
    assert.ok(fs.existsSync(arq), `${c.path} declarado e ausente`);
  }
  const s = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', caminhos[0].path), 'utf8'));
  const prefixos = Object.values(s).map((v) => (v as { prefix: string }).prefix);
  assert.equal(new Set(prefixos).size, prefixos.length,
    'prefixo repetido faz um snippet esconder o outro');
  for (const [nome, corpo] of Object.entries(s)) {
    const v = corpo as { prefix: string; body: string[]; description?: string };
    assert.ok(Array.isArray(v.body) && v.body.length, `${nome} sem corpo`);
    assert.ok(v.description, `${nome} sem descricao`);
  }
});

test('as dependencias de producao nao podem ser excluidas do pacote', () => {
  /*
   * Defeito real, e do pior tipo: `.vscodeignore` tinha `node_modules/**`, entao o
   * `vscode-languageclient` nunca foi para o .vsix. A extensao instalava, ativava, e o Code
   * Insight simplesmente nao existia — o `require` do cliente estourava num modulo ausente.
   * O que o usuario via era o completar heuristico antigo, achando que era aquilo mesmo.
   */
  const deps = Object.keys(pkg.dependencies ?? {});
  if (!deps.length) { return; }
  const ignore = fs.readFileSync(path.join(__dirname, '..', '..', '.vscodeignore'), 'utf8');
  const linhas = ignore.split(/\r?\n/)
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const l of linhas) {
    assert.ok(!/^node_modules\/?(\*\*)?$/.test(l),
      `"${l}" tira o node_modules inteiro do pacote, e ha ${deps.length} dependencia(s) ` +
      `de producao: ${deps.join(', ')}`);
  }
});

test('o cliente LSP carrega a lib dentro de um try', () => {
  /*
   * Fora do try, a excecao subia para um `void registrarLsp(...)` e virava rejeicao nao
   * tratada: falha muda, com a extensao aparentando funcionar.
   */
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'lsp', 'cliente.ts'), 'utf8');
  const antesDoTry = src.slice(0, src.indexOf('await cliente.start()'));
  const abre = antesDoTry.lastIndexOf('try {');
  const req = antesDoTry.lastIndexOf("require('vscode-languageclient/node')");
  assert.ok(abre >= 0 && req > abre,
    'o require da lib do LSP tem de estar dentro do try que envolve o start');
});
