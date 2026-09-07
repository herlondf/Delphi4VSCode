/**
 * Ativação da extensão.
 *
 * O índice de classes é o que custa: varrer os .pas de VCL, DevExpress e do projeto leva
 * alguns segundos. Ele é construído uma vez, guardado no storage da extensão e revalidado
 * só quando as pastas mudam.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { migrarConfiguracoes } from './migrar';
import { Registry } from './dfm/registry';
import { decodeBinaryDfm, isBinaryDfm } from './dfm/binary';
import { DfmEditorProvider } from './editor';
import { DfmSymbolProvider } from './diagnostics';
import { registrarBuild } from './build';
import { registrarProjetosView } from './projectsView';
import { registrarLens } from './lens';
import { registrarPascalDiagnostics } from './pascalDiag';
import { registrarPascalNav } from './pascalNav';
import { registrarProjetoCmd } from './projetoCmd';
import { registrarExecutar } from './executar';
import { registrarLsp } from './lsp/cliente';
import { registrarNovoProjeto } from './novoProjetoCmd';
import { registrarFormatador } from './formatar';
import { registrarCodigo } from './codigoCmd';
import { registrarSimbolos } from './simbolosNav';
import { registrarTestes } from './testes';
import { registrarNovoForm } from './newForm';
import { Descoberta, descobrirFontes } from './dfm/sources';
import { lerPacotes, pacotesConhecidos } from './dfm/bpl';
import { acharRsvars } from './dfm/project';

import * as crypto from 'crypto';

/*
 * C05 — o cache é por conjunto de pastas, não um arquivo só.
 *
 * Com um arquivo único, abrir um segundo projeto invalidava o índice do primeiro e as duas
 * janelas ficavam reindexando uma contra a outra. O nome carrega o hash das raízes: cada
 * combinação tem o seu, e janelas com as mesmas pastas compartilham o mesmo arquivo.
 */
const CACHE_VERSION = 3;   // 2: nome declarado; 3: propriedades por classe (C04)

let registry = new Registry();
/** O projeto ativo entra na descoberta de fontes: é dele que sai o search path. */
let build: ReturnType<typeof registrarBuild> | undefined;

let canal: vscode.OutputChannel | undefined;

/** Canal separado do build: o que o Code Insight diz não tem a ver com compilar. */
function canalLsp(ctx: vscode.ExtensionContext): vscode.OutputChannel {
  if (!canal) {
    canal = vscode.window.createOutputChannel('Delphi Code Insight');
    ctx.subscriptions.push(canal);
  }
  return canal;
}

