/**
 * Frequência de cada classe nos .dfm do workspace.
 *
 * É o que faz a paleta refletir o projeto: num repositório DevExpress, oferecer TButton
 * antes de TcxButton é oferecer o que ninguém usa.
 */

import * as fs from 'fs';
import * as path from 'path';

const HDR = /^[ \t]*(?:object|inherited|inline)[ \t]+(?:[\w.]+[ \t]*:[ \t]*)?(T\w+)/gm;
const PULAR = new Set(['__history', '__recovery', 'node_modules', '.git']);

export function contarComponentes(raizes: string[], limiteMs = 8000): Map<string, number> {
  const fim = Date.now() + limiteMs;
  const contagem = new Map<string, number>();
  const varrer = (dir: string): void => {
    if (Date.now() > fim) { return; }
    let entradas: fs.Dirent[];
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !PULAR.has(e.name.toLowerCase())) { varrer(full); }
      } else if (e.name.toLowerCase().endsWith(".dfm")) {
        let src: string;
        try { src = fs.readFileSync(full, "latin1"); } catch { continue; }
        HDR.lastIndex = 0;
        for (const m of src.matchAll(HDR)) {
          contagem.set(m[1], (contagem.get(m[1]) ?? 0) + 1);
        }
      }
    }
  };
  for (const r of raizes) { varrer(r); }
  return contagem;
}
