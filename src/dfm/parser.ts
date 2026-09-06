/** Leitura do .dfm em texto. O formato binário está em binary.ts. */

import { DfmNode, Prop, makeNode } from './model';

const HEADER = /^(object|inherited|inline)\s+(?:([\w.]+)\s*:\s*)?([\w.]+)/i;
const PROP = /^([\w.]+)\s*=\s*(.*)$/;
const PAIRS: Record<string, string> = { '<': '>', '{': '}', '(': ')', '[': ']' };

/**
 * Consome as continuações de um valor: blocos `<>`, `{}`, `()`, `[]` e strings quebradas com `+`.
 * Devolve o valor completo e o índice da próxima linha a processar.
 */
function readValue(val: string, lines: string[], i: number): [string, number] {
  const op = val[0];
  if (op && PAIRS[op]) {
    const close = PAIRS[op];
    let depth = count(val, op) - count(val, close);
    while (depth > 0 && i < lines.length) {
      const next = lines[i].trim();
      i++;
      val += '\n' + next;
      depth += count(next, op) - count(next, close);
    }
  }
  while (val.trimEnd().endsWith('+') && i < lines.length) {
    val = val.trimEnd().slice(0, -1) + lines[i].trim();
    i++;
  }
  return [val, i];
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) { if (c === ch) { n++; } }
  return n;
}

export function parseDfm(text: string, uri: string): DfmNode | null {
  const lines = text.split(/\r?\n/);
  let root: DfmNode | null = null;
  const stack: DfmNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const s = rawLine.trim();
    const here = i;
    i++;
    if (!s) { continue; }

    const head = HEADER.exec(s);
    if (head) {
      const node = makeNode(
        head[1].toLowerCase() as DfmNode['kind'],
        head[2] ?? '', head[3], uri, here, rawLine.length - rawLine.trimStart().length,
      );
      const top = stack[stack.length - 1];
      if (top) {
        node.parent = top;
        node.path = `${top.path}/${node.name || node.cls}`;
        top.kids.push(node);
      } else {
        root = node;
      }
      stack.push(node);
      continue;
    }

    if (s === 'end') {
      const done = stack.pop();
      if (done) { done.endLine = here; }
      continue;
    }

    const top = stack[stack.length - 1];
    if (!top) { continue; }
    const m = PROP.exec(s);
    if (m) {
      const [value, next] = readValue(m[2], lines, i);
      i = next;
      const p: Prop = { label: m[1], raw: value, line: here, uri };
      top.props.set(m[1].toLowerCase(), p);
    }
  }
  return root;
}
