/**
 * O campo do componente na classe do form.
 *
 * Um `.dfm` e o `.pas` ao lado são um par: para cada `object Botao: TButton` do arquivo tem de
 * existir `Botao: TButton;` na classe. A IDE mantém os dois em sincronia sozinha, e o designer
 * daqui não mantinha — criava o componente no `.dfm` e deixava a classe para trás. O resultado
 * é o pior tipo de defeito: compila, e quebra ao abrir a tela.
 *
 * As edições saem daqui como lista de linhas, sem tocar em arquivo — é o que permite testar a
 * regra sem o VS Code no meio.
 *
 * Renomear não está aqui de propósito: `rename.ts` já cobre isso e cobre melhor, mexendo
 * também nos handlers de evento e nas referências dentro do form. Uma segunda implementação
 * paralela só criaria dois lugares para o mesmo defeito.
 */

export interface EdicaoPas {
  kind: 'insert' | 'replace' | 'delete';
  linha: number;
  texto: string;
}

/**
 * Campos de componente ficam no bloco implícito, antes do primeiro `private`.
 *
 * Numa classe de form tudo que vem entre o cabeçalho e o primeiro especificador de
 * visibilidade é `published` — é lá que a IDE põe os componentes, e é de lá que o streaming
 * do DFM os lê. Pôr o campo num `private` faz a tela carregar sem ele.
 */
const CABECALHO = /^\s*([A-Za-z_]\w*)\s*=\s*class\s*\(/i;
const VISIBILIDADE = /^\s*(private|protected|public|published|strict\s+private|strict\s+protected)\b/i;
const CAMPO = /^(\s*)([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.]*)\s*;/;
const FIM = /^\s*end\s*;/;

interface Classe {
  nome: string;
  cabecalho: number;
  /** Última linha do bloco implícito, ou o próprio cabeçalho se não houver campo. */
  ultimoCampo: number;
  /** Primeira linha de visibilidade, onde o bloco implícito acaba. */
  corte: number;
  recuo: string;
  campos: { nome: string; tipo: string; linha: number }[];
}

/** Acha a classe pelo nome, e mapeia o bloco implícito dela. */
export function acharClasse(texto: string, nomeClasse: string): Classe | undefined {
  const linhas = texto.split(/\r?\n/);
  let dentro = false;
  let c: Classe | undefined;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].replace(/\/\/.*$/, '');
    if (!dentro) {
      const m = CABECALHO.exec(l);
      if (m && m[1].toLowerCase() === nomeClasse.toLowerCase()) {
        dentro = true;
        c = {
          nome: m[1], cabecalho: i, ultimoCampo: i, corte: -1,
          recuo: '    ', campos: [],
        };
      }
      continue;
    }
    if (!c) { break; }
    if (FIM.test(l)) { break; }
    if (VISIBILIDADE.test(l)) {
      if (c.corte < 0) { c.corte = i; }
      break;
    }
    const mc = CAMPO.exec(l);
    if (mc) {
      c.recuo = mc[1] || c.recuo;
      c.ultimoCampo = i;
      c.campos.push({ nome: mc[2], tipo: mc[3], linha: i });
    }
  }
  return c;
}

/**
 * Declara o campo do componente. Devolve lista vazia quando ele já existe — criar o mesmo
 * componente duas vezes acontece, e declarar duas vezes é erro de compilação.
 */
export function declararCampo(
  texto: string, nomeClasse: string, nomeComponente: string, tipo: string,
): EdicaoPas[] {
  const c = acharClasse(texto, nomeClasse);
  if (!c) { return []; }
  if (c.campos.some(x => x.nome.toLowerCase() === nomeComponente.toLowerCase())) { return []; }
  return [{
    kind: 'insert',
    linha: c.ultimoCampo + 1,
    texto: `${c.recuo}${nomeComponente}: ${tipo};`,
  }];
}

/** Tira o campo do componente apagado. Sem isto a classe fica com um campo que não existe. */
export function removerCampo(
  texto: string, nomeClasse: string, nomeComponente: string,
): EdicaoPas[] {
  const c = acharClasse(texto, nomeClasse);
  const campo = c?.campos.find(x => x.nome.toLowerCase() === nomeComponente.toLowerCase());
  return campo ? [{ kind: 'delete', linha: campo.linha, texto: '' }] : [];
}
