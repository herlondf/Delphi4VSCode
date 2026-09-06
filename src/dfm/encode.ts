/**
 * N06 — grava o .dfm no formato binário TPF0.
 *
 * O inverso do binary.ts, e com as mesmas armadilhas: os índices da enum `TValueType`
 * precisam bater exatamente, e cada nível termina num byte zero — um a mais ou a menos e o
 * Delphi recusa o form com "Error reading ...".
 *
 * A escolha do tipo de cada valor segue o que o TWriter faria: inteiro no menor tamanho que
 * couber, `Ident` para identificador nu, e string em UTF-8 quando sai do ASCII — que é o que
 * o Delphi moderno lê de volta sem perder acento.
 */

import { DfmNode, unquote } from './model';

/** TValueType do System.Classes, na ordem em que o Delphi grava. */
const enum VT {
  Null = 0, List, Int8, Int16, Int32, Extended, String, Ident, False, True,
  Binary, Set, LString, Nil, Collection, Single, Currency, Date, WString, Int64,
  UTF8String, Double,
}

const FF_INHERITED = 1;
const FF_INLINE = 4;

class Escritor {
  private bytes: number[] = [];

  saida(): Uint8Array { return Uint8Array.from(this.bytes); }

  byte(b: number): void { this.bytes.push(b & 0xff); }

  int(valor: number, tamanho: number): void {
    let v = valor < 0 ? valor + 2 ** (8 * tamanho) : valor;
    for (let k = 0; k < tamanho; k++) {
      this.bytes.push(v & 0xff);
      v = Math.floor(v / 256);
    }
  }

  /** String curta com 1 byte de tamanho: classe, nome de componente e de propriedade. */
  pstr(s: string): void {
    const b = utf8(s);
    if (b.length > 255) {
      throw new Error(`identificador longo demais para o formato binário: ${s}`);
    }
    this.byte(b.length);
    for (const x of b) { this.bytes.push(x); }
  }

  bruto(b: number[]): void { for (const x of b) { this.bytes.push(x); } }
}

function utf8(s: string): number[] {
  return [...new TextEncoder().encode(s)];
}

function ehAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) > 127) { return false; } }
  return true;
}

const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^-?\d+\.\d+([eE][-+]?\d+)?$/;
const IDENT_RE = /^[A-Za-z_][\w.]*$/;
const HEX_RE = /[^0-9A-Fa-f]/g;

function escreverTexto(w: Escritor, s: string): void {
  const b = utf8(s);
  if (!ehAscii(s)) {
    w.byte(VT.UTF8String);
    w.int(b.length, 4);
    w.bruto(b);
  } else if (b.length <= 255) {
    w.byte(VT.String);
    w.pstr(s);
  } else {
    w.byte(VT.LString);
    w.int(b.length, 4);
    w.bruto(b);
  }
}

function escreverInteiro(w: Escritor, v: number): void {
  if (v >= -128 && v <= 127) { w.byte(VT.Int8); w.int(v, 1); }
  else if (v >= -32768 && v <= 32767) { w.byte(VT.Int16); w.int(v, 2); }
  else { w.byte(VT.Int32); w.int(v, 4); }
}

function escreverDouble(w: Escritor, v: number): void {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v, true);
  w.byte(VT.Double);
  w.bruto([...new Uint8Array(buf.buffer)]);
}

/** Linhas internas de um bloco `(...)`, `<...>` ou `{...}`, já sem os delimitadores. */
function corpo(raw: string, abre: string, fecha: string): string[] {
  const t = raw.trim();
  const dentro = t.slice(t.indexOf(abre) + 1, t.lastIndexOf(fecha));
  return dentro.split('\n').map(l => l.trim()).filter(Boolean);
}

