/**
 * C08 — FireMonkey.
 *
 * O `.fmx` usa o mesmo formato de arquivo do `.dfm` — o parser e o writer servem inteiros.
 * O que muda é onde a geometria mora e como o alinhamento se chama:
 *
 *   VCL   Left / Top / Width / Height   Align = alTop
 *   FMX   Position.X / Position.Y       Align = Top
 *         Size.Width / Size.Height
 *
 * FMX ainda grava em ponto flutuante (`Position.X = 24.000000000000000000`) e o `Size` pode
 * vir como bloco `(24 40 ...)`. Por isso o acesso passa por aqui em vez de ler `num()` cru.
 */

import { DfmNode, Prop } from './model';

const FLOAT = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** O nó fala FireMonkey? Basta ter uma das propriedades de geometria própria dela. */
export function ehFmx(node: DfmNode): boolean {
  return node.props.has('position.x') || node.props.has('size.width');
}

/** Um form inteiro conta como FMX se a raiz ou qualquer filho direto for. */
export function documentoFmx(raiz: DfmNode): boolean {
  if (/^fmx/i.test(raiz.cls)) { return true; }
  return ehFmx(raiz) || raiz.kids.some(ehFmx);
}

function numero(p: Prop | undefined, dflt: number): number {
  if (!p) { return dflt; }
  const v = p.raw.trim();
  if (FLOAT.test(v)) { return Math.round(parseFloat(v)); }
  // `Size.Width` às vezes vem dentro do bloco de `Size = (larg alt ...)`
  const m = /-?\d+(\.\d+)?/.exec(v);
  return m ? Math.round(parseFloat(m[0])) : dflt;
}

/** Posição do nó, em qualquer das duas convenções. */
export function posicao(node: DfmNode): [number, number] {
  if (!ehFmx(node)) { return [numero(node.props.get('left'), 0), numero(node.props.get('top'), 0)]; }
  return [numero(node.props.get('position.x'), 0), numero(node.props.get('position.y'), 0)];
}

export function tamanho(node: DfmNode): [number, number] {
  if (!ehFmx(node)) {
    return [numero(node.props.get('width'), 0), numero(node.props.get('height'), 0)];
  }
  return [numero(node.props.get('size.width'), 0), numero(node.props.get('size.height'), 0)];
}

/**
 * `Align = Top` do FMX no vocabulário do motor de layout, que fala VCL.
 *
 * Os nomes do FMX mudaram entre versões (`alClient` virou `Client` no XE5), e os dois
 * aparecem em projetos reais. As duas grafias mapeiam para o mesmo destino.
 */
const ALIGN_FMX: Record<string, string> = {
  none: 'alnone', top: 'altop', bottom: 'albottom', left: 'alleft', right: 'alright',
  client: 'alclient', contents: 'alclient', center: 'alnone',
  vertcenter: 'alnone', horzcenter: 'alnone', fit: 'alclient', fitleft: 'alleft',
  fitright: 'alright', mostleft: 'alleft', mostright: 'alright',
  mosttop: 'altop', mostbottom: 'albottom', scale: 'alclient',
};

export function alignVcl(valor: string): string {
  const v = valor.trim().toLowerCase();
  if (!v) { return ''; }
  if (v.startsWith('al')) { return v; }
  return ALIGN_FMX[v] ?? 'alnone';
}

/** Nomes das propriedades a escrever ao mover e redimensionar. */
export interface Campos {
  left: [string, string];
  top: [string, string];
  width: [string, string];
  height: [string, string];
  /** FMX grava com casas decimais; o Delphi reescreve assim de qualquer jeito. */
  formatar: (v: number) => string;
}

const VCL: Campos = {
  left: ['left', 'Left'], top: ['top', 'Top'],
  width: ['width', 'Width'], height: ['height', 'Height'],
  formatar: String,
};

const FMX: Campos = {
  left: ['position.x', 'Position.X'], top: ['position.y', 'Position.Y'],
  width: ['size.width', 'Size.Width'], height: ['size.height', 'Size.Height'],
  formatar: v => `${v}.000000000000000000`,
};

export function camposDe(node: DfmNode): Campos {
  return ehFmx(node) ? FMX : VCL;
}
