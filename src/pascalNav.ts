/**
 * Bloco C — navegar e consultar código Pascal.
 *
 * O índice já sabe em que arquivo cada classe foi declarada e o que ela publica. Faltava
 * expor isso ao editor: ir para a definição, ver a declaração ao passar o mouse, pular entre
 * o cabeçalho e a implementação de um método, e completar nomes.
 *
 * Nada aqui é um compilador. É busca por nome sobre o que o índice guarda e sobre o texto do
 * arquivo aberto — o que resolve o caso comum (`TcxButton` levando ao `cxButtons.pas`) sem
 * prometer resolução de escopo que não existe.
 */

import * as fs from 'fs';
import * as vscode from 'vscode';
import { Registry } from './dfm/registry';
import { parsePascal } from './dfm/pascal';
import { lspNoAr } from './lsp/estado';

const PALAVRA = /[A-Za-z_][A-Za-z0-9_]*/;

/** Classe ou unit sob o cursor. */
function simbolo(doc: vscode.TextDocument, pos: vscode.Position): string | undefined {
  const r = doc.getWordRangeAtPosition(pos, PALAVRA);
  return r ? doc.getText(r) : undefined;
}

/** Onde uma classe foi declarada: arquivo do índice e a linha do `= class`. */
function declaracaoDe(reg: Registry, cls: string): vscode.Location | undefined {
  const arquivo = reg.unitOf(cls);
  if (!arquivo || !fs.existsSync(arquivo)) { return undefined; }
  let texto: string;
  try {
    texto = fs.readFileSync(arquivo, 'latin1');
  } catch {
    return undefined;
  }
  const linhas = texto.split(/\r?\n/);
  const alvo = new RegExp(`^\\s*${cls}\\s*(<[^>]*>)?\\s*=\\s*class\\b`, 'i');
  const i = linhas.findIndex(l => alvo.test(l));
  const pos = new vscode.Position(Math.max(0, i), 0);
  return new vscode.Location(vscode.Uri.file(arquivo), pos);
}

/** Arquivo de uma unit pelo nome. O indice guarda isso direto desde o mapa unit->arquivo. */
function unitDe(reg: Registry, nome: string): string | undefined {
  return reg.arquivoDaUnit(nome);
}

/** C01 — Ctrl+clique numa classe ou numa unit do `uses`. */
/**
 * A resolução pelo índice próprio, sem passar pelo provider.
 *
 * Exportada porque o cliente LSP a usa como rede: quando o servidor devolve erro interno num
 * pedido de definição, o usuário não pode ficar sem nada — cai aqui em silêncio, que é pior
 * do que a resposta do compilador e muito melhor do que um erro na tela.
 */
export function resolverDefinicao(
  doc: vscode.TextDocument, pos: vscode.Position, reg: Registry,
): vscode.Location | undefined {
  const nome = simbolo(doc, pos);
  if (!nome) { return undefined; }

  if (/^T[A-Za-z0-9_]/.test(nome) && reg.chain(nome).length > 1) {
    const d = declaracaoDe(reg, nome);
    if (d) { return d; }
  }
  // no `uses`, o símbolo é o nome de uma unit
  const arquivo = unitDe(reg, nome);
  if (arquivo) {
    return new vscode.Location(vscode.Uri.file(arquivo), new vscode.Position(0, 0));
  }
  // método do próprio arquivo: da declaração para a implementação, e vice-versa
  return outroLadoDoMetodo(doc, nome, pos);
}

export class DefinicaoPascal implements vscode.DefinitionProvider {
  constructor(private registry: () => Registry) {}

  provideDefinition(
    doc: vscode.TextDocument, pos: vscode.Position,
  ): vscode.Location | undefined {
    if (lspNoAr()) { return undefined; }
    return resolverDefinicao(doc, pos, this.registry());
  }
}

/**
 * C03 — o pulo entre o cabeçalho na classe e o corpo na implementação.
 *
 * É o `Ctrl+Shift+↑` do Delphi. Aqui ele entra como "ir para a definição" quando o símbolo
 * sob o cursor é um método deste arquivo: estando na declaração, leva ao corpo; estando no
 * corpo, leva à declaração.
 */
function outroLadoDoMetodo(
  doc: vscode.TextDocument, nome: string, pos: vscode.Position,
): vscode.Location | undefined {
  const unit = parsePascal(doc.getText());
  const metodo = unit.metodos.filter(m => m.nome.toLowerCase() === nome.toLowerCase());
  if (metodo.length < 2) { return undefined; }
  const outro = metodo.find(m => m.linha !== pos.line)
    ?? metodo.find(m => Math.abs(m.linha - pos.line) > 2);
  return outro
    ? new vscode.Location(doc.uri, new vscode.Position(outro.linha, 0)) : undefined;
}

