/**
 * Bloco B — fechar o ciclo sem a IDE: compilar, rodar, e mexer no `.dpr`.
 *
 * B01 roda o binário que o build acabou de gerar. Não é depurador — é o F9 sem breakpoint,
 * que é o que se usa em 90% das vezes: compilar, abrir, ver se a tela subiu.
 *
 * B02 acrescenta e remove units do `.dpr` sem abrir o Project Manager.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildManager } from './build';
import { registrarNoDpr } from './dfm/scaffold';
import { exeDoProjeto, unitsDoDpr } from './dfm/projeto';

async function rodar(build: BuildManager): Promise<void> {
  const p = build.projeto;
  if (!p) {
    vscode.window.showWarningMessage('Escolha o projeto ativo primeiro.');
    return;
  }
  const exe = exeDoProjeto(p.fsPath);
  if (!exe) {
    const acao = await vscode.window.showWarningMessage(
      'Não achei o executável. Compile antes de rodar.', 'Compilar agora');
    if (acao) { await vscode.commands.executeCommand('delphi4vscode.build'); }
    return;
  }
  /*
   * Um terminal, não um processo solto: o programa pode escrever no console, pode travar, e
   * o usuário precisa de onde matá-lo. Reaproveitar o mesmo terminal evita encher a barra.
   */
  const nome = `Delphi: ${path.basename(exe)}`;
  const existente = vscode.window.terminals.find(t => t.name === nome);
  const term = existente ?? vscode.window.createTerminal({ name: nome, cwd: path.dirname(exe) });
  term.show(true);
  term.sendText(`& "${exe}"`);
}

/** B02 — acrescenta ao `.dpr` a unit do arquivo aberto. */
async function acrescentarUnit(build: BuildManager): Promise<void> {
  const p = build.projeto;
  const editor = vscode.window.activeTextEditor;
  if (!p || !editor) {
    vscode.window.showWarningMessage('Abra o .pas e escolha o projeto ativo.');
    return;
  }
  const pas = editor.document.uri.fsPath;
  if (!/\.pas$/i.test(pas)) {
    vscode.window.showWarningMessage('O arquivo aberto não é um .pas.');
    return;
  }
  const dpr = p.fsPath.replace(/\.dproj$/i, '.dpr');
  if (!fs.existsSync(dpr)) {
    vscode.window.showWarningMessage(`Não achei ${path.basename(dpr)}.`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(dpr));
  const unit = path.basename(pas).replace(/\.pas$/i, '');
  const relativo = path.relative(path.dirname(dpr), pas).replace(/\//g, '\\');

  // o comentário do form no `uses` é o que faz a IDE listar a tela no Project Manager
  const dfm = pas.replace(/\.pas$/i, '.dfm');
  let variavel = '';
  let tipo: 'form' | 'datamodule' = 'form';
  if (fs.existsSync(dfm)) {
    const cabecalho = fs.readFileSync(dfm, 'latin1').replace(/^[^A-Za-z]+/, '');
    const m = /^(?:object|inherited|inline)\s+([\w.]+)\s*:\s*([\w.]+)/.exec(cabecalho);
    if (m) {
      variavel = m[1];
      if (/datamodule|datamod|^tdm/i.test(m[2])) { tipo = 'datamodule'; }
    }
  }

  let edicoes;
  try {
    edicoes = registrarNoDpr(doc.getText(), unit, relativo, variavel || unit, tipo);
  } catch (err) {
    vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    return;
  }
  if (!edicoes.length) {
    vscode.window.showInformationMessage(`${unit} já está no ${path.basename(dpr)}.`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  for (const e of edicoes) {
    if (e.kind === 'replace') { edit.replace(doc.uri, doc.lineAt(e.linha).range, e.texto); }
    else { edit.insert(doc.uri, new vscode.Position(e.linha, 0), e.texto + eol); }
  }
  await vscode.workspace.applyEdit(edit);
  vscode.window.showInformationMessage(`${unit} acrescentada ao ${path.basename(dpr)}.`);
}

/** B02 — tira do `.dpr` uma unit escolhida na lista. */
async function removerUnit(build: BuildManager): Promise<void> {
  const p = build.projeto;
  if (!p) {
    vscode.window.showWarningMessage('Escolha o projeto ativo primeiro.');
    return;
  }
  const dpr = p.fsPath.replace(/\.dproj$/i, '.dpr');
  if (!fs.existsSync(dpr)) { return; }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(dpr));
  const units = unitsDoDpr(doc.getText());
  if (!units.length) {
    vscode.window.showWarningMessage('Não achei units no uses do .dpr.');
    return;
  }
  const escolha = await vscode.window.showQuickPick(
    units.map(u => ({ label: u.unit, description: u.arquivo, linha: u.linha })),
    { title: `Remover do ${path.basename(dpr)}`, placeHolder: 'A unit sai só do projeto' });
  if (!escolha) { return; }

  const linha = doc.lineAt(escolha.linha);
  /*
   * A última entrada do `uses` termina em `;` e as outras em `,`. Tirar a última sem passar
   * o `;` para a anterior deixa o `.dpr` sem terminador — e o projeto não abre mais.
   */
  const ehUltima = /;\s*$/.test(linha.text);
  const edit = new vscode.WorkspaceEdit();
  edit.delete(doc.uri, linha.rangeIncludingLineBreak);
  if (ehUltima && escolha.linha > 0) {
    const anterior = doc.lineAt(escolha.linha - 1);
    edit.replace(doc.uri, anterior.range, anterior.text.replace(/,\s*$/, ';'));
  }
  await vscode.workspace.applyEdit(edit);
  vscode.window.showInformationMessage(
    `${escolha.label} removida do ${path.basename(dpr)}. O arquivo .pas continua no disco.`);
}

export function registrarExecutar(
  ctx: vscode.ExtensionContext, build: BuildManager,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.rodar', () => rodar(build)),
    vscode.commands.registerCommand('delphi4vscode.compilarERodar', async () => {
      await vscode.commands.executeCommand('delphi4vscode.build');
      vscode.window.showInformationMessage(
        'Compilando. Rode "Delphi: executar" quando o build terminar.');
    }),
    vscode.commands.registerCommand('delphi4vscode.acrescentarUnit', () => acrescentarUnit(build)),
    vscode.commands.registerCommand('delphi4vscode.removerUnit', () => removerUnit(build)),
  );
}
