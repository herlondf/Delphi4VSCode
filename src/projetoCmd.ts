/**
 * Os comandos do bloco E: verificar o projeto e resumir o que ele tem.
 *
 * O resultado vai para o painel Problems (navegável) e para um documento de texto — não para
 * uma notificação, porque é informação que se lê com calma e se volta a consultar.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildManager } from './build';
import { Registry } from './dfm/registry';
import { Achado, dfmOrfaos, resumoDoProjeto, verificarProjeto } from './dfm/projeto';

/** O `.dpr` do projeto ativo — é dele que tudo parte. */
function dprAtivo(build: BuildManager): string | undefined {
  const p = build.projeto?.fsPath;
  if (!p) { return undefined; }
  const dpr = p.replace(/\.dproj$/i, '.dpr');
  return fs.existsSync(dpr) ? dpr : undefined;
}

async function verificar(
  build: BuildManager, col: vscode.DiagnosticCollection,
): Promise<void> {
  const dpr = dprAtivo(build);
  if (!dpr) {
    vscode.window.showWarningMessage(
      'Escolha o projeto ativo primeiro — a verificação parte do .dpr dele.');
    return;
  }
  const raiz = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const achados: Achado[] = [
    ...verificarProjeto(dpr),
    ...dfmOrfaos([path.dirname(dpr), ...(raiz ? [raiz] : [])]),
  ];

  col.clear();
  const porArquivo = new Map<string, vscode.Diagnostic[]>();
  for (const a of achados) {
    const linha = a.linha ?? 0;
    const d = new vscode.Diagnostic(
      new vscode.Range(linha, 0, linha, 200), a.mensagem,
      a.gravidade === 'erro' ? vscode.DiagnosticSeverity.Error
                             : vscode.DiagnosticSeverity.Warning);
    d.source = 'projeto delphi';
    const lista = porArquivo.get(a.arquivo) ?? [];
    lista.push(d);
    porArquivo.set(a.arquivo, lista);
  }
  for (const [arquivo, ds] of porArquivo) {
    col.set(vscode.Uri.file(arquivo), ds);
  }

  if (!achados.length) {
    vscode.window.showInformationMessage(
      `${path.basename(dpr)}: nenhum problema de estrutura encontrado.`);
    return;
  }
  const erros = achados.filter(a => a.gravidade === 'erro').length;
  const acao = await vscode.window.showWarningMessage(
    `${erros} erro(s) e ${achados.length - erros} aviso(s) em ${path.basename(dpr)}.`,
    'Ver no painel Problems');
  if (acao) { await vscode.commands.executeCommand('workbench.actions.view.problems'); }
}

async function resumir(build: BuildManager, registry: () => Registry): Promise<void> {
  const dpr = dprAtivo(build);
  if (!dpr) {
    vscode.window.showWarningMessage('Escolha o projeto ativo primeiro.');
    return;
  }
  const reg = registry();
  const r = resumoDoProjeto(dpr,
    cls => reg.chain(cls).some(c => c.includes('datamodule')),
    cls => reg.chain(cls).some(c => c === 'tframe' || c === 'tcustomframe'));
  if (!r) {
    vscode.window.showWarningMessage('Não consegui ler o .dpr.');
    return;
  }

  const linhas = [
    `Projeto: ${r.projeto}`,
    ''.padEnd(60, '='),
    '',
    `Units no .dpr ......... ${r.units}`,
    `Forms ................. ${r.forms}`,
    `Data modules .......... ${r.dataModules}`,
    `Frames ................ ${r.frames}`,
    `Componentes ........... ${r.totalComponentes} (${r.componentes.length} classes)`,
    '',
    'Componentes mais usados',
    ''.padEnd(60, '-'),
  ];
  for (const [cls, n] of r.componentes.slice(0, 40)) {
    const [kind, fonte] = reg.kindSource(cls);
    linhas.push(`${String(n).padStart(6)}  ${cls.padEnd(34)} ${kind} (${fonte})`);
  }
  const semIndice = r.componentes.filter(([c]) => reg.chain(c).length <= 1);
  if (semIndice.length) {
    linhas.push('', 'Classes que o índice não conhece', ''.padEnd(60, '-'));
    for (const [cls, n] of semIndice.slice(0, 30)) {
      linhas.push(`${String(n).padStart(6)}  ${cls}`);
    }
    linhas.push('', 'Essas são desenhadas como caixa genérica. Se vierem de um pacote,',
                'ligue delphi4vscode.lerPacotes; se vierem de fonte, confira o search path.');
  }

  const doc = await vscode.workspace.openTextDocument({
    content: linhas.join('\n'), language: 'plaintext',
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

export function registrarProjetoCmd(
  ctx: vscode.ExtensionContext, build: BuildManager, registry: () => Registry,
): void {
  const col = vscode.languages.createDiagnosticCollection('projeto delphi');
  ctx.subscriptions.push(
    col,
    vscode.commands.registerCommand('delphi4vscode.verificarProjeto', () => verificar(build, col)),
    vscode.commands.registerCommand('delphi4vscode.resumoProjeto', () => resumir(build, registry)),
  );
}