/** C04 — a declaração da classe ao passar o mouse, com o que ela publica. */
export class HoverPascal implements vscode.HoverProvider {
  constructor(private registry: () => Registry) {}

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    if (lspNoAr()) { return undefined; }
    const nome = simbolo(doc, pos);
    if (!nome || !/^T[A-Za-z0-9_]/.test(nome)) { return undefined; }
    const reg = this.registry();
    const cadeia = reg.chain(nome);
    if (cadeia.length < 2) { return undefined; }

    const declarado = reg.nomeDeclarado(nome) ?? nome;
    const arquivo = reg.unitOf(nome);
    const unidade = arquivo ? arquivo.split(/[\\/]/).pop() : undefined;
    const pai = reg.nomeDeclarado(cadeia[1]) ?? cadeia[1];
    const publicadas = [...reg.publicadasDe(nome)].sort();

    const md = new vscode.MarkdownString();
    md.appendCodeblock(`${declarado} = class(${pai})`, 'pascal');
    const linhas: string[] = [];
    if (unidade) { linhas.push(`Declarada em \`${unidade}\``); }
    linhas.push(`Família no designer: **${reg.kind(nome)}** ` +
                `(por ${reg.kindSource(nome)[1]})`);
    if (publicadas.length) {
      const amostra = publicadas.slice(0, 24).join(', ');
      linhas.push(`${publicadas.length} propriedades publicadas: ${amostra}` +
                  (publicadas.length > 24 ? ', …' : ''));
    }
    linhas.push('Herança: ' + cadeia.slice(0, 6)
      .map(c => reg.nomeDeclarado(c) ?? c).join(' → ') + (cadeia.length > 6 ? ' → …' : ''));
    md.appendMarkdown(linhas.join('\n\n'));
    return new vscode.Hover(md);
  }
}

/**
 * C02 — completar nomes de classe e, depois de um ponto, o que a classe publica.
 *
 * A resolução do que está antes do ponto é por nome de campo declarado na unit, não por
 * análise de expressão: `Botao.` completa porque `Botao` é um campo `TcxButton` da classe do
 * form. Chamada encadeada não é resolvida, e é melhor não fingir que é.
 */
export class CompletarPascal implements vscode.CompletionItemProvider {
  constructor(private registry: () => Registry) {}

  provideCompletionItems(
    doc: vscode.TextDocument, pos: vscode.Position,
  ): vscode.CompletionItem[] {
    if (lspNoAr()) { return []; }
    const reg = this.registry();
    const linha = doc.lineAt(pos.line).text.slice(0, pos.character);
    const apos = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z0-9_]*)$/.exec(linha);

    if (apos) {
      const unit = parsePascal(doc.getText());
      const campo = unit.campos.find(c => c.nome.toLowerCase() === apos[1].toLowerCase());
      const cls = campo?.tipo ?? apos[1];
      return [...reg.publicadasDe(cls)].sort().map(p => {
        const item = new vscode.CompletionItem(p, vscode.CompletionItemKind.Property);
        item.detail = cls;
        return item;
      });
    }

    const prefixo = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(linha)?.[1] ?? '';
    if (prefixo.length < 2) { return []; }
    const baixo = prefixo.toLowerCase();
    const out: vscode.CompletionItem[] = [];
    for (const c of reg.classes()) {
      if (!c.startsWith(baixo)) { continue; }
      const nome = reg.nomeDeclarado(c) ?? c;
      const item = new vscode.CompletionItem(nome, vscode.CompletionItemKind.Class);
      const arq = reg.unitOf(c);
      if (arq) { item.detail = arq.split(/[\\/]/).pop(); }
      out.push(item);
      if (out.length >= 200) { break; }
    }
    return out;
  }
}

export function registrarPascalNav(
  ctx: vscode.ExtensionContext, registry: () => Registry,
): void {
  const seletor: vscode.DocumentSelector = [
    { language: 'pascal' }, { language: 'objectpascal' }, { pattern: '**/*.{pas,dpr,dpk,inc}' },
  ];
  ctx.subscriptions.push(
    vscode.languages.registerDefinitionProvider(seletor, new DefinicaoPascal(registry)),
    vscode.languages.registerHoverProvider(seletor, new HoverPascal(registry)),
    vscode.languages.registerCompletionItemProvider(
      seletor, new CompletarPascal(registry), '.'),
  );
}
