/** Ícone e informações de versão do executável. A lógica está em `dfm/verinfo`. */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildManager } from './build';
import {
  analisarVersao, escreverChaves, gravar, gravarVersao, incrementarBuild, ler, lerChaves,
  lerVersao, mapear, textoVersao,
} from './dfm/verinfo';

/** As chaves que o Explorer mostra na aba Detalhes, na ordem em que ele mostra. */
const CHAVES_UTEIS = [
  'CompanyName', 'FileDescription', 'ProductName', 'LegalCopyright', 'InternalName',
  'OriginalFilename', 'Comments',
];

async function comXml(
  build: BuildManager, aplicar: (xml: string) => Promise<string | undefined>,
): Promise<void> {
  const p = await build.garantirProjeto(true);
  if (!p) { return; }
  let xml: string;
  try {
    xml = fs.readFileSync(p.fsPath, 'utf8');
  } catch (err) {
    vscode.window.showErrorMessage(`Não consegui ler o .dproj: ${err}`);
    return;
  }
  const novo = await aplicar(xml);
  if (novo === undefined || novo === xml) { return; }
  try {
    fs.writeFileSync(p.fsPath, novo, 'utf8');
  } catch (err) {
    vscode.window.showErrorMessage(`Não consegui gravar o .dproj: ${err}`);
  }
}

async function versao(build: BuildManager): Promise<void> {
  await comXml(build, async xml => {
    const atual = lerVersao(xml);
    const escolha = await vscode.window.showQuickPick([
      { label: `$(arrow-up) Incrementar o build`,
        description: `${textoVersao(atual)} → ${textoVersao(incrementarBuild(atual))}`, id: 'inc' },
      { label: '$(edit) Digitar a versão', description: textoVersao(atual), id: 'set' },
      { label: '$(list-unordered) Editar uma chave', description: 'CompanyName, FileDescription…', id: 'chave' },
    ], { title: `Informações de versão — ${path.basename(build.projeto!.fsPath)}` });
    if (!escolha) { return undefined; }

    if (escolha.id === 'inc') {
      const nova = incrementarBuild(atual);
      vscode.window.showInformationMessage(`Versão: ${textoVersao(nova)}`);
      return gravarVersao(xml, nova);
    }
    if (escolha.id === 'set') {
      const texto = await vscode.window.showInputBox({
        title: 'Versão', value: textoVersao(atual), prompt: 'major.minor.release.build',
        validateInput: v => analisarVersao(v) ? undefined : 'quatro números separados por ponto',
      });
      const nova = texto && analisarVersao(texto);
      return nova ? gravarVersao(xml, nova) : undefined;
    }

    const bruto = ler(xml, 'VerInfo_Keys') ?? '';
    const chaves = lerChaves(bruto);
    const nomes = [...new Set([...CHAVES_UTEIS, ...chaves.keys()])];
    const qual = await vscode.window.showQuickPick(
      nomes.map(n => ({ label: n, description: chaves.get(n) || '(vazio)' })),
      { title: 'Qual chave' });
    if (!qual) { return undefined; }
    const valor = await vscode.window.showInputBox({
      title: qual.label, value: chaves.get(qual.label) ?? '',
    });
    if (valor === undefined) { return undefined; }
    /*
     * A chave é escrita em cada configuração a partir das chaves DELA. Copiar o conjunto
     * inteiro da primeira por cima das outras apagaria a diferença entre elas.
     */
    return mapear(xml, 'VerInfo_Keys', atualKeys => {
      const c = lerChaves(atualKeys);
      c.set(qual.label, valor);
      return escreverChaves(c);
    });
  });
}

async function icone(build: BuildManager): Promise<void> {
  await comXml(build, async xml => {
    const atual = ler(xml, 'Icon_MainIcon') ?? '(padrão do Delphi)';
    const escolhido = await vscode.window.showOpenDialog({
      title: `Ícone do executável — atual: ${atual}`,
      filters: { 'Ícone do Windows': ['ico'] },
      canSelectMany: false,
      openLabel: 'Usar este ícone',
    });
    if (!escolhido?.length) { return undefined; }
    /*
     * Caminho relativo ao `.dproj`, quando o ícone está no repositório: caminho absoluto de
     * máquina num arquivo de projeto quebra para todo mundo que não seja quem o gravou.
     */
    const base = path.dirname(build.projeto!.fsPath);
    const alvo = escolhido[0].fsPath;
    const rel = path.relative(base, alvo);
    const valor = rel.startsWith('..') ? alvo : rel;
    vscode.window.showInformationMessage(`Ícone: ${valor}. Recompile para o executável mudar.`);
    return gravar(xml, 'Icon_MainIcon', valor);
  });
}

export function registrarVerInfo(ctx: vscode.ExtensionContext, build: BuildManager): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('delphi4vscode.versaoDoApp', () => versao(build)),
    vscode.commands.registerCommand('delphi4vscode.iconeDoApp', () => icone(build)));
}
