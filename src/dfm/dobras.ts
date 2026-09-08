/**
 * Dobrar código Object Pascal.
 *
 * O DelphiLSP não oferece `foldingRange` — e o dobramento por indentação que o VS Code usa
 * como padrão não serve aqui, porque `begin`/`end` de um método ficam na mesma coluna do
 * `procedure` e a IDE dobra pelo par de palavras, não pelo recuo.
 *
 * São quatro dobras, e a ordem importa: string e comentário são reconhecidos primeiro, senão
 * um `end` dentro de um literal fecha um bloco que não abriu.
 */

/** Uma dobra, sem depender do vscode — é o que os testes exercitam. */
export interface Dobra {
  inicio: number;
  fim: number;
  tipo?: 'comentario' | 'regiao';
}

/** `{$REGION 'x'}` ... `{$ENDREGION}` — a única dobra que o programador escreve à mão. */
const REGIAO_ABRE = /\{\$region\b/i;
const REGIAO_FECHA = /\{\$endregion\b/i;
/** As seções de uma unit; cada uma vai até a próxima. */
const SECAO = /^\s*(interface|implementation|initialization|finalization)\s*(\/\/.*)?$/i;
/*
 * `end` sem ponto fecha um bloco; `end.` fecha a unit e não é dobra.
 *
 * Abrem bloco: `begin`, `case`, `try` e `asm`, sempre; e uma declaração de tipo
 * `= class`/`= interface`/`= record`/`= object`, que também termina em `end`. A declaração
 * precisa do `=` porque `class procedure` e `class var` NÃO abrem nada, e não pode terminar
 * em `;` — `TFoo = class;` é declaração adiantada, e `class of TBar` é referência de classe.
 * Sem a regra do `=`, o `end;` de uma classe sem ancestral fechava o bloco errado.
 */
const ABRE_SIMPLES = /(^|[^\w.])(begin|case|try|asm)($|[^\w])/i;
const ABRE_TIPO = /=\s*(packed\s+)?(class|interface|record|object)\b(?!\s*(of\b|;))/i;
const FECHA = /(^|[^\w.])end($|[^\w.])/i;

/** Tira string e comentário de linha, para as palavras-chave não casarem dentro deles. */
function limpar(linha: string): string {
  return linha.replace(/'[^']*'/g, "''").replace(/\/\/.*$/, '');
}

export function dobras(linhas: string[]): Dobra[] {
  const fora: Dobra[] = [];
  const regioes: number[] = [];
  const blocos: number[] = [];
  let secao = -1;
  let comentario = -1;

  for (let i = 0; i < linhas.length; i++) {
    const bruta = linhas[i];

    // comentário de bloco: `{ ... }` e `(* ... *)`, só quando abre e fecha em linhas diferentes
    if (comentario >= 0) {
      if (/\}|\*\)/.test(bruta)) {
        if (i > comentario) { fora.push({ inicio: comentario, fim: i, tipo: 'comentario' }); }
        comentario = -1;
      }
      continue;
    }
    if (/^\s*(\{(?!\$)|\(\*)/.test(bruta) && !/\}|\*\)/.test(bruta.slice(1))) { comentario = i; continue; }

    const linha = limpar(bruta);

    if (REGIAO_ABRE.test(linha)) { regioes.push(i); continue; }
    if (REGIAO_FECHA.test(linha)) {
      const abriu = regioes.pop();
      if (abriu !== undefined && i > abriu) {
        fora.push({ inicio: abriu, fim: i, tipo: 'regiao' });
      }
      continue;
    }

    if (SECAO.test(linha)) {
      if (secao >= 0 && i - 1 > secao) { fora.push({ inicio: secao, fim: i - 1 }); }
      secao = i;
      continue;
    }

    if (ABRE_SIMPLES.test(linha) || ABRE_TIPO.test(linha)) { blocos.push(i); }
    if (FECHA.test(linha)) {
      const abriu = blocos.pop();
      if (abriu !== undefined && i > abriu) { fora.push({ inicio: abriu, fim: i }); }
    }
  }
  if (secao >= 0 && linhas.length - 1 > secao) {
    fora.push({ inicio: secao, fim: linhas.length - 1 });
  }
  return fora;
}
