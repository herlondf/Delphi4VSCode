/** Renomear unit no projeto inteiro. O que é seguro trocar está em `dfm/renomear`. */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  Ocorrencia, noCabecalho, noDproj, noDpr, noUses, qualificadosForaDoUses,
} from './dfm/renomear';

const NOME_VALIDO = /^[A-Za-z_][A-Za-z0-9_]*([.][A-Za-z_][A-Za-z0-9_]*)*$/;

function faixa(o: Ocorrencia): vscode.Range {
  return new vscode.Range(o.linha, o.coluna, o.linha, o.coluna + o.tamanho);
}

/** Onde procurar: só o que é fonte de projeto Delphi, e nunca o que é de terceiros. */
async function arquivos(): Promise<vscode.Uri[]> {
  const excluir = vscode.workspace.getConfiguration('delphi4vscode')
    .get<string[]>('symbols.excluir', []);
  const padrao = excluir.length ? `**/{${excluir.join(',')}}/**` : undefined;
  return vscode.workspace.findFiles('**/*.{pas,dpr,dproj}', padrao);
}

async function renomear(): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  const atual = ed?.document.uri;
  if (!atual || !/\.pas$/i.test(atual.fsPath)) {
    vscode.window.showWarningMessage('Abra o .pas da unit que você quer renomear.');
    return;
  }
  const velho = path.basename(atual.fsPath, path.extname(atual.fsPath));
  const novo = await vscode.window.showInputBox({
    title: `Renomear a unit ${velho}`,
    value: velho,
    prompt: 'O arquivo, o cabeçalho, os uses, o .dpr e o .dproj mudam juntos',
    validateInput: v => NOME_VALIDO.test(v.trim()) ? undefined : 'nome de unit inválido',
  });
  if (!novo || novo.trim() === velho) { return; }
  const alvo = novo.trim();

  const edicao = new vscode.WorkspaceEdit();
  const qualificados: string[] = [];
  let trocas = 0;

  for (const uri of await arquivos()) {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch { continue; }
    const texto = doc.getText();
    const ehDproj = /\.dproj$/i.test(uri.fsPath);
    const ehDpr = /\.dpr$/i.test(uri.fsPath);

    const pontos: Ocorrencia[] = ehDproj ? noDproj(texto, velho)
      : [...noUses(texto, velho), ...(ehDpr ? noDpr(texto, velho) : [])];
    if (uri.fsPath === atual.fsPath) {
      const cab = noCabecalho(texto, velho);
      if (cab) { pontos.push(cab); }
    }
    for (const p of pontos) { edicao.replace(uri, faixa(p), alvo); }
    trocas += pontos.length;

    if (!ehDproj) {
      for (const q of qualificadosForaDoUses(texto, velho)) {
        qualificados.push(`${vscode.workspace.asRelativePath(uri)}:${q.linha + 1}`);
      }
    }
  }

  /*
   * Renomear os arquivos entra na MESMA edição.
   *
   * Assim o Ctrl+Z desfaz tudo de uma vez. Renomear por fora e editar por dentro deixaria o
   * usuário com meio rename desfeito — que é pior que nenhum.
   */
  const dir = path.dirname(atual.fsPath);
  edicao.renameFile(atual, vscode.Uri.file(path.join(dir, `${alvo}.pas`)));
  const dfm = vscode.Uri.file(path.join(dir, `${velho}.dfm`));
  try {
    await vscode.workspace.fs.stat(dfm);
    edicao.renameFile(dfm, vscode.Uri.file(path.join(dir, `${alvo}.dfm`)));
  } catch { /* unit sem form: normal */ }

  if (qualificados.length) {
    const lista = qualificados.slice(0, 8).join(', ');
    const resto = qualificados.length > 8 ? ` e mais ${qualificados.length - 8}` : '';
    const acao = await vscode.window.showWarningMessage(
      `${velho} aparece qualificado (${velho}.Algo) fora de cláusula uses em ` +
      `${qualificados.length} lugar(es): ${lista}${resto}. Não dá para saber se é a unit ou ` +
      'uma variável de mesmo nome, então esses ficam como estão.',
      { modal: true }, 'Renomear assim mesmo');
    if (acao !== 'Renomear assim mesmo') { return; }
  }

  if (!await vscode.workspace.applyEdit(edicao)) {
    vscode.window.showErrorMessage('O VS Code recusou a edição.');
    return;
  }
  vscode.window.showInformationMessage(
    `${velho} → ${alvo}: ${trocas} referência(s). Ctrl+Z desfaz tudo.`);
}

export function registrarRenomear(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.renomearUnit', renomear));
}
