/**
 * Class Completion — o `Ctrl+Shift+C` do Delphi.
 *
 * Declarei o método na classe; isto escreve o corpo em `implementation`. É de longe o atalho
 * mais usado da IDE, e sem ele todo método novo custa copiar a assinatura à mão, trocar o
 * nome por `TClasse.Nome` e lembrar quais diretivas se repetem no corpo e quais não.
 *
 * Não é um parser de Object Pascal, e não tenta ser. É uma varredura que reconhece o corpo de
 * uma classe e as declarações dentro dele. Onde não tiver certeza, ela não gera nada — um
 * corpo errado inserido no arquivo é pior que nenhum, porque quebra a compilação num lugar
 * que o usuário não pediu para mexer.
 */

export interface MetodoDeclarado {
  classe: string;
  nome: string;
  /** `procedure Bar(A: Integer)` — sem `;`, sem diretivas, sem o nome da classe. */
  assinatura: string;
  /** `class procedure`, que se repete no corpo. */
  prefixo: string;
  /** Diretivas que o corpo tem de repetir (`overload`, `stdcall`, …). */
  diretivas: string[];
  linha: number;
}

/**
 * Abre um bloco que fecha com `end`.
 *
 * `class` só abre bloco quando é um tipo. `class function`, `class procedure`, `class var` e
 * `class operator` são membros — tratá-los como abertura empurrava um bloco a mais na pilha, e
 * o `end` da classe fechava esse bloco fantasma em vez da classe. O sintoma: do primeiro
 * método de classe em diante, nenhum outro método da classe aparecia como pendente.
 */
const MEMBRO_DE_CLASSE =
  /\bclass\s+(?:function|procedure|constructor|destructor|var|const|property|operator|threadvar)\b/i;
const ABRE = /\b(?:class|record|object|interface|dispinterface)\b(?!\s*(?:;|of\b|helper\b))/i;
const SEM_CORPO = /=\s*class\s*(?:\([^)]*\))?\s*;/i;
/*
 * `class of` é referência de classe, não declaração de uma. Sem o `(?!\s*of\b)`,
 * `TFooClass = class of TFoo;` entrava na pilha como se abrisse um corpo, o `end` da unit
 * fechava outra coisa, e as funções soltas da `interface` viravam métodos dessa classe
 * fantasma. Achado varrendo os 810 `.pas` do projeto de teste.
 */
const CLASSE = /^\s*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*=\s*class\b(?!\s*of\b)/i;
const DECL = /^\s*(class\s+)?(procedure|function|constructor|destructor)\s+([A-Za-z_]\w*)/i;
const IMPL = /^\s*(?:class\s+)?(?:procedure|function|constructor|destructor)\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)/i;

/**
 * As únicas diretivas que o corpo de um método pode repetir: as convenções de chamada.
 *
 * A lista saiu de perguntar ao `dcc32` caso a caso, não da documentação. O resultado
 * contraria o que parece óbvio — `overload`, que todo mundo imagina que se repete, é
 * `E1030 Invalid compiler directive` no corpo:
 *
 *   stdcall cdecl safecall register pascal   →  ok
 *   overload inline                          →  E1030
 *   virtual reintroduce static               →  E2070
 *   override                                 →  E2137
 *
 * Errar para o lado de repetir demais não dá um corpo feio: dá um arquivo que não compila.
 */
const REPETE = new Set(['stdcall', 'cdecl', 'safecall', 'register', 'pascal']);

