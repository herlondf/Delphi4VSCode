/**
 * Um form carregado: árvore própria, mais o que vem de fora.
 *
 * Um .dfm real raramente se basta. Ele traz frames (`inline X: TFrameY`) e, quando o form
 * herda de outro (`inherited` na raiz), traz também o .dfm do ancestral. Resolver isso é o
 * que faz a tela aparecer inteira — e é o que exige rastrear de qual arquivo cada valor veio.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DfmNode, Prop, walk, txt } from './model';
import { parseDfm } from './parser';
import { decodeBinaryDfm, isBinaryDfm } from './binary';
import { Registry } from './registry';

export interface LoadedText {
  text: string;
  /** true quando o arquivo estava em formato binário e foi decodificado (não é editável). */
  binary: boolean;
}

export function readDfmText(file: string): LoadedText {
  const data = fs.readFileSync(file);
  if (isBinaryDfm(data)) { return { text: decodeBinaryDfm(data), binary: true }; }
  // .dfm nasce em UTF-8 (com ou sem BOM) ou ANSI; latin1 nunca falha e preserva os bytes
  const asUtf8 = data.toString('utf8');
  const text = asUtf8.includes('�') ? data.toString('latin1') : asUtf8;
  return { text: text.replace(/^﻿/, ''), binary: false };
}

const MAX_FRAME_DEPTH = 8;

export class DfmDocument {
  root: DfmNode;
  /** Todos os nós por caminho, incluindo os que vieram de frames e ancestrais. */
  index = new Map<string, DfmNode>();
  byName = new Map<string, DfmNode>();
  /** Controle -> TdxLayoutItem que o posiciona. Chaveado por nó, não por nome. */
  byControl = new Map<DfmNode, DfmNode>();
  /** Outros .dfm que este form depende: mudaram, o render está velho. */
  deps: string[] = [];
  binary = false;

  constructor(public readonly uri: string, text: string, private reg: Registry) {
    const parsed = parseDfm(text, uri);
    if (!parsed) { throw new Error('nenhum "object" encontrado — isto é mesmo um .dfm?'); }
    this.root = parsed;
    this.expand(this.root, 0, true);
    this.reindex();
  }

  static fromFile(file: string, reg: Registry): DfmDocument {
    const { text, binary } = readDfmText(file);
    const doc = new DfmDocument(file, text, reg);
    doc.binary = binary;
    return doc;
  }

  private reindex(): void {
    this.index.clear();
    this.byName.clear();
    this.byControl.clear();
    for (const n of walk(this.root)) {
      this.index.set(n.path, n);
      if (n.name && !this.byName.has(n.name)) { this.byName.set(n.name, n); }
      n.external = n.uri !== this.uri;
    }
    // o layout resolve `Control = X` entre os filhos do MESMO layout control: quatro
    // instâncias do mesmo frame trazem quatro controles homônimos, e um mapa por nome
    // perderia três deles
    for (const host of walk(this.root)) {
      if (!this.reg.chain(host.cls).some(c => c === 'tdxcustomlayoutcontrol')) { continue; }
      const siblings = new Map(host.kids.filter(k => k.name).map(k => [k.name, k]));
      for (const k of host.kids) {
        const ctl = k.props.get('control');
        if (!ctl) { continue; }
        if (!this.reg.chain(k.cls).some(c => c === 'tdxcustomlayoutitem')) { continue; }
        const alvo = siblings.get(ctl.raw.trim());
        if (alvo) { this.byControl.set(alvo, k); }
      }
    }
  }

