/**
 * A extensão sobe e os comandos fazem alguma coisa.
 *
 * Esta camada nunca tinha sido exercitada, e foi por onde passaram dois defeitos que só
 * apareceram no VS Code do usuário: um `activate()` que podia lançar antes de registrar os
 * comandos — e aí o Ctrl+F9 não faz nada, sem erro nenhum — e um build que terminava em
 * silêncio quando alguma etapa desistia no meio.
 *
 * O `vscode` aqui é de mentira (`vscode-falso.js`): o suficiente para `activate()` rodar até
 * o fim e para observar o que sai do outro lado.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const falso = require('./vscode-falso.js');
falso.instalar();

const STORAGE = path.join(os.tmpdir(), 'delphi4vscode-teste-activate');

function contexto(estado: Record<string, unknown> = {}): unknown {
  return {
    subscriptions: [],
    globalStorageUri: { fsPath: STORAGE },
    extensionUri: { fsPath: 'D:\\ext', path: '/ext' },
    workspaceState: {
      get: (k: string, d: unknown) => (k in estado ? estado[k] : d),
      update: async (k: string, v: unknown) => { estado[k] = v; },
    },
    globalState: { get: (_k: string, d: unknown) => d, update: async () => {} },
  };
}

/*
 * Cada build escreve o seu próprio .bat: reescrever um arquivo que o cmd ainda está lendo
 * corrompe a execução em curso, e foi o que fazia o segundo Ctrl+F9 seguido não acontecer.
 */
