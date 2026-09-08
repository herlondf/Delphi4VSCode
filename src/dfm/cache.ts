/**
 * Cache do índice de classes.
 *
 * A regra que faltava aqui custou um designer inteiro: **índice vazio não é cache válido**.
 *
 * O cache era aceito por dois critérios, versão e lista de pastas, e um índice com zero
 * classes passava nos dois. Bastava a primeira indexação acontecer antes de haver projeto
 * ativo — as pastas saem do search path dele — para o arquivo gravar zero; daí em diante toda
 * sessão carregava esse zero e nunca reconstruía. E como `isVisual` recusa o que não está
 * indexado, o form abria SEM NENHUM COMPONENTE, só a moldura, sem nada explicando por quê.
 */

import { Registry } from './registry';

/*
 * 2: nome declarado; 3: propriedades por classe (C04); 4: descarta os cortados.
 *
 * A 4 não muda o formato — invalida o que já está gravado. Até a 3, uma varredura interrompida
 * pelo tempo limite virava cache sem nada indicando isso, e não há como olhar um arquivo desses
 * e saber se ele está inteiro. Subir a versão é o único jeito de reconstruir todos.
 */
export const CACHE_VERSION = 4;

export interface Cache {
  version: number;
  roots: string[];
  data: unknown;
}

export function mesmasRaizes(a: unknown, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * O índice do cache, ou `undefined` quando ele não serve — e aí quem chama reconstrói.
 *
 * Não serve: JSON quebrado, versão de outro formato, pastas diferentes das de agora, ou
 * ZERO CLASSE. O último é o que importa: reconstruir à toa custa segundos, e confiar num
 * índice vazio custa o designer inteiro, em silêncio, para sempre.
 */
export function lerCache(texto: string, roots: string[]): Registry | undefined {
  let bruto: Cache;
  try {
    bruto = JSON.parse(texto) as Cache;
  } catch {
    return undefined;
  }
  if (bruto?.version !== CACHE_VERSION || !mesmasRaizes(bruto.roots, roots)) { return undefined; }
  const reg = Registry.fromJSON(bruto.data);
  return reg.size > 0 ? reg : undefined;
}

/** O que gravar. Devolve `undefined` para índice vazio: gravar zero é o que perpetua o erro. */
export function conteudoDoCache(reg: Registry, roots: string[]): string | undefined {
  if (reg.size === 0) { return undefined; }
  return JSON.stringify({ version: CACHE_VERSION, roots, data: reg.toJSON() });
}

/**
 * Arquivo de cache que nenhuma versão volta a ler — é lixo e pode sair.
 *
 * Recebe só o COMEÇO do arquivo: um cache passa de 19 MB, e ler tudo para conferir um número
 * no cabeçalho é desperdício. Versão diferente da corrente nunca mais será aceita; ilegível
 * também não.
 *
 * Só a versão decide. Cache de OUTRO conjunto de pastas, na versão corrente, é de outra
 * janela do usuário e tem de ficar — apagá-lo faria as duas reindexarem uma contra a outra.
 */
export function ehCacheObsoleto(inicio: string): boolean {
  const m = /"version"\s*:\s*(\d+)/.exec(inicio);
  return !m || Number(m[1]) !== CACHE_VERSION;
}
