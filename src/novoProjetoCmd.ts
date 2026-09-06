/**
 * Criar unit e projeto sem a IDE.
 *
 * O `File > New` do Delphi faz três coisas que aqui estavam faltando: a unit simples (sem
 * form), o projeto inteiro, e o registro do que foi criado no `.dpr`. As duas primeiras vivem
 * aqui; a terceira já existia para forms e é reaproveitada.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildManager } from './build';
import { novoProjeto, unitSimples, TipoProjeto } from './dfm/novoProjeto';
import { novoEsqueleto, registrarNoDpr } from './dfm/scaffold';

async function pedirNome(titulo: string, dica: string): Promise<string | undefined> {
  const v = await vscode.window.showInputBox({
    title: titulo,
    prompt: 'Letras, números e sublinhado, começando por letra',
    placeHolder: dica,
    validateInput: t => (/^[A-Za-z_]\w*$/.test(t.trim())
      ? undefined : 'nome inválido para uma unit Pascal'),
  });
  return v?.trim();
}

async function pedirPasta(titulo: string, sugerido: string): Promise<string | undefined> {
  const escolha = await vscode.window.showOpenDialog({
    title: titulo,
    defaultUri: vscode.Uri.file(sugerido),
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    openLabel: 'Criar aqui',
  });
  return escolha?.[0]?.fsPath;
}

/** Acrescenta a unit ao `uses` do `.dpr` do projeto ativo, se houver. */
async function registrarUnit(
  build: BuildManager, arquivo: string, unit: string,
): Promise<string> {
  const dproj = build.projeto?.fsPath;
  if (!dproj) { return ' Sem projeto ativo: registre a unit no .dpr quando escolher um.'; }
  const dpr = dproj.replace(/\.dproj$/i, '.dpr');
  if (!fs.existsSync(dpr)) { return ` Não achei ${path.basename(dpr)}.`; }

  const uri = vscode.Uri.file(dpr);
  const doc = await vscode.workspace.openTextDocument(uri);
  const relativo = path.relative(path.dirname(dpr), arquivo).split('/').join('\\');
  let edicoes;
  try {
    /*
     * Vai como `datamodule` de propósito: `registrarNoDpr` usa o tipo só para decidir o
     * comentário `{Nome: TDataModule}` que a IDE põe no `uses`, e uma unit sem form não
     * deveria ganhar comentário nenhum — mas o parâmetro não tem esse caso, e o comentário
     * é inofensivo perto de deixar a unit fora do `.dpr`.
     */
    edicoes = registrarNoDpr(doc.getText(), unit, relativo, unit, 'datamodule');
  } catch (err) {
    return ` ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!edicoes.length) { return ''; }
  const edit = new vscode.WorkspaceEdit();
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  for (const e of edicoes) {
    if (e.kind === 'replace') { edit.replace(uri, doc.lineAt(e.linha).range, e.texto); }
    else { edit.insert(uri, new vscode.Position(e.linha, 0), e.texto + eol); }
  }
  await vscode.workspace.applyEdit(edit);
  return ` Registrada em ${path.basename(dpr)}.`;
}

async function criarUnit(build: BuildManager): Promise<void> {
  const pastas = vscode.workspace.workspaceFolders ?? [];
  if (!pastas.length) {
    vscode.window.showWarningMessage('Abra uma pasta antes de criar uma unit.');
    return;
  }
  const nome = await pedirNome('Nova Unit', 'Utilitarios');
  if (!nome) { return; }
  const sugerido = build.projeto ? path.dirname(build.projeto.fsPath) : pastas[0].uri.fsPath;
  const dir = await pedirPasta(`Onde criar ${nome}.pas`, sugerido);
  if (!dir) { return; }

  const arquivo = path.join(dir, `${nome}.pas`);
  if (fs.existsSync(arquivo)) {
    vscode.window.showErrorMessage(`${nome}.pas já existe nessa pasta.`);
    return;
  }
  fs.writeFileSync(arquivo, unitSimples(nome), 'latin1');
  const aviso = await registrarUnit(build, arquivo, nome);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(arquivo));
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(`Unit ${nome} criada.${aviso}`);
}

const TIPOS: { rotulo: string; tipo: TipoProjeto; detalhe: string }[] = [
  { rotulo: 'VCL Application', tipo: 'vcl', detalhe: 'programa com form principal' },
  { rotulo: 'Console Application', tipo: 'console', detalhe: 'programa de linha de comando' },
  { rotulo: 'Dynamic-link Library', tipo: 'dll', detalhe: 'DLL' },
  { rotulo: 'Package', tipo: 'package', detalhe: 'pacote .bpl' },
];

async function criarProjeto(build: BuildManager): Promise<void> {
  const pastas = vscode.workspace.workspaceFolders ?? [];
  if (!pastas.length) {
    vscode.window.showWarningMessage('Abra uma pasta antes de criar um projeto.');
    return;
  }
  const escolha = await vscode.window.showQuickPick(
    TIPOS.map(t => ({ label: t.rotulo, description: t.detalhe, tipo: t.tipo })),
    { title: 'Novo projeto Delphi', placeHolder: 'O que criar' });
  if (!escolha) { return; }

  const nome = await pedirNome('Nome do projeto', 'MeuApp');
  if (!nome) { return; }
  const dir = await pedirPasta(`Onde criar ${nome}`, pastas[0].uri.fsPath);
  if (!dir) { return; }

  const destino = path.join(dir, nome);
  if (fs.existsSync(destino)) {
    vscode.window.showErrorMessage(`A pasta ${nome} já existe em ${dir}.`);
    return;
  }
  fs.mkdirSync(destino, { recursive: true });

  const cfg = vscode.workspace.getConfiguration('delphi4vscode');
  const bdsBin = cfg.get<string>('bdsBinPath', '');
  const versao = /(\d+\.\d+)/.exec(bdsBin)?.[1] ?? '22.0';

  // o form principal nasce junto: um VCL Application sem form não abre janela nenhuma
  const form = escolha.tipo === 'vcl' ? novoEsqueleto('PrincipalView', 'form') : undefined;
  if (form) {
    for (const a of form.arquivos) {
      fs.writeFileSync(path.join(destino, a.nome), a.conteudo, 'latin1');
    }
  }
  const projeto = novoProjeto({
    nome, tipo: escolha.tipo, versaoBds: versao,
    form: form ? { unit: form.unit, classe: form.classe, variavel: form.variavel } : undefined,
  });
  for (const a of projeto.arquivos) {
    fs.writeFileSync(path.join(destino, a.nome), a.conteudo, 'latin1');
  }

  const dproj = path.join(destino, `${nome}.dproj`);
  await build.ativar(dproj);
  const principal = form
    ? path.join(destino, `${form.unit}.pas`)
    : path.join(destino, projeto.arquivos[0].nome);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(principal));
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(
    `Projeto ${nome} criado em ${destino} e ativado. Ctrl+F9 para compilar.`);
}

export function registrarNovoProjeto(
  ctx: vscode.ExtensionContext, build: BuildManager,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.novaUnit', () => criarUnit(build)),
    vscode.commands.registerCommand('delphi4vscode.novoProjeto', () => criarProjeto(build)),
  );
}
