/**
 * Depurar um binário Delphi sem a IDE.
 *
 * O `rmtdbg` da instalação não serve: é o servidor a que o depurador da IDE se conecta, por
 * protocolo proprietário, e não tem linha de comando. O caminho que funciona é outro, e foi
 * verificado ponta a ponta antes de virar código:
 *
 *   1. compilar com map DETALHADO (`DCC_MapFile=3`, o `-GD` do compilador). Só isso — o
 *      `-V` de debug info no executável NÃO é necessário;
 *   2. converter o `.map` em `.pdb` com o `map2pdb`, que lê exatamente a seção
 *      "Line numbers for <unit>" do map detalhado;
 *   3. depurar com qualquer depurador que leia PDB. No VS Code é o `cppvsdbg`, do
 *      ms-vscode.cpptools.
 *
 * Conferido com o `cdb.exe` do Windows Kits sobre um executável Win64 do `dcc64`: breakpoint
 * posto por linha de Pascal (`Alvo.dpr:10`) parou, e a pilha veio com arquivo e linha —
 * `Alvo!Somar [Alvo.dpr @ 10]`.
 */

import * as fs from 'fs';
import * as path from 'path';

/** A propriedade que faz o MSBuild pedir o map detalhado ao compilador. */
export const MAP_DETALHADO = { DCC_MapFile: '3' };

export interface Artefatos {
  exe: string;
  map: string;
  pdb: string;
}

export function artefatos(exe: string): Artefatos {
  const semExt = exe.replace(/\.exe$/i, '');
  return { exe, map: `${semExt}.map`, pdb: `${semExt}.pdb` };
}

function mtime(arquivo: string): number {
  try { return fs.statSync(arquivo).mtimeMs; } catch { return 0; }
}

/**
 * Por que o PDB precisa (ou não) ser gerado de novo.
 *
 * Devolver o motivo, e não um booleano, é o que deixa a mensagem na tela dizer a verdade:
 * "não achei o .map" e "o .pdb está velho" pedem ações diferentes do usuário.
 */
export function estadoDoPdb(a: Artefatos): { converter: boolean; motivo: string } {
  if (!mtime(a.map)) {
    return { converter: false, motivo: `não achei ${path.basename(a.map)} — compile com map detalhado` };
  }
  const pdb = mtime(a.pdb);
  if (!pdb) { return { converter: true, motivo: 'ainda não existe .pdb' }; }
  if (pdb < mtime(a.map)) { return { converter: true, motivo: '.pdb mais velho que o .map' }; }
  return { converter: false, motivo: '.pdb em dia' };
}

/*
 * `-bind` grava no executável a referência ao PDB.
 *
 * Sem isso o depurador só acha os símbolos se o `.pdb` estiver no caminho de símbolos, o que
 * obriga a configurar `_NT_SYMBOL_PATH` — com o bind, o próprio executável diz onde está.
 */
export function argumentosMap2pdb(map: string): string[] {
  return ['-bind', map];
}

export interface Lancamento {
  exe: string;
  cwd?: string;
  args?: string[];
  nome?: string;
}

/**
 * A configuração de depuração, no formato do `cppvsdbg`.
 *
 * `cppvsdbg` é o motor da Visual Studio, e é o que lê PDB no Windows. O `cppdbg` (gdb/lldb)
 * não serve aqui: o executável do Delphi para Windows não tem DWARF.
 */
export function configDeLancamento(l: Lancamento): Record<string, unknown> {
  return {
    name: l.nome ?? `Depurar ${path.basename(l.exe)}`,
    type: 'cppvsdbg',
    request: 'launch',
    program: l.exe,
    args: l.args ?? [],
    cwd: l.cwd ?? path.dirname(l.exe),
    stopAtEntry: false,
    console: 'integratedTerminal',
    symbolSearchPath: path.dirname(l.exe),
  };
}

/** Onde procurar o conversor quando nada foi configurado. */
export function candidatosMap2pdb(raizes: string[]): string[] {
  const nomes = ['map2pdb.exe', path.join('Bin', 'map2pdb.exe'),
                 path.join('map2pdb', 'Bin', 'map2pdb.exe')];
  const fora: string[] = [];
  for (const r of raizes) {
    for (const n of nomes) { fora.push(path.join(r, n)); }
  }
  return fora;
}
