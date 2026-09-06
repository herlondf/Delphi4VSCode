/**
 * P06 e P09 — inserir um frame que já existe, e reaproveitar um bloco como modelo.
 *
 * As duas coisas escrevem um bloco pronto dentro de outro container, e as duas esbarram no
 * mesmo problema: nome repetido. Um `.dfm` com dois componentes de mesmo nome não carrega,
 * então tudo que entra passa por um renomeio que resolve as colisões antes de escrever.
 */

import * as fs from 'fs';
import { DfmNode, num } from './model';
import { DfmDocument, readDfmText } from './document';
import { parseDfm } from './parser';
import { Registry } from './registry';
import { EditError, TextChange, novoNome } from './edit';

const NL = String.fromCharCode(10);

export interface FrameDisponivel {
  cls: string;
  unit: string;
  dfm: string;
  w: number;
  h: number;
}

/** Frames do projeto que têm `.dfm` ao lado do `.pas` — só esses dá para instanciar. */
export function framesDoProjeto(reg: Registry): FrameDisponivel[] {
  return classesComDfm(reg, 'tframe');
}

/**
 * Classes que descendem de `base` e têm `.dfm` ao lado do `.pas`.
 *
 * Serve para as duas listas que o designer oferece: frames para instanciar e forms para
 * herdar. Sem `.dfm` a classe existe mas não é um form — é só uma classe que herda de um.
 */
export function classesComDfm(reg: Registry, base: string): FrameDisponivel[] {
  const out: FrameDisponivel[] = [];
  for (const cls of reg.classes()) {
    if (!reg.isA(cls, base) || cls === base.toLowerCase()) { continue; }
    const pas = reg.unitOf(cls);
    if (!pas) { continue; }
    const dfm = pas.replace(/\.pas$/i, '.dfm');
    if (!fs.existsSync(dfm)) { continue; }
    let w = 400;
    let h = 200;
    try {
      const raiz = parseDfm(readDfmText(dfm).text, dfm);
      if (raiz) { w = num(raiz, 'width', w); h = num(raiz, 'height', h); }
    } catch { /* .dfm ilegível: vale o tamanho padrão */ }
    const unit = (pas.split(/[\\/]/).pop() ?? '').replace(/\.pas$/i, '');
    out.push({ cls: nomeOriginal(reg, cls), unit, dfm, w, h });
  }
  return out.sort((a, b) => a.cls.localeCompare(b.cls));
}

/** O índice guarda em minúsculas; o `.dfm` precisa do nome como foi declarado. */
function nomeOriginal(reg: Registry, cls: string): string {
  return reg.nomeDeclarado(cls) ?? cls;
}

/**
 * P06 — instância de frame: `inline Nome: TFrameX`. O bloco fica vazio de propósito; o que
 * o frame define vem do `.dfm` dele, e o que for sobrescrito aqui o usuário sobrescreve
 * depois, pelo inspetor.
 */
export function addFrame(
  doc: DfmDocument, parent: DfmNode, frame: FrameDisponivel, left: number, top: number,
): { changes: TextChange[]; name: string } {
  if (parent.uri !== doc.uri) {
    throw new EditError(`${parent.name || parent.cls} vem de outro arquivo: ` +
      'insira o frame no arquivo dele');
  }
  const nome = novoNome(doc, frame.cls);
  const pad = ' '.repeat(parent.indent + 2);
  const at = parent.kids.length ? Math.min(...parent.kids.map(k => k.line)) : parent.endLine;
  const linhas = [
    `${pad}inline ${nome}: ${frame.cls}`,
    `${pad}  Left = ${left}`,
    `${pad}  Top = ${top}`,
    `${pad}  Width = ${frame.w}`,
    `${pad}  Height = ${frame.h}`,
    `${pad}  TabOrder = ${parent.kids.length}`,
    `${pad}end`,
  ];
  return { changes: linhas.map(text => ({ line: at, kind: 'insert', text })), name: nome };
}

export interface Template {
  nome: string;
  cls: string;
  /** Linhas do bloco, já sem o recuo do lugar de origem. */
  linhas: string[];
}

/** P09 — guarda o bloco do componente (com os filhos) como modelo reaproveitável. */
export function criarTemplate(texto: string, node: DfmNode, nome: string): Template {
  if (!nome.trim()) { throw new EditError('o modelo precisa de um nome'); }
  const linhas = texto.split(/\r?\n/).slice(node.line, node.endLine + 1);
  const recuo = node.indent;
  return {
    nome: nome.trim(), cls: node.cls,
    linhas: linhas.map(l => l.slice(0, recuo).trim() ? l : l.slice(recuo)),
  };
}

const CABECALHO = /^(\s*)(object|inherited|inline)\s+([\w.]+)\s*:\s*([\w.]+)/i;

/** Primeiro `Classe1`, `Classe2`... que ainda não está em uso. */
function nomeLivre(usados: Set<string>, cls: string): string {
  const base = cls.startsWith('T') ? cls.slice(1) : cls;
  let i = 1;
  while (usados.has(`${base}${i}`)) { i++; }
  return `${base}${i}`;
}

/**
 * Insere o modelo dentro do container, renomeando o que colidir.
 *
 * O renomeio é textual e vale para o bloco inteiro: um `OnClick = Botao1Click` dentro do
 * template continua apontando para o handler antigo, o que é o certo — o método existe no
 * `.pas` e continua sendo o mesmo comportamento. Só os nomes de componente mudam.
 */
export function inserirTemplate(
  doc: DfmDocument, parent: DfmNode, t: Template, left: number, top: number,
): { changes: TextChange[]; name: string } {
  if (parent.uri !== doc.uri) {
    throw new EditError(`${parent.name || parent.cls} vem de outro arquivo`);
  }
  const usados = new Set([...doc.index.values()].map(n => n.name));
  const trocas = new Map<string, string>();
  for (const l of t.linhas) {
    const m = CABECALHO.exec(l);
    if (!m) { continue; }
    const antigo = m[3];
    if (trocas.has(antigo)) { continue; }
    if (!usados.has(antigo)) { usados.add(antigo); continue; }
    const novo = nomeLivre(usados, m[4]);
    trocas.set(antigo, novo);
    usados.add(novo);
  }

  const pad = ' '.repeat(parent.indent + 2);
  const at = parent.kids.length ? Math.min(...parent.kids.map(k => k.line)) : parent.endLine;
  const corpo = t.linhas.map(l => {
    let saida = l;
    for (const [de, para] of trocas) {
      saida = saida.replace(new RegExp(`\\b${de}\\b`, 'g'), para);
    }
    return pad + saida;
  });

  // reposiciona a raiz no ponto do clique, se ela declarava posição
  const raiz = CABECALHO.exec(t.linhas[0]);
  const nome = raiz ? (trocas.get(raiz[3]) ?? raiz[3]) : t.cls;
  const ajustado = corpo.map((l, i) => {
    if (i === 0 || i > 4) { return l; }
    if (/^\s*Left\s*=/i.test(l)) { return `${pad}  Left = ${left}`; }
    if (/^\s*Top\s*=/i.test(l)) { return `${pad}  Top = ${top}`; }
    return l;
  });
  return {
    changes: ajustado.map(text => ({ line: at, kind: 'insert', text })),
    name: nome,
  };
}

export { NL };