function escreverValor(w: Escritor, raw: string): void {
  const v = raw.trim();
  if (!v) { w.byte(VT.Null); return; }

  const c = v[0];
  if (c === '(') {
    w.byte(VT.List);
    for (const linha of corpo(v, '(', ')')) { escreverTexto(w, unquote(linha)); }
    w.byte(VT.Null);
    return;
  }
  if (c === '<') {
    escreverColecao(w, corpo(v, '<', '>'));
    return;
  }
  if (c === '{') {
    const hex = corpo(v, '{', '}').join('').replace(HEX_RE, '');
    const bytes: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) { bytes.push(parseInt(hex.slice(i, i + 2), 16)); }
    w.byte(VT.Binary);
    w.int(bytes.length, 4);
    w.bruto(bytes);
    return;
  }
  if (c === '[') {
    w.byte(VT.Set);
    for (const nome of v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)) {
      w.pstr(nome);
    }
    w.byte(0);
    return;
  }
  if (c === "'" || c === '#') { escreverTexto(w, unquote(v)); return; }

  const low = v.toLowerCase();
  if (low === 'true') { w.byte(VT.True); return; }
  if (low === 'false') { w.byte(VT.False); return; }
  if (low === 'nil') { w.byte(VT.Nil); return; }
  if (INT_RE.test(v)) { escreverInteiro(w, parseInt(v, 10)); return; }
  if (FLOAT_RE.test(v)) { escreverDouble(w, parseFloat(v)); return; }
  if (IDENT_RE.test(v)) { w.byte(VT.Ident); w.pstr(v); return; }
  // resto: grava como texto, que é o que o Delphi faz com valor que não reconhece
  escreverTexto(w, v);
}

/** Cada item é `vaList`, propriedades, zero; e a coleção fecha com outro zero. */
function escreverColecao(w: Escritor, linhas: string[]): void {
  w.byte(VT.Collection);
  let i = 0;
  while (i < linhas.length) {
    if (!/^item$/i.test(linhas[i])) { i++; continue; }
    i++;
    w.byte(VT.List);
    let nivel = 0;
    while (i < linhas.length) {
      const l = linhas[i];
      if (/^end$/i.test(l)) {
        if (nivel === 0) { i++; break; }
        nivel--;
        i++;
        continue;
      }
      const m = /^([\w.]+)\s*=\s*(.*)$/.exec(l);
      if (!m) { i++; continue; }
      if (nivel === 0) {
        const [valor, prox] = valorMultilinha(m[2], linhas, i + 1);
        w.pstr(m[1]);
        escreverValor(w, valor);
        i = prox;
      } else { i++; }
    }
    w.byte(VT.Null);
  }
  w.byte(VT.Null);
}

const PARES: Record<string, string> = { '<': '>', '{': '}', '(': ')', '[': ']' };

/** Junta as linhas de um valor que continua abaixo — mesma regra do parser de texto. */
function valorMultilinha(inicio: string, linhas: string[], i: number): [string, number] {
  const abre = inicio[0];
  if (!abre || !PARES[abre]) { return [inicio, i]; }
  const fecha = PARES[abre];
  const conta = (s: string, ch: string) => s.split(ch).length - 1;
  let profundidade = conta(inicio, abre) - conta(inicio, fecha);
  let valor = inicio;
  while (profundidade > 0 && i < linhas.length) {
    valor += '\n' + linhas[i];
    profundidade += conta(linhas[i], abre) - conta(linhas[i], fecha);
    i++;
  }
  return [valor, i];
}

function escreverObjeto(w: Escritor, n: DfmNode): void {
  const flags = n.kind === 'inherited' ? FF_INHERITED : n.kind === 'inline' ? FF_INLINE : 0;
  if (flags) { w.byte(0xf0 | flags); }
  w.pstr(n.cls);
  w.pstr(n.name);
  for (const [, p] of n.props) {
    w.pstr(p.label);
    escreverValor(w, p.raw);
  }
  w.byte(VT.Null);
  for (const k of n.kids) { escreverObjeto(w, k); }
  w.byte(VT.Null);
}

export function encodeBinaryDfm(root: DfmNode): Uint8Array {
  const w = new Escritor();
  w.bruto([0x54, 0x50, 0x46, 0x30]);   // TPF0
  escreverObjeto(w, root);
  return w.saida();
}
