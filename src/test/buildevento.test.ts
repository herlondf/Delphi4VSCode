/**
 * O evento de "o projeto mudou".
 *
 * Existe por causa de um defeito silencioso: o Code Insight compila contra o `.dproj` e as
 * DCUs da plataforma que estão valendo, e sem aviso ele seguia apontado para o projeto
 * anterior. Autocompletar de outro projeto não parece erro — parece a extensão funcionando.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const falso = require('./vscode-falso.js');
falso.instalar();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BuildManager } = require('../build');

function contexto(): unknown {
  const estado: Record<string, unknown> = {};
  return {
    subscriptions: [],
    globalStorageUri: { fsPath: path.join(os.tmpdir(), 'd4vs-evento') },
    workspaceState: {
      get: (k: string, d: unknown) => (k in estado ? estado[k] : d),
      update: async (k: string, v: unknown) => { estado[k] = v; },
    },
    globalState: { get: (_k: string, d: unknown) => d, update: async () => {} },
  };
}

test('ativar um projeto dispara o evento', async () => {
  const build = new BuildManager(contexto());
  let avisos = 0;
  build.onMudou(() => { avisos++; });
  await build.ativar(path.join('D:', 'x', 'Projeto.dproj'));
  assert.equal(avisos, 1);
});

test('alvoAtual lê a configuração de novo a cada chamada, não um retrato', () => {
  /*
   * `getConfiguration()` devolve um retrato. Guardá-lo deixava o servidor no Win32 depois de
   * o usuário trocar para Win64 — e o sintoma é completar contra as DCUs erradas, sem erro.
   */
  const build = new BuildManager(contexto());
  let plataforma = 'Win32';
  const original = falso.vscode.workspace.getConfiguration;
  falso.vscode.workspace.getConfiguration = () => ({
    get: (k: string, d: unknown) => (k === 'buildPlatform' ? plataforma : d),
    update: async () => {}, inspect: () => ({}),
  });
  try {
    assert.equal(build.alvoAtual.plataforma, 'Win32');
    plataforma = 'Win64';
    assert.equal(build.alvoAtual.plataforma, 'Win64');
  } finally {
    falso.vscode.workspace.getConfiguration = original;
  }
});

test('garantirProjeto ativa sozinho quando o workspace tem um .dproj só', async () => {
  /*
   * A rede de segurança do rename: `workspaceState` e isolado por id de extensao, entao
   * ninguem herdou o projeto ativo do `dfmview`. Sem projeto, o Code Insight sobe, aponta
   * para lugar nenhum e responde `null` a tudo.
   */
  const build = new BuildManager(contexto());
  const original = falso.vscode.workspace.findFiles;
  falso.vscode.workspace.findFiles = async () => [{ fsPath: path.join('D:', 'x', 'Unico.dproj') }];
  try {
    const p = await build.garantirProjeto(false);
    assert.ok(p, 'com um projeto so nao ha o que perguntar');
    assert.equal(p.nome, 'Unico.dproj');
    assert.equal(build.projeto.nome, 'Unico.dproj', 'e fica gravado como ativo');
  } finally {
    falso.vscode.workspace.findFiles = original;
  }
});

test('com varios projetos nao adivinha: devolve vazio quando nao pode perguntar', async () => {
  const build = new BuildManager(contexto());
  const original = falso.vscode.workspace.findFiles;
  falso.vscode.workspace.findFiles = async () => [
    { fsPath: path.join('D:', 'x', 'Cliente.dproj') }, { fsPath: path.join('D:', 'x', 'Servidor.dproj') }];
  try {
    assert.equal(await build.garantirProjeto(false), undefined,
      'adivinhar aqui ja compilou o projeto errado nesta extensao');
  } finally {
    falso.vscode.workspace.findFiles = original;
  }
});

test('workspace sem nenhum .dproj nao trava nem lanca', async () => {
  const build = new BuildManager(contexto());
  assert.equal(await build.garantirProjeto(true), undefined);
});
