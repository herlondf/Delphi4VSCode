/*
 * Carrega a extensão compilada com um 'vscode' de mentira e chama activate().
 * Se activate lança, o VS Code não registra comando nenhum — e nada acontece ao apertar
 * Ctrl+F9, que é exatamente o sintoma relatado.
 */
const path = require('path');
const fsx = require('fs');
const Module = require('module');

const comandos = [];
const handlers = {};
const tarefas = [];
const noop = () => {};
const disp = { dispose: noop };

function ev() { const f = () => disp; return f; }

const vscode = {
  window: {
    terminals: [],
    createTerminal: () => ({ show: noop, sendText: noop, dispose: noop, name: 't' }),
    createOutputChannel: () => ({ appendLine: noop, append: noop, show: noop, clear: noop, dispose: noop }),
    createStatusBarItem: () => ({ show: noop, hide: noop, dispose: noop, text: '', tooltip: '', command: '' }),
    registerCustomEditorProvider: () => disp,
    showInformationMessage: noop, showWarningMessage: noop, showErrorMessage: noop,
    createTreeView: () => disp, registerTreeDataProvider: () => disp,
    createTextEditorDecorationType: () => ({ dispose: noop }),
    onDidChangeActiveTextEditor: ev(), onDidChangeTextEditorSelection: ev(),
    onDidChangeVisibleTextEditors: ev(), onDidChangeTextEditorVisibleRanges: ev(),
    showTextDocument: async () => ({ selection: null, revealRange: noop }),
    showQuickPick: async itens => (await itens)[0], showInputBox: async () => undefined,
    showOpenDialog: async () => undefined, showSaveDialog: async () => undefined,
    withProgress: async (_o, f) => f({ report: noop }),
    visibleTextEditors: [], activeTextEditor: undefined,
    tabGroups: { activeTabGroup: { activeTab: undefined } },
  },
  workspace: {
    // `inspect` é o que a migração de configuração usa para saber de onde veio cada valor
    getConfiguration: () => ({
      get: (_k, d) => d,
      update: async () => {},
      inspect: () => ({ globalValue: undefined, workspaceValue: undefined,
                        workspaceFolderValue: undefined }),
    }),
    workspaceFolders: [{ uri: { fsPath: 'D:\\x', toString: () => 'file:///x' }, name: 'x', index: 0 }],
    onDidChangeTextDocument: ev(), onDidChangeConfiguration: ev(),
    onDidChangeWorkspaceFolders: ev(), onDidSaveTextDocument: ev(),
    onDidOpenTextDocument: ev(), onDidCloseTextDocument: ev(),
    createFileSystemWatcher: () => ({
      onDidChange: ev(), onDidCreate: ev(), onDidDelete: ev(), dispose: noop,
    }),
    textDocuments: [], openTextDocument: async () => { throw new Error('sem doc'); },
    applyEdit: async () => true, fs: { writeFile: async () => {} },
    asRelativePath: p => p,
    findFiles: async () => [],
  },
  languages: {
    registerCodeActionsProvider: () => disp,
    registerWorkspaceSymbolProvider: () => disp,
    registerReferenceProvider: () => disp,
    createDiagnosticCollection: () => ({ set: noop, delete: noop, clear: noop, dispose: noop }),
    registerDocumentSymbolProvider: () => disp,
    registerFoldingRangeProvider: () => disp,
    registerCodeLensProvider: () => disp,
    registerDefinitionProvider: () => disp,
    registerHoverProvider: () => disp,
    registerCompletionItemProvider: () => disp,
    registerRenameProvider: () => disp,
    registerDocumentFormattingEditProvider: () => disp,
    onDidChangeDiagnostics: ev(),
    getDiagnostics: () => [],
  },
  commands: {
    registerCommand: (id, fn) => { comandos.push(id); handlers[id] = fn; return disp; },
    executeCommand: async () => {},
  },
  /*
   * Controlador de testes com colecoes de verdade: o `activate` monta a arvore aqui, e um
   * `add` que nao guarda nada faria qualquer teste sobre descoberta passar sem descobrir.
   */
  tests: {
    createTestController: (id, rotulo) => {
      const colecao = () => {
        const mapa = new Map();
        return {
          get size() { return mapa.size; },
          add: i => mapa.set(i.id, i),
          replace: itens => { mapa.clear(); for (const i of itens || []) mapa.set(i.id, i); },
          get: id2 => mapa.get(id2),
          delete: id2 => mapa.delete(id2),
          forEach: fn => mapa.forEach(fn),
        };
      };
      return {
        id, label: rotulo, items: colecao(), dispose: noop,
        createTestItem: (id2, rotulo2, uri) =>
          ({ id: id2, label: rotulo2, uri, children: colecao(), range: undefined }),
        createRunProfile: (nome, tipo, fn, padrao) => ({ nome, tipo, fn, padrao, dispose: noop }),
        createTestRun: () => ({
          enqueued: noop, started: noop, passed: noop, failed: noop, skipped: noop,
          errored: noop, appendOutput: noop, end: noop,
        }),
        refreshHandler: undefined,
        invalidateTestResults: noop,
      };
    },
  },
  TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
  TestMessage: class { constructor(m) { this.message = m; } },
  tasks: { executeTask: async t => { tarefas.push(t); }, registerTaskProvider: () => disp },
  Uri: {
    file: f => ({ fsPath: f, path: f.replace(/\\/g, '/'), toString: () => 'file:///' + f,
                  with: o => ({ ...o, fsPath: f, path: o.path || f }) }),
    joinPath: (b, ...r) => ({ fsPath: [b.fsPath, ...r].join('\\'), toString: () => r.join('/') }),
  },
  /*
   * Emissor de verdade, não um `fire()` vazio. Um emissor mudo faz passar qualquer teste
   * sobre quem reage ao evento — e o evento existe justamente porque não reagir era o bug.
   */
  EventEmitter: class {
    constructor() {
      this.ouvintes = [];
      this.event = ouvinte => {
        this.ouvintes.push(ouvinte);
        return { dispose: () => { this.ouvintes = this.ouvintes.filter(o => o !== ouvinte); } };
      };
    }
    fire(v) { for (const o of [...this.ouvintes]) { o(v); } }
    dispose() { this.ouvintes = []; }
  },
  Disposable: class { dispose() {} },
  TreeItem: class { constructor(l) { this.label = l; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(i) { this.id = i; } },
  ThemeColor: class { constructor(i) { this.id = i; } },
  Position: class { constructor(l, c) { this.line = l; this.character = c; } },
  Range: class { constructor(a, b) { this.start = a; this.end = b; } },
  Selection: class { constructor(a, b) { this.anchor = a; this.active = b; } },
  Diagnostic: class {},
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  WorkspaceEdit: class { insert() {} replace() {} delete() {} createFile() {} },
  Task: class { constructor(d, sc, nome, src, exec) { this.definition = d; this.name = nome; this.execution = exec; } },
  ShellExecution: class { constructor(cmd, args, opts) { this.commandLine = cmd; this.options = opts; } },
  ShellQuoting: { Strong: 1 },
  TaskScope: { Workspace: 1 }, TaskGroup: { Build: 1, Clean: 2 },
  TaskRevealKind: { Always: 1 }, TaskPanelKind: { Shared: 1 },
  TextEditorRevealType: { InCenter: 2, InCenterIfOutsideViewport: 2 },
  CodeAction: class { constructor(titulo, tipo) { this.title = titulo; this.kind = tipo; } },
  CodeActionKind: { QuickFix: 'quickfix', Refactor: 'refactor' },
  SymbolInformation: class {
    constructor(nome, tipo, container, local) {
      this.name = nome; this.kind = tipo; this.containerName = container; this.location = local;
    }
  },
  ViewColumn: { Beside: -2 }, EndOfLine: { LF: 1, CRLF: 2 },
  ConfigurationTarget: { Workspace: 2 },
  DecorationRangeBehavior: { ClosedClosed: 1 },
  OverviewRulerLane: { Right: 4 },
  SymbolKind: {
    File: 0, Module: 1, Namespace: 2, Class: 4, Method: 5, Property: 6, Field: 7,
    Constructor: 8, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    Struct: 22, TypeParameter: 25, Object: 18,
  },
  DocumentSymbol: class {},
  RelativePattern: class {},
  MarkdownString: class { constructor(v) { this.value = v; } appendMarkdown() { return this; } },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { Window: 10, Notification: 15 },
  CustomTextEditorProvider: class {},
  FileType: { File: 1, Directory: 2 },
  extensions: { getExtension: () => undefined, all: [] },
  env: { openExternal: noop },
};


let instalado = false;
/** Intercepta require('vscode') no processo de teste. */
function instalar() {
  if (instalado) { return; }
  instalado = true;
  const orig = Module._load;
  Module._load = function (req) {
    if (req === 'vscode') { return vscode; }
    return orig.apply(this, arguments);
  };
}

module.exports = { vscode, instalar, comandos, handlers, tarefas, reset() {
  comandos.length = 0; tarefas.length = 0;
  for (const k of Object.keys(handlers)) { delete handlers[k]; }
} };