/** Tira comentários e diretivas de compilação, preservando o comprimento das posições. */
function limpar(linhas: string[]): string[] {
  const out: string[] = [];
  let emBloco = false;
  for (let bruta of linhas) {
    let l = bruta;
    if (emBloco) {
      const fim = l.indexOf('}');
      if (fim < 0) { out.push(''); continue; }
      l = l.slice(fim + 1);
      emBloco = false;
    }
    l = l.replace(/\/\/.*$/, '');
    for (;;) {
      const abre = l.indexOf('{');
      if (abre < 0) { break; }
      if (/^\{\$/.test(l.slice(abre))) {
        // diretiva de compilação: some, mas não abre comentário
        const fechaDir = l.indexOf('}', abre);
        if (fechaDir < 0) { l = l.slice(0, abre); break; }
        l = l.slice(0, abre) + l.slice(fechaDir + 1);
        continue;
      }
      const fecha = l.indexOf('}', abre);
      if (fecha < 0) { l = l.slice(0, abre); emBloco = true; break; }
      l = l.slice(0, abre) + l.slice(fecha + 1);
    }
    out.push(l);
  }
  return out;
}

function profundidade(texto: string): number {
  let n = 0;
  for (const c of texto) {
    if (c === '(' || c === '[') { n++; }
    if (c === ')' || c === ']') { n--; }
  }
  return n;
}

/**
 * Lê a declaração inteira a partir de `i`, que pode passar de uma linha, e separa a
 * assinatura das diretivas.
 */
function lerDeclaracao(
  linhas: string[], i: number,
): { assinatura: string; diretivas: string[]; fim: number } | undefined {
  let junto = '';
  let paren = 0;
  for (let j = i; j < linhas.length && j < i + 12; j++) {
    junto += (junto ? ' ' : '') + linhas[j].trim();
    paren += profundidade(linhas[j]);
    if (paren <= 0 && junto.includes(';')) {
      const corte = acharPontoEVirgula(junto);
      if (corte < 0) { return undefined; }
      const assinatura = junto.slice(0, corte).trim();
      const resto = junto.slice(corte + 1);
      const todas = resto.split(';').map(d => d.trim().toLowerCase().split(/\s+/)[0])
        .filter(Boolean);
      // `abstract` é declaração sem corpo por definição: gerar um seria erro de compilação
      if (todas.includes('abstract')) { return undefined; }
      return { assinatura, diretivas: todas.filter(d => REPETE.has(d)), fim: j };
    }
  }
  return undefined;
}

/** O `;` que fecha a declaração — não o que separa parâmetros dentro dos parênteses. */
function acharPontoEVirgula(texto: string): number {
  let paren = 0;
  for (let k = 0; k < texto.length; k++) {
    const c = texto[k];
    if (c === '(' || c === '[') { paren++; }
    else if (c === ')' || c === ']') { paren--; }
    else if (c === ';' && paren === 0) { return k; }
  }
  return -1;
}

/**
 * Métodos declarados em alguma classe e sem corpo em `implementation`.
 *
 * A comparação é por `Classe.Metodo`, não só pelo nome: duas classes na mesma unit podem ter
 * um `Executar` cada, e casar por nome geraria o corpo de uma achando que era da outra.
 */
export function metodosPendentes(texto: string): MetodoDeclarado[] {
  const linhas = limpar(texto.split(/\r?\n/));
  const declarados: MetodoDeclarado[] = [];
  const implementados = new Set<string>();

  /** Pilha de blocos abertos; o topo diz se estamos no corpo de uma classe e qual. */
  const pilha: (string | null)[] = [];
  let emImplementation = false;

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.trim()) { continue; }

    if (/^\s*implementation\b/i.test(l)) { emImplementation = true; pilha.length = 0; continue; }

    if (emImplementation) {
      /*
       * O nome pode cair na linha seguinte à palavra-chave — o formatador da IDE faz isso
       * sozinho quando `TClasse.MetodoComNomeMuito Longo(` não cabe na margem. Sem juntar as
       * duas linhas, o método parecia não ter corpo e a Class Completion geraria um segundo.
       */
      const junto = /^\s*(?:class\s+)?(?:procedure|function|constructor|destructor)\s*$/i.test(l)
        ? `${l} ${(linhas[i + 1] ?? '').trim()}`
        : l;
      const mi = IMPL.exec(junto);
      if (mi) { implementados.add(`${mi[1].toLowerCase()}.${mi[2].toLowerCase()}`); }
      continue;
    }

    const mc = CLASSE.exec(l);
    if (mc && !SEM_CORPO.test(l)) { pilha.push(mc[1]); continue; }
    // `record`, `case`, classe aninhada: entram como bloco anônimo para o `end` casar
    if (!mc && ABRE.test(l) && !MEMBRO_DE_CLASSE.test(l)
        && !/^\s*interface\s*$/i.test(l) && !/=\s*class\s+of\b/i.test(l)) {
      pilha.push(null);
      continue;
    }
    if (/^\s*case\b/i.test(l) && /\bof\b/i.test(l)) { pilha.push(null); continue; }
    if (/^\s*end\s*[;.]?/i.test(l)) { pilha.pop(); continue; }

    const classe = [...pilha].reverse().find(x => x !== null);
    if (!classe || pilha[pilha.length - 1] !== classe) { continue; }

    const md = DECL.exec(l);
    if (!md) { continue; }
    const lido = lerDeclaracao(linhas, i);
    if (!lido) { continue; }
    i = lido.fim;
    declarados.push({
      classe,
      nome: md[3],
      assinatura: lido.assinatura,
      prefixo: md[1] ? 'class ' : '',
      diretivas: lido.diretivas,
      linha: i,
    });
  }

  return declarados.filter(m =>
    !implementados.has(`${m.classe.toLowerCase()}.${m.nome.toLowerCase()}`));
}

