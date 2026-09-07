/**
 * Ctrl+T (ir a símbolo no projeto) e Shift+F12 (achar usos).
 *
 * Os dois faltavam porque o DelphiLSP não oferece nem `workspaceSymbol` nem `references` —
 * está na resposta do `initialize` dele. São justamente as duas coisas que se usa o dia
 * inteiro para andar num projeto grande, e é por isso que valem um índice próprio em vez de
 * esperar a Embarcadero.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IndiceSimbolos, Simbolo, TipoSimbolo } from './dfm/simbolos';
import { BuildManager } from './build';

const ICONE: Record<TipoSimbolo, vscode.SymbolKind> = {
  classe: vscode.SymbolKind.Class,
  interface: vscode.SymbolKind.Interface,
  record: vscode.SymbolKind.Struct,
  metodo: vscode.SymbolKind.Method,
  funcao: vscode.SymbolKind.Function,
  constante: vscode.SymbolKind.Constant,
  tipo: vscode.SymbolKind.TypeParameter,
  variavel: vscode.SymbolKind.Variable,
};

const indice = new IndiceSimbolos();
let raizes: string[] = [];

function localDe(s: Simbolo): vscode.Location {
  return new vscode.Location(
    vscode.Uri.file(s.arquivo), new vscode.Position(s.linha, 0));
}

class SimbolosDoProjeto implements vscode.WorkspaceSymbolProvider {
  provideWorkspaceSymbols(consulta: string): vscode.SymbolInformation[] {
    return indice.buscar(consulta).map(s => new vscode.SymbolInformation(
      s.classe ? `${s.classe}.${s.nome}` : s.nome,
      ICONE[s.tipo],
      path.basename(s.arquivo),
      localDe(s)));
  }
}

/**
 * Acha usos varrendo as fontes na hora, e não por um índice de ocorrências.
 *
 * Guardar toda ocorrência de todo identificador seria um índice muitas vezes maior que o de
 * declarações, e desatualizado a cada tecla. Varrer ~1.500 arquivos custa menos de um segundo
 * e sempre reflete o disco.
 *
 * O que isto NÃO faz: distinguir dois símbolos de mesmo nome em unidades diferentes. É busca
 * por palavra, não resolução de escopo — e é melhor dizer isso do que fingir precisão.
 */
class UsosNoProjeto implements vscode.ReferenceProvider {
  async provideReferences(
    doc: vscode.TextDocument, pos: vscode.Position,
    _ctx: vscode.ReferenceContext, cancelar: vscode.CancellationToken,
  ): Promise<vscode.Location[]> {
    const faixa = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
    if (!faixa) { return []; }
    const alvo = doc.getText(faixa);
    if (alvo.length < 3) { return []; }

    const achados: vscode.Location[] = [];
    const re = new RegExp(`\\b${alvo}\\b`, 'gi');
    for (const arquivo of arquivosDoProjeto()) {
      if (cancelar.isCancellationRequested) { break; }
      let src: string;
      try { src = fs.readFileSync(arquivo, 'latin1'); } catch { continue; }
      if (!new RegExp(alvo, 'i').test(src)) { continue; }
      const linhas = src.split(/\r?\n/);
      for (let i = 0; i < linhas.length; i++) {
        // comentário de linha e literal de string dão falso positivo em quantidade
        const l = linhas[i].replace(/\/\/.*$/, '').replace(/'[^']*'/g, "''");
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(l))) {
          achados.push(new vscode.Location(vscode.Uri.file(arquivo),
            new vscode.Range(i, m.index, i, m.index + alvo.length)));
          if (achados.length > 5000) { return achados; }
        }
      }
    }
    return achados;
  }
}

/** Lista de `.pas` do projeto, refeita a cada busca — o disco é a verdade. */
function arquivosDoProjeto(): string[] {
  const fora = new Set(excluidos().map(e => e.toLowerCase()));
  const out: string[] = [];
  const anda = (dir: string): void => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const cheio = path.join(dir, e.name);
      const baixo = e.name.toLowerCase();
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !fora.has(baixo)
            && !/^(__history|__recovery|node_modules|win32|win64|linux64|osx64)$/.test(baixo)) {
          anda(cheio);
        }
      } else if (/\.(pas|dpr|dpk|inc)$/i.test(e.name)) { out.push(cheio); }
    }
  };
  for (const r of raizes) { anda(r); }
  return out;
}

function excluidos(): string[] {
  return vscode.workspace.getConfiguration('delphi4vscode')
    .get<string[]>('symbols.excluir', ['vendor', 'vendors', 'third-party', 'thirdparty']);
}

/** Refaz o índice. Barato o bastante para rodar quando o projeto ativo muda. */
export function reindexarSimbolos(canal: vscode.OutputChannel, build: BuildManager): void {
  const pastas = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  const doProjeto = build.projeto ? [path.dirname(build.projeto.fsPath)] : [];
  /*
   * A pasta do workspace vem primeiro, e a do projeto entra só se estiver fora dela — abrir a
   * raiz do repositório é o caso normal, e varrer a mesma árvore duas vezes dobraria o tempo.
   */
  raizes = [...pastas];
  for (const d of doProjeto) {
    if (!pastas.some(p => d.toLowerCase().startsWith(p.toLowerCase()))) { raizes.push(d); }
  }
  if (!raizes.length) { return; }

  const t0 = Date.now();
  indice.limpar();
  indice.varrer(raizes, 20000, excluidos());
  canal.appendLine(
    `índice de símbolos: ${indice.tamanho} em ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
    `(${raizes.length} raiz(es), fora: ${excluidos().join(', ') || 'nada'})`);
}

export function registrarSimbolos(
  ctx: vscode.ExtensionContext, build: BuildManager, canal: vscode.OutputChannel,
): void {
  ctx.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider(new SimbolosDoProjeto()),
    vscode.languages.registerReferenceProvider(
      [{ language: 'pascal' }, { language: 'objectpascal' },
       { pattern: '**/*.{pas,dpr,dpk,inc}' }],
      new UsosNoProjeto()),
    vscode.commands.registerCommand('delphi4vscode.reindexarSimbolos', () => {
      reindexarSimbolos(canal, build);
      vscode.window.showInformationMessage(
        `Delphi4VSCode: ${indice.tamanho} símbolos indexados.`);
    }),
    build.onMudou(() => reindexarSimbolos(canal, build)),
  );
  // a primeira varredura não pode atrasar a ativação
  setTimeout(() => reindexarSimbolos(canal, build), 1500);
}
