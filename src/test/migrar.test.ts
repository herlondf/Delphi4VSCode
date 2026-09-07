/**
 * A passagem de `dfmview.*` para `delphi4vscode.*`. O que não pode acontecer: perder o que
 * estava configurado, sobrescrever o que o usuário já ajustou no nome novo, ou rodar duas
 * vezes.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '..', '..');

interface Valor { globalValue?: unknown; workspaceValue?: unknown; }

/** Um `vscode` mínimo com duas seções de configuração e um estado por workspace. */
function ambiente(antigas: Record<string, Valor>, novas: Record<string, Valor> = {}) {
  const gravadas: { chave: string; valor: unknown; alvo: number }[] = [];
  const estadoWs = new Map<string, unknown>();
  const estadoGlobal = new Map<string, unknown>();
  const secao = (fonte: Record<string, Valor>, escreve: boolean) => ({
    get: (k: string, d: unknown) => d,
    inspect: (k: string) => fonte[k],
    update: async (k: string, v: unknown, alvo: number) => {
      if (escreve) { gravadas.push({ chave: k, valor: v, alvo }); }
    },
  });
  const vscode = {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      getConfiguration: (nome: string) =>
        (nome === 'dfmview' ? secao(antigas, false) : secao(novas, true)),
    },
  };
  const ctx = {
    globalState: {
      get: (k: string) => estadoGlobal.get(k),
      update: async (k: string, v: unknown) => { estadoGlobal.set(k, v); },
    },
    workspaceState: {
      get: (k: string) => estadoWs.get(k),
      update: async (k: string, v: unknown) => { estadoWs.set(k, v); },
    },
  };
  return { vscode, ctx, gravadas, estadoWs, estadoGlobal };
}

/** Carrega o módulo com o `vscode` falso deste teste. */
function carregar(vscode: unknown) {
  const alvo = path.join(RAIZ, 'out', 'migrar.js');
  delete require.cache[require.resolve(alvo)];
  const falso = path.join(RAIZ, 'out', 'test', 'vscode-falso.js');
  delete require.cache[require.resolve(falso)];
  require.cache[require.resolve(falso)] = { exports: vscode } as never;
  const Module = require('module');
  const original = Module._load;
  Module._load = (pedido: string, ...resto: unknown[]) =>
    (pedido === 'vscode' ? vscode : original(pedido, ...resto));
  try { return require(alvo); } finally { Module._load = original; }
}

test('traz a configuração antiga para o nome novo, mantendo global e workspace separados',
  async () => {
    const amb = ambiente({
      bdsBinPath: { globalValue: 'C:\\BDS\\bin' },
      buildScript: { workspaceValue: 'ci\\build_debug.bat' },
    });
    const movidas = await carregar(amb.vscode).migrarConfiguracoes(amb.ctx);
    assert.deepEqual(movidas.sort(), ['bdsBinPath', 'buildScript']);
    assert.deepEqual(amb.gravadas, [
      { chave: 'bdsBinPath', valor: 'C:\\BDS\\bin', alvo: 1 },
      { chave: 'buildScript', valor: 'ci\\build_debug.bat', alvo: 2 },
    ]);
  });

test('o que já foi configurado no nome novo manda', async () => {
  const amb = ambiente(
    { bdsBinPath: { globalValue: 'C:\\antigo\\bin' } },
    { bdsBinPath: { globalValue: 'C:\\escolhido\\bin' } });
  const movidas = await carregar(amb.vscode).migrarConfiguracoes(amb.ctx);
  assert.deepEqual(movidas, []);
  assert.deepEqual(amb.gravadas, []);
});

test('o projeto ativo NÃO vem junto: workspaceState é isolado por extensão', async () => {
  /*
   * Não é escolha, é limitação da API — e a versão anterior fingia que dava, lendo a própria
   * caixa vazia. O resultado foi todo mundo sem projeto ativo depois do rename, com o Code
   * Insight apontando para lugar nenhum e respondendo `null` a tudo.
   */
  const amb = ambiente({});
  amb.estadoWs.set('dfmview.projetoAtivo', { nome: 'X.dproj' });
  await carregar(amb.vscode).migrarConfiguracoes(amb.ctx);
  assert.equal(amb.estadoWs.get('delphi4vscode.projetoAtivo'), undefined,
    'não dá para ler o estado de outra extensão; quem cobre isso é garantirProjeto');
});

test('roda uma vez só: a segunda ativação não mexe em nada', async () => {
  const amb = ambiente({ bdsBinPath: { globalValue: 'C:\\BDS\\bin' } });
  const mod = carregar(amb.vscode);
  await mod.migrarConfiguracoes(amb.ctx);
  amb.gravadas.length = 0;
  const segunda = await mod.migrarConfiguracoes(amb.ctx);
  assert.deepEqual(segunda, []);
  assert.deepEqual(amb.gravadas, []);
});