/** O corpo que vai para `implementation`. */
export function corpoDoMetodo(m: MetodoDeclarado, eol: string): string {
  /*
   * A assinatura vem com o nome curto (`procedure Bar(...)`) e no corpo ele leva a classe.
   * A troca é na primeira ocorrência do nome depois da palavra-chave, e não em qualquer
   * lugar — um parâmetro chamado igual ao método existe, e trocar todos quebraria a lista.
   */
  const semPrefixo = m.assinatura.replace(/^\s*class\s+/i, '');
  const marca = new RegExp(
    `^(\\s*(?:procedure|function|constructor|destructor)\\s+)(${m.nome})\\b`, 'i');
  const comClasse = semPrefixo.replace(marca, `$1${m.classe}.$2`);
  const diretivas = m.diretivas.length ? ' ' + m.diretivas.map(d => `${d};`).join(' ') : '';
  const ehFuncao = /^\s*function\b/i.test(semPrefixo);
  const corpo = ehFuncao ? [`  Result := Default(${tipoDeRetorno(semPrefixo)});`] : [''];
  return [
    '',
    `${m.prefixo}${comClasse};${diretivas}`,
    'begin',
    ...corpo,
    'end;',
  ].join(eol);
}

/** O tipo depois do `:` final de uma função. */
function tipoDeRetorno(assinatura: string): string {
  const m = /:\s*([A-Za-z_][\w.<>, ]*)\s*$/.exec(assinatura);
  return m ? m[1].trim() : 'Integer';
}

/**
 * Onde inserir: antes do `end.` que fecha a unit.
 *
 * Colar ao lado do último método da mesma classe seria mais bonito e é onde a IDE põe, mas
 * exige saber onde cada implementação termina — e `begin`/`end` não se contam por palavra
 * (ver a nota em `pascal.ts`). No fim do arquivo o resultado é sempre válido.
 */
export function linhaDeInsercao(texto: string): number {
  const linhas = texto.split(/\r?\n/);
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (/^\s*end\s*\.\s*$/.test(linhas[i])) { return i; }
  }
  return linhas.length;
}

export interface CompletarClasse {
  linha: number;
  texto: string;
  metodos: string[];
}

/** Junta tudo: o que falta implementar e o texto a inserir. */
export function completarClasse(texto: string, eol = '\r\n'): CompletarClasse | undefined {
  const pendentes = metodosPendentes(texto);
  if (!pendentes.length) { return undefined; }
  return {
    linha: linhaDeInsercao(texto),
    texto: pendentes.map(m => corpoDoMetodo(m, eol)).join(eol) + eol,
    metodos: pendentes.map(m => `${m.classe}.${m.nome}`),
  };
}
