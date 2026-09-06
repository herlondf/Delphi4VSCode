/**
 * Comandos de criar form, frame e data module.
 *
 * Escreve os dois arquivos, registra no `.dpr` do projeto ativo e abre o novo form no
 * designer — que é o ciclo completo sem passar pela IDE.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Modelo1, Opcoes, TipoNovo, novoEsqueleto, registrarNoDpr } from './dfm/scaffold';
import { classesComDfm } from './dfm/insert';
import { Registry } from './dfm/registry';
import { BuildManager } from './build';
import { DfmEditorProvider } from './editor';

const ROTULO: Record<TipoNovo, string> = {
  form: 'Form', frame: 'Frame', datamodule: 'Data Module',
};

interface OpcaoModelo extends vscode.QuickPickItem {
  modelo?: Modelo1;
  herdar?: boolean;
}

const MODELOS: OpcaoModelo[] = [
  { label: 'Form em branco', modelo: 'vazio' },
  { label: 'Diálogo', description: 'OK e Cancelar já ligados no ModalResult',
    modelo: 'dialogo' },
  { label: 'Consulta', description: 'painel no topo e grade ocupando o resto',
    modelo: 'consulta' },
  { label: 'Herdar de um form do projeto',
    description: 'o .dfm nasce como inherited', herdar: true },
];

/** N04/N05 — só faz sentido para form; frame e data module vão direto ao esqueleto. */
async function escolherModelo(reg: Registry): Promise<Opcoes | undefined> {
  const escolha = await vscode.window.showQuickPick(MODELOS, {
    title: 'Novo Form', placeHolder: 'A partir de quê?',
  });
  if (!escolha) { return undefined; }
  if (!escolha.herdar) { return { modelo: escolha.modelo }; }

  const bases = classesComDfm(reg, 'tform');
  if (!bases.length) {
    vscode.window.showWarningMessage(
      'Nenhum form com .dfm foi encontrado nas pastas indexadas.');
    return undefined;
  }
  const pai = await vscode.window.showQuickPick(
    bases.map(b => ({ label: b.cls, description: b.unit })),
    { title: 'Herdar de', placeHolder: 'Form ancestral' });
  if (!pai) { return undefined; }
  return { ancestral: { cls: pai.label, unit: pai.description! } };
}

async function criar(tipo: TipoNovo, build: BuildManager, reg: Registry): Promise<void> {
  const pastas = vscode.workspace.workspaceFolders ?? [];
  if (!pastas.length) {
    vscode.window.showWarningMessage('Abra uma pasta antes de criar um form.');
    return;
  }

  const unit = await vscode.window.showInputBox({
    title: `Novo ${ROTULO[tipo]}`,
    prompt: 'Nome da unit (vira o nome do arquivo e da classe)',
    placeHolder: tipo === 'datamodule' ? 'Dados' : 'Cadastro',
    validateInput: v => /^[A-Za-z_]\w*$/.test(v.trim())
      ? undefined : 'só letras, números e sublinhado, começando por letra',
  });
  if (!unit) { return; }

  // por padrão, ao lado do projeto ativo — que é onde o resto do time põe
  const projeto = build.projeto?.fsPath;
  const sugerido = projeto ? path.dirname(projeto) : pastas[0].uri.fsPath;
  const destino = await vscode.window.showOpenDialog({
    title: `Onde criar ${unit}`,
    defaultUri: vscode.Uri.file(sugerido),
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    openLabel: 'Criar aqui',
  });
  if (!destino?.length) { return; }
  const dir = destino[0].fsPath;

  let opcoes: Opcoes = {};
  if (tipo === 'form') {
    const escolhido = await escolherModelo(reg);
    if (!escolhido) { return; }
    opcoes = escolhido;
  }

  const esqueleto = novoEsqueleto(unit.trim(), tipo, opcoes);
  const existentes = esqueleto.arquivos
    .map(a => path.join(dir, a.nome))
    .filter(p => fs.existsSync(p));
  if (existentes.length) {
    vscode.window.showErrorMessage(
      `Já existe: ${existentes.map(p => path.basename(p)).join(', ')}`);
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const arquivo of esqueleto.arquivos) {
    const uri = vscode.Uri.file(path.join(dir, arquivo.nome));
    edit.createFile(uri, { overwrite: false });
    edit.insert(uri, new vscode.Position(0, 0), arquivo.conteudo);
  }
  if (!await vscode.workspace.applyEdit(edit)) {
    vscode.window.showErrorMessage('Não consegui criar os arquivos.');
    return;
  }

  const aviso = await registrarNoProjeto(build, dir, esqueleto.unit, esqueleto.variavel, tipo);

  const dfmUri = vscode.Uri.file(path.join(dir, `${esqueleto.unit}.dfm`));
  await vscode.commands.executeCommand('vscode.openWith', dfmUri, DfmEditorProvider.viewType);
  vscode.window.showInformationMessage(
    `${ROTULO[tipo]} ${esqueleto.classe} criado.${aviso}`);
}

/**
 * N02 — sem entrar no `uses` do `.dpr`, a unit compila mas não vai para o executável.
 * Se não houver projeto ativo, avisa em vez de deixar passar em silêncio.
 */
async function registrarNoProjeto(
  build: BuildManager, dir: string, unit: string, variavel: string, tipo: TipoNovo,
): Promise<string> {
  const dproj = build.projeto?.fsPath;
  if (!dproj) {
    return ' Sem projeto ativo: lembre de registrar a unit no .dpr.';
  }
  const dpr = dproj.replace(/\.dproj$/i, '.dpr');
  if (!fs.existsSync(dpr)) {
    return ` Não achei ${path.basename(dpr)}: registre a unit manualmente.`;
  }
  const uri = vscode.Uri.file(dpr);
  const doc = await vscode.workspace.openTextDocument(uri);
  const relativo = path.relative(path.dirname(dpr), path.join(dir, `${unit}.pas`))
    .replace(/\//g, '\\');

  let edicoes;
  try {
    edicoes = registrarNoDpr(doc.getText(), unit, relativo, variavel, tipo);
  } catch (err) {
    return ` ${err instanceof Error ? err.message : err}`;
  }
  if (!edicoes.length) { return ''; }

  const edit = new vscode.WorkspaceEdit();
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  for (const e of edicoes) {
    if (e.kind === 'replace') {
      edit.replace(uri, doc.lineAt(e.linha).range, e.texto);
    } else {
      edit.insert(uri, new vscode.Position(e.linha, 0), e.texto + eol);
    }
  }
  await vscode.workspace.applyEdit(edit);
  return ` Registrado em ${path.basename(dpr)}.`;
}

export function registrarNovoForm(
  ctx: vscode.ExtensionContext, build: BuildManager, reg: () => Registry,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.novoForm', () => criar('form', build, reg())),
    vscode.commands.registerCommand('delphi4vscode.novoFrame', () => criar('frame', build, reg())),
    vscode.commands.registerCommand('delphi4vscode.novoDataModule',
      () => criar('datamodule', build, reg())),
  );
}
