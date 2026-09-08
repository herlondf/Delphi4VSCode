/**
 * O par declaração ↔ implementação de um método, que é o `Ctrl+Shift+↑` da IDE.
 *
 * O DelphiLSP resolve "ir para a definição" de um símbolo usado, e isso é outra coisa: aqui o
 * cursor já está NO método, e o salto é entre os dois lugares onde ele aparece na mesma unit —
 * o cabeçalho dentro da classe e o corpo depois do `implementation`.
 *
 * Não depende do índice do projeto porque o par mora sempre no mesmo arquivo.
 */

export interface Cabecalho {
  nome: string;
  /** Classe dona, quando o cabeçalho é qualificado (`procedure TForm1.Salvar`). */
  classe?: string;
  linha: number;
  /** Coluna onde o nome começa, para o cursor cair em cima dele. */
  coluna: number;
}

/*
 * `class procedure`, `class function` e as diretivas na frente entram; `procedure` como TIPO
 * (`type TCb = procedure of object`) não, senão o salto ia parar numa declaração de tipo.
 */
const RE_CABECALHO =
  /^\s*(?:class\s+)?(?:procedure|function|constructor|destructor|operator)\s+([\w.]+)/i;
const RE_TIPO = /=\s*(?:class\s+)?(?:procedure|function)\b/i;

export function cabecalhos(linhas: string[]): Cabecalho[] {
  const fora: Cabecalho[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].replace(/\/\/.*$/, '');
    if (RE_TIPO.test(linha)) { continue; }
    const m = RE_CABECALHO.exec(linha);
    if (!m) { continue; }
    const ponto = m[1].lastIndexOf('.');
    fora.push({
      nome: ponto < 0 ? m[1] : m[1].slice(ponto + 1),
      classe: ponto < 0 ? undefined : m[1].slice(0, ponto),
      linha: i,
      coluna: linha.indexOf(m[1]) + (ponto < 0 ? 0 : ponto + 1),
    });
  }
  return fora;
}

/** O cabeçalho que governa a linha do cursor: o dela, ou o mais próximo acima. */
export function cabecalhoEm(lista: Cabecalho[], linha: number): Cabecalho | undefined {
  let achado: Cabecalho | undefined;
  for (const c of lista) {
    if (c.linha > linha) { break; }
    achado = c;
  }
  return achado;
}

/**
 * O outro lado do par.
 *
 * De um corpo qualificado vai para a declaração da mesma classe; de uma declaração vai para o
 * corpo qualificado. Com sobrecarga há mais de um candidato e o critério é a proximidade —
 * não dá para distinguir pela assinatura sem analisar os parâmetros, e errar de sobrecarga
 * ainda deixa o cursor no lugar certo do arquivo.
 */
export function par(lista: Cabecalho[], atual: Cabecalho): Cabecalho | undefined {
  const alvos = lista.filter(c =>
    c !== atual
    && c.nome.toLowerCase() === atual.nome.toLowerCase()
    && !!c.classe !== !!atual.classe
    && (!atual.classe || !c.classe || c.classe.toLowerCase() === atual.classe.toLowerCase()));
  if (!alvos.length) { return undefined; }
  return alvos.reduce((a, b) =>
    Math.abs(b.linha - atual.linha) < Math.abs(a.linha - atual.linha) ? b : a);
}
