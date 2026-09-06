/**
 * I11 — renomear um componente sem quebrar a unit.
 *
 * `Name` no .dfm é o nome do campo published da classe. Trocar só o .dfm deixa o form sem
 * campo para o componente e a tela não abre — o mesmo erro que o nosso próprio diagnóstico
 * aponta. Por isso a renomeação anda em três frentes ao mesmo tempo: o `Name`, as referências
 * de outros componentes do form (`FocusControl`, `DataSource`, `PopupMenu`...) e, no .pas, o
 * campo mais os handlers cujo nome derivava do nome antigo.
 */

import { DfmNode, propKind, walk } from './model';
import { DfmDocument } from './document';
import { EditError, TextChange } from './edit';

export interface Plano {
  antigo: string;
  novo: string;
  /** `Button1Click` -> `Salvar1Click`: só os handlers deste componente, por nome exato. */
  metodos: { de: string; para: string }[];
  /** Outros componentes do form que apontavam para o nome antigo. */
  referencias: string[];
}

const NOME_VALIDO = /^[A-Za-z_]\w*$/;

export function planejar(doc: DfmDocument, node: DfmNode, novo: string): Plano {
  const antigo = node.name;
  if (!antigo) { throw new EditError('este componente não tem nome para trocar'); }
  if (!NOME_VALIDO.test(novo)) {
    throw new EditError('nome inválido: só letras, números e sublinhado, começando por letra');
  }
  if (novo.toLowerCase() === antigo.toLowerCase()) { throw new EditError('o nome é o mesmo'); }
  if (doc.byName.has(novo)) { throw new EditError(`já existe um ${novo} neste form`); }
  if (node.uri !== doc.uri) {
    throw new EditError(`${antigo} vem de ${node.uri.split(/[\\/]/).pop()}: renomeie lá`);
  }

  const metodos: Plano['metodos'] = [];
  for (const [, p] of node.props) {
    if (!/^on[a-z]/i.test(p.label)) { continue; }
    const m = p.raw.trim();
    if (m.startsWith(antigo) && NOME_VALIDO.test(m)) {
      metodos.push({ de: m, para: novo + m.slice(antigo.length) });
    }
  }

  const referencias: string[] = [];
  for (const n of walk(doc.root)) {
    if (n === node || n.uri !== doc.uri) { continue; }
    for (const [, p] of n.props) {
      if (p.uri === doc.uri && propKind(p.raw) === 'enum' && p.raw.trim() === antigo) {
        referencias.push(`${n.name || n.cls}.${p.label}`);
      }
    }
  }
  return { antigo, novo, metodos, referencias };
}

/** Linhas do .dfm a reescrever: o `Name` e cada referência ao nome antigo. */
export function mudancasDfm(doc: DfmDocument, node: DfmNode, plano: Plano): TextChange[] {
  const out: TextChange[] = [];
  const pad = ' '.repeat(node.indent);
  out.push({
    line: node.line, kind: 'replace',
    text: `${pad}${node.kind} ${plano.novo}: ${node.cls}`,
  });
  for (const n of walk(doc.root)) {
    if (n.uri !== doc.uri) { continue; }
    for (const [, p] of n.props) {
      if (p.uri !== doc.uri) { continue; }
      const v = p.raw.trim();
      const metodo = plano.metodos.find(m => m.de === v);
      const alvo = n !== node && propKind(p.raw) === 'enum' && v === plano.antigo
        ? plano.novo : metodo ? metodo.para : '';
      if (!alvo) { continue; }
      out.push({
        line: p.line, kind: 'replace',
        text: `${' '.repeat(n.indent + 2)}${p.label} = ${alvo}`,
      });
    }
  }
  return out;
}

export interface EdicaoPas {
  linha: number;
  texto: string;
}

/*
 * A substituição no .pas ignora o que está dentro de string e depois de `//`. Não é um
 * parser: uma diretiva `{$...}` ou um comentário `{ }` de várias linhas ainda seria
 * reescrito. Vale o risco porque o alvo é um identificador de campo published — que só
 * aparece como código — e porque o usuário confirma a lista antes de aplicar.
 */
const TOKEN = /'(?:[^']|'')*'|\/\/.*$/;

function trocarForaDeString(linha: string, pares: [RegExp, string][]): string {
  const partes: string[] = [];
  let resto = linha;
  for (;;) {
    const m = TOKEN.exec(resto);
    if (!m) { partes.push(aplicar(resto, pares)); break; }
    partes.push(aplicar(resto.slice(0, m.index), pares), m[0]);
    if (m[0].startsWith('//')) { break; }
    resto = resto.slice(m.index + m[0].length);
  }
  return partes.join('');
}

function aplicar(trecho: string, pares: [RegExp, string][]): string {
  let s = trecho;
  for (const [re, para] of pares) { s = s.replace(re, para); }
  return s;
}

export function mudancasPascal(texto: string, plano: Plano): EdicaoPas[] {
  const pares: [RegExp, string][] = [
    // os métodos primeiro: `Button1Click` contém `Button1`
    ...plano.metodos.map(m =>
      [new RegExp(`\\b${m.de}\\b`, 'g'), m.para] as [RegExp, string]),
    [new RegExp(`\\b${plano.antigo}\\b`, 'g'), plano.novo],
  ];
  const out: EdicaoPas[] = [];
  const linhas = texto.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const nova = trocarForaDeString(linhas[i], pares);
    if (nova !== linhas[i]) { out.push({ linha: i, texto: nova }); }
  }
  return out;
}
