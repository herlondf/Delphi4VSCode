/**
 * C02 — o que os Anchors fazem quando o container muda de tamanho.
 *
 * `Anchors` é a única propriedade de layout da VCL cujo efeito não aparece nas coordenadas
 * gravadas: o `.dfm` guarda a posição no tamanho de projeto, e o ajuste acontece em runtime.
 * Quem redimensiona o form no designer do Delphi vê os controles acompanharem na hora — sem
 * isso, arrastar a borda do form aqui deixaria tudo agarrado no canto de cima à esquerda.
 *
 * Regra da VCL, por eixo: sem a âncora do lado que cresceu, nada muda; com a âncora oposta
 * apenas, o controle anda; com as duas, ele estica.
 */

import { DfmNode, num, txt } from './model';
import { DfmDocument } from './document';
import { Registry } from './registry';
import { TextChange } from './edit';
import { moveNode, resizeNode } from './edit';

export interface Anchors {
  left: boolean;
  top: boolean;
  right: boolean;
  bottom: boolean;
}

const PADRAO: Anchors = { left: true, top: true, right: false, bottom: false };

export function lerAnchors(n: DfmNode): Anchors {
  const p = n.props.get('anchors');
  if (!p) { return { ...PADRAO }; }
  const itens = p.raw.replace(/[[\]]/g, '').split(',').map(s => s.trim().toLowerCase());
  return {
    left: itens.includes('akleft'),
    top: itens.includes('aktop'),
    right: itens.includes('akright'),
    bottom: itens.includes('akbottom'),
  };
}

/** Novo (posição, tamanho) num eixo, dado o quanto o container cresceu. */
export function ajustar(
  pos: number, tam: number, delta: number, inicio: boolean, fim: boolean,
): [number, number] {
  if (fim && inicio) { return [pos, Math.max(1, tam + delta)]; }
  if (fim) { return [pos + delta, tam]; }
  return [pos, tam];
}

/**
 * Mudanças a aplicar nos filhos diretos quando o container passa a medir mais `dw` × `dh`.
 *
 * Filho com `Align` diferente de `alNone` é ignorado: quem manda nele é o alinhamento, não
 * a âncora. Filho sob layout control também — lá a posição nem existe no controle.
 */
export function aplicarAnchors(
  doc: DfmDocument, container: DfmNode, dw: number, dh: number, reg: Registry,
): TextChange[] {
  if (!dw && !dh) { return []; }
  const out: TextChange[] = [];
  for (const k of container.kids) {
    if (!reg.isVisual(k)) { continue; }
    if (doc.byControl.has(k)) { continue; }
    const align = txt(k, 'align', 'alNone');
    if (align && align.toLowerCase() !== 'alnone') { continue; }
    if (!doc.canOverride(k)) { continue; }

    const a = lerAnchors(k);
    const x = num(k, 'left');
    const y = num(k, 'top');
    const w = num(k, 'width');
    const h = num(k, 'height');
    const [nx, nw] = ajustar(x, w, dw, a.left, a.right);
    const [ny, nh] = ajustar(y, h, dh, a.top, a.bottom);

    if (nx !== x || ny !== y) { out.push(...moveNode(doc, k, nx, ny)); }
    if (nw !== w || nh !== h) { out.push(...resizeNode(doc, k, nw, nh)); }
  }
  return out;
}