export function activate(ctx: vscode.ExtensionContext): void {
  void migrarConfiguracoes(ctx).then(movidas => {
    if (movidas.length) {
      vscode.window.showInformationMessage(
        `Delphi4VSCode: ${movidas.length} configurações trazidas do dfmview ` +
        `(${movidas.slice(0, 4).join(', ')}${movidas.length > 4 ? '…' : ''}).`);
    }
  });

  const diagnostics = vscode.languages.createDiagnosticCollection('dfm');
  ctx.subscriptions.push(diagnostics);

  const provider = new DfmEditorProvider(ctx, () => registry, diagnostics);
  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(DfmEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'dfm' }, new DfmSymbolProvider(() => registry)),
    vscode.commands.registerCommand('delphi4vscode.reindex', () => buildIndex(ctx, true)),
    vscode.commands.registerCommand('delphi4vscode.openAsText', openAsText),
    vscode.commands.registerCommand('delphi4vscode.openAsDesigner', openAsDesigner),
    /*
     * D05 — o designer não edita binário, mas converter destrava tudo.
     *
     * O Delphi lê `.dfm` em texto desde sempre e regrava no formato que o projeto usar; a
     * conversão é reversível pelo comando de gravar em binário. Sem isso, um form binário
     * era só leitura e ponto final.
     */
    vscode.commands.registerCommand('delphi4vscode.converterParaTexto', async () => {
      const uri = abaAtual();
      if (!uri || !ehForm(uri)) {
        vscode.window.showWarningMessage('Abra o .dfm que quer converter.');
        return;
      }
      const dados = fs.readFileSync(uri.fsPath);
      if (!isBinaryDfm(dados)) {
        vscode.window.showInformationMessage('Este .dfm já está em texto.');
        return;
      }
      const nome = path.basename(uri.fsPath);
      const resposta = await vscode.window.showWarningMessage(
        `Converter ${nome} para texto?`,
        { modal: true,
          detail: 'O arquivo é reescrito no lugar. Uma cópia do binário fica ao lado, ' +
                  `como ${nome}.bin. O Delphi abre as duas formas.` },
        'Converter');
      if (resposta !== 'Converter') { return; }
      try {
        fs.copyFileSync(uri.fsPath, uri.fsPath + '.bin');
        fs.writeFileSync(uri.fsPath, decodeBinaryDfm(dados), 'latin1');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Não consegui converter: ${err instanceof Error ? err.message : err}`);
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, DfmEditorProvider.viewType);
      vscode.window.showInformationMessage(
        `${nome} convertido. O binário original está em ${nome}.bin.`);
    }),
    vscode.commands.registerCommand('delphi4vscode.salvarBinario', async () => {
      const uri = abaAtual();
      const doc = uri && vscode.workspace.textDocuments
        .find(d => d.uri.toString() === uri.toString());
      if (!doc) {
        vscode.window.showWarningMessage('Abra o .dfm antes de gravá-lo em binário.');
        return;
      }
      await provider.salvarBinario(doc);
    }),
    vscode.commands.registerCommand('delphi4vscode.toggleLayout', () => {
      const uri = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      const alvo = uri && typeof uri === 'object' && 'uri' in uri
        ? (uri as { uri: vscode.Uri }).uri : undefined;
      if (alvo) { provider.toggleLayout(alvo); }
    }),
  );

  build = registrarBuild(ctx);
  registrarProjetosView(ctx, build);
  registrarNovoForm(ctx, build, () => registry);
  registrarNovoProjeto(ctx, build);
  registrarLens(ctx);
  registrarPascalDiagnostics(ctx);
  registrarPascalNav(ctx, () => registry);
  registrarProjetoCmd(ctx, build, () => registry);
  registrarExecutar(ctx, build);
  /*
   * O servidor sobe depois de tudo e sem travar a ativação: ele lê o projeto inteiro antes de
   * responder, e o designer não deve ficar esperando por isso. Se não subir, o índice próprio
   * continua atendendo — é por isso que os dois convivem.
   */
  void registrarLsp(ctx, build, canalLsp(ctx));
  registrarFormatador(ctx, canalLsp(ctx));
  registrarCodigo(ctx, () => registry);
  registrarSimbolos(ctx, build, canalLsp(ctx));
  registrarTestes(ctx, build, canalLsp(ctx));
  vigiarFontes(ctx);
  sincronizarSelecao(ctx, provider);
  void loadIndex(ctx);
}

/**
 * C06 — reindexa sozinho quando um .pas muda.
 *
 * Uma varredura completa leva segundos e não cabe a cada Ctrl+S. Como o índice é
 * incremental por arquivo, dá para reler só o que mudou; a varredura inteira fica para
 * quando o conjunto de pastas muda.
 */
function vigiarFontes(ctx: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.pas');
  const reler = (uri: vscode.Uri): void => {
    if (!registry.size) { return; }
    try {
      registry.rescanFile(uri.fsPath);
    } catch { /* arquivo em trânsito: a próxima gravação resolve */ }
  };
  ctx.subscriptions.push(
    watcher,
    watcher.onDidChange(reler),
    watcher.onDidCreate(reler),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('delphi4vscode.sourcePaths')) { void buildIndex(ctx, true); }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void buildIndex(ctx, false)),
  );
}

/**
 * C03 — mover o cursor no .dfm em texto seleciona o componente no designer.
 *
 * O caminho inverso já existia (`reveal`). Com os dois, dá para deixar texto e designer lado
 * a lado e navegar por qualquer um dos dois.
 */
function sincronizarSelecao(
  ctx: vscode.ExtensionContext, provider: DfmEditorProvider,
): void {
  ctx.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(e => {
      const doc = e.textEditor.document;
      if (!ehForm(doc.uri)) { return; }
      provider.selecionarPorLinha(doc.uri, e.selections[0].active.line);
    }),
  );
}

export function deactivate(): void { /* nada a desfazer */ }

function cachePath(ctx: vscode.ExtensionContext, roots: string[]): string {
  const chave = crypto.createHash('sha1')
    .update(roots.map(r => r.toLowerCase()).join('|')).digest('hex').slice(0, 12);
  return path.join(ctx.globalStorageUri.fsPath, `registry-${chave}.json`);
}

/**
 * Pastas a indexar, descobertas em vez de perguntadas.
 *
 * Sai do `.dproj` ativo, do `EnvOptions.proj` do usuário e do `source` da instalação — os
 * mesmos lugares de onde o compilador tira o search path. `delphi4vscode.sourcePaths` continua
 * valendo, mas como acréscimo: quem não configurar nada tem o índice certo mesmo assim.
 */
function descobrir(): Descoberta {
  const cfg = vscode.workspace.getConfiguration('delphi4vscode');
  const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  // `bdsBinPath` guarda a pasta bin; `acharRsvars` devolve o caminho do .bat dentro dela
  const configurado = cfg.get<string>('bdsBinPath', '');
  const rsvars = configurado ? path.join(configurado, 'rsvars.bat') : acharRsvars('');
  return descobrirFontes({
    dproj: build?.projeto?.fsPath,
    bdsBin: rsvars ? path.dirname(rsvars) : undefined,
    versaoBds: versaoDe(rsvars),
    plataforma: cfg.get<string>('buildPlatform', 'Win32'),
    workspace: folders,
    configurados: cfg.get<string[]>('sourcePaths', []),
  });
}

/** `...\Studio\22.0\bin\rsvars.bat` -> `22.0`, que é como o EnvOptions.proj é indexado. */
function versaoDe(rsvars: string | undefined): string | undefined {
  const m = rsvars ? /[\\/](\d+\.\d+)[\\/]/.exec(rsvars) : null;
  return m ? m[1] : undefined;
}

function sourceRoots(): string[] {
  return descobrir().fontes.map(f => f.dir);
}

async function loadIndex(ctx: vscode.ExtensionContext): Promise<void> {
  const roots = sourceRoots();
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(ctx, roots), 'utf8'));
    if (raw.version === CACHE_VERSION && sameRoots(raw.roots, roots)) {
      registry = Registry.fromJSON(raw.data);
      return;
    }
  } catch { /* sem cache: constrói */ }
  await buildIndex(ctx, false);
}

function gravarCache(ctx: vscode.ExtensionContext, roots: string[]): void {
  try {
    fs.mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
    fs.writeFileSync(cachePath(ctx, roots),
      JSON.stringify({ version: CACHE_VERSION, roots, data: registry.toJSON() }));
  } catch { /* cache é otimização, não requisito */ }
}

function sameRoots(a: unknown, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

async function buildIndex(ctx: vscode.ExtensionContext, explicito: boolean): Promise<void> {
  const roots = sourceRoots();
  if (!roots.length) {
    if (explicito) {
      vscode.window.showWarningMessage(
        'Nenhuma pasta para indexar. Configure delphi4vscode.sourcePaths ou abra um workspace.');
    }
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Indexando classes Delphi...' },
    async () => {
      const reg = new Registry();
      reg.scan(roots);
      registry = reg;
      gravarCache(ctx, roots);
    });
  void indexarPacotes(ctx, explicito);
  if (explicito) {
    const d = descobrir();
    const porOrigem = new Map<string, number>();
    for (const f of d.fontes) { porOrigem.set(f.origem, (porOrigem.get(f.origem) ?? 0) + 1); }
    const resumo = [...porOrigem].map(([o, n]) => `${n} do ${o}`).join(', ');
    vscode.window.showInformationMessage(
      `${registry.size} classes indexadas de ${d.fontes.length} pastas (${resumo}).`);
  }
}

/** `.dfm` do VCL ou `.fmx` do FireMonkey: o designer abre os dois (C08). */
function ehForm(uri: vscode.Uri): boolean {
  return /[.](dfm|fmx)$/i.test(uri.path);
}

/**
 * A03 — completa o índice com as classes que só existem compiladas.
 *
 * Roda depois do índice de fonte e sem bloquear: são 300 e poucos pacotes, uns 25 segundos.
 * O que vem daqui nunca sobrescreve o que veio de `.pas` — só preenche o que falta, que é o
 * caso do componente comercial distribuído sem fonte.
 */
async function indexarPacotes(ctx: vscode.ExtensionContext, explicito: boolean): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('delphi4vscode');
  if (!cfg.get<boolean>('lerPacotes', true)) { return; }
  const rsvars = cfg.get<string>('bdsBinPath', '') || acharRsvars('') || '';
  const versao = versaoDe(rsvars);
  if (!versao) { return; }

  const arquivos = pacotesConhecidos(versao, rsvars ? path.dirname(rsvars) : undefined);
  if (!arquivos.length) { return; }
  await new Promise(r => setTimeout(r, explicito ? 0 : 3000));   // deixa a janela abrir antes
  const r = lerPacotes(arquivos);
  const novas = registry.absorverBpl(r.classes);
  if (!novas) { return; }
  gravarCache(ctx, sourceRoots());
  if (explicito) {
    vscode.window.showInformationMessage(
      `${novas} classes vieram dos ${r.arquivosLidos} pacotes compilados.`);
  }
}

function abaAtual(): vscode.Uri | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (tab && typeof tab === 'object' && 'uri' in tab) {
    return (tab as { uri: vscode.Uri }).uri;
  }
  return vscode.window.activeTextEditor?.document.uri;
}

async function openAsText(): Promise<void> {
  const uri = abaAtual();
  if (uri) { await vscode.commands.executeCommand('vscode.openWith', uri, 'default'); }
}

/** Caminho de volta: do texto para o designer, como o Alt+F12 do Delphi. */
async function openAsDesigner(): Promise<void> {
  const uri = abaAtual();
  if (!uri) { return; }
  if (!ehForm(uri)) {
    vscode.window.showInformationMessage('O designer abre .dfm e .fmx.');
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', uri, DfmEditorProvider.viewType);
}
