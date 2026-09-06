/**
 * P08 — criar um componente dentro de um TdxLayoutControl.
 *
 * Sob um layout control o `.dfm` guarda duas coisas para o mesmo componente: o controle,
 * filho do layout control como qualquer outro, e um `TdxLayoutItem` irmão que diz em que
 * grupo ele entra, em que ordem, e com que tamanho. Criar só o controle produz um form que
 * abre com o componente invisível — ele existe, mas nenhum grupo o posiciona.
 */

import { DfmNode, num, txt } from './model';
import { DfmDocument } from './document';
import { Registry } from './registry';
import { EditError, TextChange, novoNome } from './edit';
import { padraoDe } from './palette';

const LAYOUT_CONTROL = 'tdxcustomlayoutcontrol';
const LAYOUT_ITEM = 'tdxcustomlayoutitem';
const LAYOUT_GROUP = 'tdxcustomlayoutgroup';

export function ehLayoutControl(reg: Registry, n: DfmNode): boolean {
  return reg.chain(n.cls).includes(LAYOUT_CONTROL);
}

function ehItem(reg: Registry, n: DfmNode): boolean {
  return reg.chain(n.cls).includes(LAYOUT_ITEM);
}

function ehGrupo(reg: Registry, n: DfmNode): boolean {
  return reg.chain(n.cls).includes(LAYOUT_GROUP);
}

export interface Destino {
  /** O TdxLayoutControl que hospeda controle e item. */
  host: DfmNode;
  /** Nome do grupo que vai receber o item. */
  grupo: string;
  /** Classe a usar no item novo, copiada de um irmão quando houver. */
  clsItem: string;
  /** Próximo Index livre dentro do grupo. */
  index: number;
}

/**
 * Onde o componente novo entra, a partir do que o usuário selecionou: o próprio layout
 * control, um grupo dele, ou um controle que já está no layout (entra ao lado).
 */
export function destinoNoLayout(
  doc: DfmDocument, reg: Registry, alvo: DfmNode,
): Destino | null {
  let host: DfmNode | null = null;
  let grupo = '';

  const item = doc.byControl.get(alvo);
  if (item) {
    host = item.parent;
    grupo = txt(item, 'parent', '');
  } else if (ehLayoutControl(reg, alvo)) {
    host = alvo;
  } else if (ehGrupo(reg, alvo) && alvo.parent && ehLayoutControl(reg, alvo.parent)) {
    host = alvo.parent;
    grupo = alvo.name;
  }
  if (!host) { return null; }

  if (!grupo) { grupo = grupoRaiz(reg, host); }
  if (!grupo) {
    throw new EditError(`${host.name || host.cls} não tem grupo de layout para receber ` +
      'o componente: crie o grupo no Delphi primeiro');
  }

  const irmaos = host.kids.filter(k => ehItem(reg, k));
  const noGrupo = irmaos.filter(k => txt(k, 'parent', '') === grupo);
  const clsItem = irmaos[0]?.cls ?? 'TdxLayoutItem';
  const index = noGrupo.length
    ? Math.max(...noGrupo.map(k => num(k, 'index', 0))) + 1 : 0;
  return { host, grupo, clsItem, index };
}

/** O grupo sem `Parent` é a raiz do layout; havendo vários, vale o primeiro declarado. */
function grupoRaiz(reg: Registry, host: DfmNode): string {
  for (const k of host.kids) {
    if (ehGrupo(reg, k) && k.name && !txt(k, 'parent', '')) { return k.name; }
  }
  const qualquer = host.kids.find(k => ehGrupo(reg, k) && k.name);
  return qualquer?.name ?? '';
}

function nomeItem(doc: DfmDocument, base: string): string {
  const usados = new Set([...doc.index.values()].map(n => n.name));
  let i = 1;
  while (usados.has(`${base}Item${i}`)) { i++; }
  return `${base}Item${i}`;
}

/** Cria controle e item num bloco só, para o undo desfazer os dois juntos. */
export function addNoLayout(
  doc: DfmDocument, destino: Destino, cls: string, reg: Registry,
): { changes: TextChange[]; name: string } {
  if (!/^T[A-Za-z_]\w*$/.test(cls)) {
    throw new EditError(`${cls} não parece um nome de classe Delphi`);
  }
  const host = destino.host;
  if (host.uri !== doc.uri) {
    throw new EditError(`${host.name || host.cls} vem de ` +
      `${host.uri.split(/[\\/]/).pop()}: crie o componente no arquivo dele`);
  }
  const padrao = padraoDe(reg.kind(cls), cls);
  const nome = novoNome(doc, cls);
  const item = nomeItem(doc, host.name || 'dxLayout');
  const pad = ' '.repeat(host.indent + 2);
  const at = host.kids.length ? Math.min(...host.kids.map(k => k.line)) : host.endLine;

  const linhas = [
    `${pad}object ${nome}: ${cls}`,
    `${pad}  Left = 0`,
    `${pad}  Top = 0`,
    `${pad}  Width = ${padrao.w}`,
    `${pad}  Height = ${padrao.h}`,
    `${pad}  TabOrder = ${destino.index}`,
    ...padrao.props.map(([k, v]) => `${pad}  ${k} = ${v}`),
    `${pad}end`,
    `${pad}object ${item}: ${destino.clsItem}`,
    `${pad}  Parent = ${destino.grupo}`,
    `${pad}  CaptionOptions.Text = '${nome}'`,
    `${pad}  Control = ${nome}`,
    `${pad}  ControlOptions.OriginalHeight = ${padrao.h}`,
    `${pad}  ControlOptions.OriginalWidth = ${padrao.w}`,
    `${pad}  ControlOptions.ShowBorder = False`,
    `${pad}  Index = ${destino.index}`,
    `${pad}end`,
  ];
  const changes: TextChange[] = linhas.map(text => ({ line: at, kind: 'insert', text }));
  return { changes, name: nome };
}
