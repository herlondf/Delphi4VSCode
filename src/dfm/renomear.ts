/**
 * Renomear uma unit no projeto inteiro.
 *
 * O roadmap apontava o `reFind.exe` da instalação para isto. Ele funciona, mas dentro do VS
 * Code é a escolha pior: edita os arquivos por fora, deixa `.bak` espalhado e o usuário não
 * tem prévia nem um Ctrl+Z que desfaça tudo. Um `WorkspaceEdit` dá as três coisas de graça.
 *
 * O que é seguro trocar, e o que não é:
 *
 *  - o cabeçalho `unit X;` do próprio arquivo — seguro, é declaração;
 *  - o nome dentro de uma cláusula `uses` — seguro, ali só cabe nome de unit;
 *  - `X in 'X.pas'` do `.dpr` e o `Include=` do `.dproj` — seguros, são caminho de arquivo;
 *  - `X.AlgumaCoisa` no meio do código — NÃO. `X` ali pode ser variável, classe ou campo com
 *    o mesmo nome, e trocar em massa é como se renomeia uma unit e se quebra outra coisa.
 *    Essas ocorrências são LISTADAS para quem renomeia decidir, não trocadas.
 */

export interface Ocorrencia {
  linha: number;
  coluna: number;
  tamanho: number;
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*(?:[.][A-Za-z_][A-Za-z0-9_]*)*';

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Trechos `uses ... ;`, em pares [início, fim) de índice no texto. */
export function regioesUses(texto: string): [number, number][] {
  const fora: [number, number][] = [];
  const re = /(^|[^\w.])uses\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const inicio = m.index + m[0].length;
    const fim = texto.indexOf(';', inicio);
    if (fim < 0) { break; }
    fora.push([inicio, fim]);
    re.lastIndex = fim;
  }
  return fora;
}

function paraLinhaColuna(texto: string, indice: number): { linha: number; coluna: number } {
  const antes = texto.slice(0, indice);
  const linha = (antes.match(/\n/g) || []).length;
  const ultima = antes.lastIndexOf('\n');
  return { linha, coluna: indice - ultima - 1 };
}

/** Onde o nome da unit aparece em cláusula `uses` — o que pode ser trocado sem pensar. */
export function noUses(texto: string, unit: string): Ocorrencia[] {
  const fora: Ocorrencia[] = [];
  const re = new RegExp(`(^|[^\\w.])(${escapar(unit)})(?![\\w.])`, 'gi');
  for (const [ini, fim] of regioesUses(texto)) {
    const trecho = texto.slice(ini, fim);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trecho))) {
      const at = ini + m.index + m[1].length;
      fora.push({ ...paraLinhaColuna(texto, at), tamanho: unit.length });
    }
  }
  return fora;
}

/** O cabeçalho `unit X;` do próprio arquivo. */
export function noCabecalho(texto: string, unit: string): Ocorrencia | undefined {
  const m = new RegExp(`(^\\s*unit\\s+)(${escapar(unit)})\\s*;`, 'im').exec(texto);
  if (!m) { return undefined; }
  const at = m.index + m[1].length;
  return { ...paraLinhaColuna(texto, at), tamanho: unit.length };
}

/** `X in 'X.pas'` do `.dpr`: o nome e, dentro do caminho, o arquivo. */
export function noDpr(texto: string, unit: string): Ocorrencia[] {
  const fora: Ocorrencia[] = [];
  const re = new RegExp(`(^|[^\\w.])(${escapar(unit)})(\\s+in\\s+')([^']*)(')`, 'gim');
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    fora.push({ ...paraLinhaColuna(texto, m.index + m[1].length), tamanho: unit.length });
    const caminho = m.index + m[1].length + m[2].length + m[3].length;
    const i = m[4].toLowerCase().lastIndexOf(unit.toLowerCase());
    if (i >= 0) {
      fora.push({ ...paraLinhaColuna(texto, caminho + i), tamanho: unit.length });
    }
  }
  return fora;
}

/** `Include="...X.pas"` do `.dproj`. */
export function noDproj(texto: string, unit: string): Ocorrencia[] {
  const fora: Ocorrencia[] = [];
  const re = new RegExp(`Include="([^"]*?)(${escapar(unit)})(\\.pas)"`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const at = m.index + 'Include="'.length + m[1].length;
    fora.push({ ...paraLinhaColuna(texto, at), tamanho: unit.length });
  }
  return fora;
}

/**
 * Usos qualificados fora de `uses` — os que NÃO se troca sozinho.
 *
 * `X.Algo` pode ser a unit qualificando um símbolo, e pode ser uma variável chamada `X`. Sem
 * resolver o escopo não dá para saber, e trocar errado quebra em silêncio.
 */
export function qualificadosForaDoUses(texto: string, unit: string): Ocorrencia[] {
  const regioes = regioesUses(texto);
  const dentro = (i: number): boolean => regioes.some(([a, b]) => i >= a && i < b);
  const fora: Ocorrencia[] = [];
  const re = new RegExp(`(^|[^\\w.'])(${escapar(unit)})[.](?=${IDENT})`, 'gim');
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const at = m.index + m[1].length;
    if (dentro(at)) { continue; }
    fora.push({ ...paraLinhaColuna(texto, at), tamanho: unit.length });
  }
  return fora;
}