  /**
   * Traz o conteúdo de fora:
   *  - `inline Frame1: TFrame1` -> o .dfm do próprio frame;
   *  - `inherited Form1: TForm1` na raiz -> o .dfm do form ancestral.
   *
   * `depth` conta aninhamento de FRAMES (guarda contra ciclo), não profundidade na árvore:
   * um frame no quinto nível de containers ainda precisa ser expandido.
   */
  private expand(node: DfmNode, depth: number, isRoot: boolean): void {
    for (const k of [...node.kids]) { this.expand(k, depth, false); }
    if (depth > MAX_FRAME_DEPTH) { return; }

    let ancestorCls: string | undefined;
    if (node.kind === 'inline') { ancestorCls = node.cls; }
    else if (isRoot && node.kind === 'inherited') {
      ancestorCls = this.reg.chain(node.cls)[1];
    }
    if (!ancestorCls) { return; }

    const unit = this.reg.unitOf(ancestorCls);
    if (!unit) { return; }
    const dfm = unit.replace(/\.pas$/i, '.dfm');
    if (!fs.existsSync(dfm)) { return; }

    let base: DfmNode | null;
    try {
      base = parseDfm(readDfmText(dfm).text, dfm);
    } catch { return; }
    if (!base) { return; }
    this.deps.push(dfm);

    this.expand(base, depth + 1, true);
    merge(base, node);
    node.kids = base.kids;
    for (const k of node.kids) { k.parent = node; }
    for (const [key, p] of base.props) {
      if (!node.props.has(key)) { node.props.set(key, p); }
    }
    repath(node);
  }

  /**
   * O form tem algum `TdxLayoutControl`?
   *
   * Muda o padrão de desenho. Sob layout control as coordenadas gravadas no `.dfm` são o
   * resultado do último cálculo — e num form que herda de outro maior elas simplesmente não
   * valem: o `TrocarPassageiro` reduz a altura para 101 e continua com os botões do
   * ancestral em y=180, fora da tela. O Delphi recalcula ao abrir; nós também.
   */
  get temLayoutControl(): boolean {
    if (this.layoutCache === undefined) {
      this.layoutCache = [...walk(this.root)]
        .some(n => this.reg.chain(n.cls).includes('tdxcustomlayoutcontrol'));
    }
    return this.layoutCache;
  }

  private layoutCache: boolean | undefined;

  /** Onde escrever uma propriedade deste componente, já resolvido para o arquivo aberto. */
  writeTarget(node: DfmNode): DfmNode | null {
    if (node.uri === this.uri) { return node; }
    if (node.override && node.override.uri === this.uri) { return node.override; }
    return null;
  }

  /**
   * Dá para gravar aqui, com bloco existente ou criando um? Só exige que o componente e
   * todos os ancestrais tenham nome, porque o bloco `inherited` é identificado pelo nome
   * dentro do bloco do pai.
   */
  canOverride(node: DfmNode): boolean {
    if (this.writeTarget(node)) { return true; }
    if (!node.name || !node.parent) { return false; }
    return this.canOverride(node.parent);
  }
}

/**
 * Overrides do descendente vencem os do frame/ancestral, casando por nome.
 *
 * O nó continua marcado como externo mesmo recebendo overrides: ele pertence ao arquivo de
 * origem, e é `override` que diz por onde a edição chega ao arquivo aberto.
 */
function merge(base: DfmNode, over: DfmNode): void {
  for (const [k, v] of over.props) { base.props.set(k, v); }
  base.override = over;
  const byName = new Map(base.kids.filter(k => k.name).map(k => [k.name, k]));
  for (const k of over.kids) {
    const hit = k.name ? byName.get(k.name) : undefined;
    if (hit) { merge(hit, k); }
    else { base.kids.push(k); }
  }
}

/** Depois do merge os caminhos mudam de dono: recalcula para o índice bater. */
function repath(node: DfmNode): void {
  for (const k of node.kids) {
    k.parent = node;
    k.path = `${node.path}/${k.name || k.cls}`;
    repath(k);
  }
}

/** Propriedade de um nó, olhando também o layout item associado. */
export function propOf(doc: DfmDocument, node: DfmNode, key: string): Prop | undefined {
  return node.props.get(key) ?? doc.byControl.get(node)?.props.get(key);
}

export function frameDfmOf(reg: Registry, cls: string): string | undefined {
  const unit = reg.unitOf(cls);
  if (!unit) { return undefined; }
  const dfm = unit.replace(/\.pas$/i, '.dfm');
  return fs.existsSync(dfm) ? dfm : undefined;
}

export function baseName(file: string): string {
  return path.basename(file);
}

export { txt };
