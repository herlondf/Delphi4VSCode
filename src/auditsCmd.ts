/** Comando de auditoria. O parser e o porquê estão em `dfm/audits`. */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildManager } from './build';
import { instalacoesBds } from './dfm/project';
import { Achado, argumentosAudits, lerAchados, raizDoProjeto } from './dfm/audits';

/** `severity` do XML: 0 Info, 1 Warning, 2 Error, 3 Fatal. */
const GRAVIDADE = [
  vscode.DiagnosticSeverity.Information,
  vscode.DiagnosticSeverity.Warning,
  vscode.DiagnosticSeverity.Error,
  vscode.DiagnosticSeverity.Error,
];

/** O binário só existe do RAD Studio 11 em diante; procura em todas as instalações. */
export function acharAudits(): string | undefined {
  const posto = vscode.workspace.getConfiguration('delphi4vscode')
    .get<string>('audits.exe', '').trim();
  if (posto) { return fs.existsSync(posto) ? posto : undefined; }
  for (const i of instalacoesBds()) {
    const alvo = path.join(path.dirname(i.rsvars), 'AuditsCLI.exe');
    if (fs.existsSync(alvo)) { return alvo; }
  }
  return undefined;
}

function paraDiagnosticos(
  achados: Achado[], raiz: string, col: vscode.DiagnosticCollection,
): number {
  const porArquivo = new Map<string, vscode.Diagnostic[]>();
  for (const a of achados) {
    const arquivo = path.resolve(raiz, a.arquivo);
    const linha = Math.max(0, a.linha - 1);
    const d = new vscode.Diagnostic(
      new vscode.Range(linha, 0, linha, 4096),
      `${a.mensagem} [${a.id}]`,
      GRAVIDADE[a.severidade] ?? vscode.DiagnosticSeverity.Information);
    d.source = 'Delphi Audits';
    d.code = a.id;
    if (a.relacionados.length) {
      d.relatedInformation = a.relacionados.map(r => new vscode.DiagnosticRelatedInformation(
        new vscode.Location(
          vscode.Uri.file(path.resolve(raiz, r.arquivo)),
          new vscode.Position(Math.max(0, r.linha - 1), 0)),
        r.mensagem));
    }
    const lista = porArquivo.get(arquivo) ?? [];
    lista.push(d);
    porArquivo.set(arquivo, lista);
  }
  col.clear();
  for (const [arquivo, ds] of porArquivo) { col.set(vscode.Uri.file(arquivo), ds); }
  return achados.length;
}

async function auditar(
  build: BuildManager, col: vscode.DiagnosticCollection, canal: vscode.OutputChannel,
): Promise<void> {
  const p = await build.garantirProjeto(true);
  if (!p) { return; }
  const exe = acharAudits();
  if (!exe) {
    vscode.window.showWarningMessage(
      'Não achei o AuditsCLI.exe. Ele vem no RAD Studio 11 (22.0) em diante; ' +
      'aponte o caminho em delphi4vscode.audits.exe se estiver noutro lugar.');
    return;
  }
  const saida = path.join(os.tmpdir(), `d4v-audits-${Date.now().toString(36)}.xml`);
  const args = argumentosAudits(p.fsPath, saida, build.alvoAtual.config);
  canal.appendLine(`audits: ${exe} ${args.join(' ')}`);

  /*
   * Progresso cancelável, e não uma barra indeterminada que o usuário não pode interromper:
   * a ferramenta analisa o projeto inteiro e passa de 15 minutos num projeto grande.
   */
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Auditoria de ${p.nome} — o AuditsCLI analisa o projeto inteiro`,
    cancellable: true,
  }, (progresso, token) => new Promise<void>(resolve => {
    const proc = cp.spawn(exe, args, { windowsHide: true });
    token.onCancellationRequested(() => proc.kill());
    proc.stdout.on('data', (d: Buffer) => {
      const texto = d.toString().trim();
      if (!texto) { return; }
      canal.append(`${texto}\n`);
      const ultima = texto.split(/\r?\n/).filter(Boolean).pop();
      if (ultima) { progresso.report({ message: ultima.slice(0, 80) }); }
    });
    proc.stderr.on('data', (d: Buffer) => canal.append(d.toString()));
    proc.on('error', err => {
      vscode.window.showErrorMessage(`Não consegui rodar o AuditsCLI: ${err.message}`);
      resolve();
    });
    proc.on('close', () => {
      if (token.isCancellationRequested) { resolve(); return; }
      let xml = '';
      try {
        xml = fs.readFileSync(saida, 'utf8');
      } catch {
        vscode.window.showWarningMessage('O AuditsCLI terminou sem gerar o relatório.');
        resolve();
        return;
      }
      const achados = lerAchados(xml);
      const raiz = raizDoProjeto(xml) || path.dirname(p.fsPath);
      const n = paraDiagnosticos(achados, raiz, col);
      fs.rmSync(saida, { force: true });
      vscode.window.showInformationMessage(
        n ? `Auditoria: ${n} achados no painel Problems.` : 'Auditoria: nada a apontar.');
      resolve();
    });
  }));
}

export function registrarAudits(
  ctx: vscode.ExtensionContext, build: BuildManager, canal: vscode.OutputChannel,
): void {
  const col = vscode.languages.createDiagnosticCollection('delphi-audits');
  ctx.subscriptions.push(
    col,
    vscode.commands.registerCommand('delphi4vscode.auditar', () => auditar(build, col, canal)),
    vscode.commands.registerCommand('delphi4vscode.limparAuditoria', () => col.clear()));
}