function bat(): string {
  const arquivos = fs.readdirSync(STORAGE)
    .filter(f => /^build-.*\.bat$/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(STORAGE, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  assert.ok(arquivos.length, 'nenhum .bat de build foi escrito');
  return fs.readFileSync(path.join(STORAGE, arquivos[0].f), 'latin1');
}

function carregar(): { activate: (c: unknown) => void } {
  // o módulo guarda estado entre ativações; recarregar mantém os testes independentes
  const alvo = require.resolve('../extension');
  delete require.cache[alvo];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../extension');
}

const ESPERADOS = [
  'delphi4vscode.reindex', 'delphi4vscode.openAsText', 'delphi4vscode.openAsDesigner',
  'delphi4vscode.salvarBinario', 'delphi4vscode.toggleLayout',
  'delphi4vscode.selecionarProjeto', 'delphi4vscode.configurarBuild',
  'delphi4vscode.build', 'delphi4vscode.rebuild', 'delphi4vscode.clean', 'delphi4vscode.usarScriptBuild',
  'delphi4vscode.abrirLog', 'delphi4vscode.cleanBuild', 'delphi4vscode.compilarComo',
  'delphi4vscode.lspRecarregar', 'delphi4vscode.novaUnit', 'delphi4vscode.novoProjeto',
  'delphi4vscode.classCompletion',
  'delphi4vscode.verificarProjeto', 'delphi4vscode.resumoProjeto',
  'delphi4vscode.rodar', 'delphi4vscode.compilarERodar', 'delphi4vscode.converterParaTexto',
  'delphi4vscode.acrescentarUnit', 'delphi4vscode.removerUnit',
  'delphi4vscode.ativarProjeto', 'delphi4vscode.atualizarProjetos',
  'delphi4vscode.novoForm', 'delphi4vscode.novoFrame', 'delphi4vscode.novoDataModule',
];

test('activate() vai até o fim e registra todos os comandos do manifesto', () => {
  falso.reset();
  carregar().activate(contexto());

  const pkg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const declarados: string[] = pkg.contributes.commands.map((c: { command: string }) => c.command);

  const faltando = declarados.filter(c => !falso.comandos.includes(c));
  assert.deepEqual(faltando, [], `declarados no package.json mas não registrados: ${faltando}`);
  assert.deepEqual([...ESPERADOS].sort(), [...declarados].sort(),
    'a lista do teste saiu de sincronia com o manifesto');
});

test('o comando de compilar chega a disparar uma task', async () => {
  falso.reset();
  const dproj = 'D:\\r\\app\\App.dproj';
  carregar().activate(contexto({
    'delphi4vscode.projetoAtivo': {
      fsPath: dproj, nome: 'App.dproj',
      configs: ['Debug'], plataformas: ['Win32'],
    },
    // não perguntar por script de projeto no meio do teste
    'delphi4vscode.scriptPerguntado': true,
  }));

  await falso.handlers['delphi4vscode.build']();
  assert.equal(falso.tarefas.length, 1, 'nenhuma task foi disparada');
  const t = falso.tarefas[0];
  assert.match(t.name, /^Compilar App\.dproj/, t.name);
  assert.equal(t.definition.alvo, 'Make', 'Ctrl+F9 é Compile, não Build');

  assert.ok(bat().includes('/t:Make'), bat());
  assert.ok(bat().includes(dproj), bat());
});

test('recompilar tudo usa o alvo Build', async () => {
  falso.reset();
  carregar().activate(contexto({
    'delphi4vscode.projetoAtivo': {
      fsPath: 'D:\\r\\X.dproj', nome: 'X.dproj',
      configs: ['Debug'], plataformas: ['Win32'],
    },
    'delphi4vscode.scriptPerguntado': true,
  }));
  await falso.handlers['delphi4vscode.rebuild']();
  assert.equal(falso.tarefas[0]?.definition.alvo, 'Build');
});

test('sem projeto ativo e sem escolha, não dispara task nem lança', async () => {
  falso.reset();
  carregar().activate(contexto({ 'delphi4vscode.scriptPerguntado': true }));
  // o stub de showQuickPick devolve o primeiro item; sem arquivos achados, não há item
  await falso.handlers['delphi4vscode.clean']();
  assert.equal(falso.tarefas.length, 0);
});

test('Clean + Build vai num alvo composto, para o MSBuild garantir a ordem', async () => {
  falso.reset();
  carregar().activate(contexto({
    'delphi4vscode.projetoAtivo': {
      fsPath: 'D:\r\X.dproj', nome: 'X.dproj',
      configs: ['Base', 'Debug', 'Release'], plataformas: ['Win32'],
    },
    'delphi4vscode.scriptPerguntado': true,
  }));
  await falso.handlers['delphi4vscode.cleanBuild']();
  assert.equal(falso.tarefas[0]?.definition.alvo, 'Clean;Build');
  assert.ok(bat().includes('/t:Clean;Build'), bat());
  assert.match(falso.tarefas[0].name, /Limpar e reconstruir/);
});

test('a verbosidade configurada chega ao msbuild', async () => {
  falso.reset();
  falso.vscode.workspace.getConfiguration = () => ({
    get: (k: string, d: unknown) => (k === 'buildVerbosity' ? 'detailed' : d),
    update: async () => {},
    inspect: () => ({}),
  });
  carregar().activate(contexto({
    'delphi4vscode.projetoAtivo': {
      fsPath: 'D:\r\X.dproj', nome: 'X.dproj',
      configs: ['Debug'], plataformas: ['Win32'],
    },
    'delphi4vscode.scriptPerguntado': true,
  }));
  await falso.handlers['delphi4vscode.build']();
  assert.ok(bat().includes('/v:detailed'), bat());
});

test('cada build escreve o seu próprio .bat', async () => {
  falso.reset();
  falso.vscode.workspace.getConfiguration = () => ({
    get: (_k: string, d: unknown) => d, update: async () => {}, inspect: () => ({}),
  });
  carregar().activate(contexto({
    'delphi4vscode.projetoAtivo': {
      fsPath: 'D:\r\X.dproj', nome: 'X.dproj',
      configs: ['Debug'], plataformas: ['Win32'],
    },
    'delphi4vscode.scriptPerguntado': true,
  }));
  const antes = fs.readdirSync(STORAGE).filter(f => /^build-.*\.bat$/.test(f)).length;
  await falso.handlers['delphi4vscode.build']();
  await new Promise(r => setTimeout(r, 5));
  await falso.handlers['delphi4vscode.rebuild']();
  const depois = fs.readdirSync(STORAGE).filter(f => /^build-.*\.bat$/.test(f)).length;
  assert.ok(depois >= antes + 2, `esperava dois .bat novos, foi de ${antes} para ${depois}`);
});

test('o projeto ativo sobrevive a compilações seguidas', async () => {
  falso.reset();
  const estado: Record<string, unknown> = {
    'delphi4vscode.projetoAtivo': {
      fsPath: 'D:\r\X.dproj', nome: 'X.dproj',
      configs: ['Debug'], plataformas: ['Win32'],
    },
    'delphi4vscode.scriptPerguntado': true,
  };
  carregar().activate(contexto(estado));
  for (let i = 0; i < 3; i++) { await falso.handlers['delphi4vscode.build'](); }
  assert.equal(falso.tarefas.length, 3, 'toda compilação tem de disparar a sua task');
  assert.ok(estado['delphi4vscode.projetoAtivo'], 'o projeto ativo não pode se perder no caminho');
});
