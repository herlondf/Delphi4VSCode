/**
 * Índice de declarações para o Ctrl+T e para achar usos.
 *
 * O `Registry` indexa classes e propriedades — é o que o designer precisa. Isto aqui indexa o
 * que o *editor* precisa: método, função solta, constante, tipo e variável global, com
 * arquivo e linha. Sem ele não há "ir a símbolo no projeto" nem "achar usos", porque o
 * DelphiLSP não oferece `workspaceSymbol` nem `references` (conferido na resposta de
 * `initialize`).
 *
 * Cobre só as fontes do projeto, não a RTL nem os componentes de terceiros. Dois motivos: o
 * Ctrl+T serve para andar no código que se está escrevendo, e indexar as 29 mil classes da
 * instalação junto multiplicaria a memória por uma lista que ninguém percorre. Para a RTL já
 * existe o Ctrl+clique, que o compilador resolve melhor do que qualquer índice nosso.
 */

import * as fs from 'fs';
import * as path from 'path';

export type TipoSimbolo =
  | 'classe' | 'interface' | 'record' | 'metodo' | 'funcao' | 'constante' | 'tipo' | 'variavel';

export interface Simbolo {
  nome: string;
  tipo: TipoSimbolo;
  /** Classe dona, quando é método. */
  classe?: string;
  arquivo: string;
  linha: number;
}

/*
 * Pastas de saída, não de fonte. `lib` NÃO entra: em projeto Delphi ela costuma guardar
 * código compartilhado do próprio time — no projeto de teste são 960 `.pas`, um quinto do projeto, que
 * a primeira versão desta lista descartava por engano.
 */
const SAIDA = new Set([
  '__history', '__recovery', 'node_modules', '.git', '.svn',
  'win32', 'win64', 'android', 'android64', 'ios', 'iosdevice64', 'osx64', 'linux64',
]);

/** A contrabarra montada em codigo: escrever `\b` aqui ja virou um backspace literal
 * uma vez, e uma regex que nunca casa nao da erro nenhum — so um resultado vazio. */
const BARRA = String.fromCharCode(92);
const BRANCO = BARRA + 's';
const LIMITE = BARRA + 'b';

const TIPO_DECL = /^\s*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*=\s*(class|interface|record|packed\s+record|object)\b/i;
const TIPO_OUTRO = /^\s*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*=\s*(?!class|interface|record|object)\S/i;
const IMPL = /^\s*(?:class\s+)?(?:procedure|function|constructor|destructor)\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)/i;
const SOLTA = /^(?:procedure|function)\s+([A-Za-z_]\w*)/i;
const CONST_DECL = /^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*[^=]/;
const VAR_DECL = /^\s*([A-Za-z_]\w*)\s*:\s*[A-Za-z_]/;

/** Palavras que trocam o contexto da varredura. */
const CONTEXTO = new RegExp(
  '^' + BRANCO + '*(const|var|type|resourcestring|threadvar|begin|asm|implementation'
  + '|interface|initialization|finalization|uses)' + LIMITE, 'i');
const DECLARATIVA = /^(const|var|threadvar|type|resourcestring)$/;

/** Onde a varredura está: fora, na seção `const`, na `var`, ou na `type`. */
type Secao = '' | 'const' | 'var' | 'type';

export class IndiceSimbolos {
  private simbolos: Simbolo[] = [];
  /** Nome em minúsculas → posições em `simbolos`, para a busca não varrer tudo. */
  private porNome = new Map<string, number[]>();
  /*
   * Caminho e nome de classe se repetem por centenas de símbolos cada. Guardar a mesma
   * string, e não cópias iguais, foi o que tirou o índice de 207 MB de heap: `path.join`
   * devolve uma string nova a cada chamada, e 350 mil delas não cabem no orçamento de uma
   * extensão.
   */
  private internados = new Map<string, string>();

  private internar(v: string): string {
    const achado = this.internados.get(v);
    if (achado !== undefined) { return achado; }
    this.internados.set(v, v);
    return v;
  }

  get tamanho(): number {
    return this.simbolos.length;
  }

  limpar(): void {
    this.simbolos = [];
    this.porNome.clear();
    this.internados.clear();
  }

  private juntar(s: Simbolo): void {
    s.arquivo = this.internar(s.arquivo);
    if (s.classe) { s.classe = this.internar(s.classe); }
    const i = this.simbolos.push(s) - 1;
    const chave = s.nome.toLowerCase();
    const lista = this.porNome.get(chave);
    if (lista) { lista.push(i); } else { this.porNome.set(chave, [i]); }
  }

  /**
   * @param excluir nomes de pasta a pular além das de saída — por padrão o código de
   * terceiros, que é dois terços dos `.pas` de um projeto grande e não é o que se procura
   * no Ctrl+T (no projeto de teste: 3.023 de 4.515 arquivos vêm de `vendor`).
   */
  varrer(raizes: string[], budgetMs = 15000, excluir: string[] = []): void {
    const prazo = Date.now() + budgetMs;
    const vistos = new Set<string>();
    const fora = new Set(excluir.map(e => e.toLowerCase()));
    for (const raiz of raizes) { this.varrerDir(raiz, prazo, vistos, fora); }
  }

  private varrerDir(
    dir: string, prazo: number, vistos: Set<string>, fora: Set<string>,
  ): void {
    let entradas: fs.Dirent[];
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      if (Date.now() > prazo) { return; }
      const cheio = path.join(dir, e.name);
      if (e.isDirectory()) {
        const baixo = e.name.toLowerCase();
        if (!e.name.startsWith('.') && !SAIDA.has(baixo) && !fora.has(baixo)) {
          this.varrerDir(cheio, prazo, vistos, fora);
        }
      } else if (/\.(pas|dpr|dpk)$/i.test(e.name)) {
        const chave = cheio.toLowerCase();
        if (vistos.has(chave)) { continue; }
        vistos.add(chave);
        this.varrerArquivo(cheio);
      }
    }
  }

  varrerArquivo(arquivo: string): void {
    let src: string;
    try { src = fs.readFileSync(arquivo, 'latin1'); } catch { return; }
    const linhas = src.split(/\r?\n/);
    let secao: Secao = '';
    let emComentario = false;
    let profundidadeTipo = 0;
    /*
     * `var` e `const` também abrem seção DENTRO de uma rotina, e ali declaram variável local.
     * Sem esta trava, o índice enchia de `Valor`, `I`, `S` — cada um dezenas de vezes — e
     * enterrava os nomes que se procura de fato. Vale entre o cabeçalho da rotina e o `begin`.
     */
    let emRotina = false;

    for (let i = 0; i < linhas.length; i++) {
      let l = linhas[i];
      if (emComentario) {
        const fim = l.indexOf('}');
        if (fim < 0) { continue; }
        l = l.slice(fim + 1);
        emComentario = false;
      }
      l = l.replace(/\/\/.*$/, '');
      const abre = l.indexOf('{');
      if (abre >= 0 && !/^\{\$/.test(l.slice(abre))) {
        const fecha = l.indexOf('}', abre);
        if (fecha < 0) { l = l.slice(0, abre); emComentario = true; }
        else { l = l.slice(0, abre) + l.slice(fecha + 1); }
      }
      if (!l.trim()) { continue; }

      /*
       * Método implementado vem primeiro na ordem dos testes porque é o que se procura no
       * Ctrl+T: quem digita `Salvar` quer o corpo, não a linha da declaração na classe.
       */
      const mi = IMPL.exec(l);
      if (mi) {
        this.juntar({ nome: mi[2], tipo: 'metodo', classe: mi[1], arquivo, linha: i });
        secao = '';
        emRotina = true;
        continue;
      }
      const ms = SOLTA.exec(l);
      if (ms) {
        this.juntar({ nome: ms[1], tipo: 'funcao', arquivo, linha: i });
        secao = '';
        emRotina = true;
        continue;
      }
      /*
       * Um lugar so para as palavras que trocam de contexto.
       *
       * Eram duas guardas, e `begin` estava nas duas listas. A segunda zerava a secao sem
       * zerar `emRotina`, entao a partir da primeira rotina da unit toda variavel e
       * constante de unidade era descartada como se fosse local.
       */
      const chave = CONTEXTO.exec(l);
      if (chave) {
        const p = chave[1].toLowerCase();
        secao = p === 'type' ? 'type'
          : (p === 'var' || p === 'threadvar') ? 'var'
            : (p === 'const' || p === 'resourcestring') ? 'const' : '';
        // `begin` fecha o cabecalho da rotina: daqui em diante e corpo, nao declaracao
        if (!DECLARATIVA.test(p)) { emRotina = false; }
        continue;
      }

      /*
       * Dentro do corpo de uma classe ou record só interessa a declaração do tipo, não cada
       * campo — os campos já estão no `Registry`, e jogá-los no Ctrl+T enterraria os nomes
       * que a pessoa procura sob milhares de `FNome`.
       */
      if (profundidadeTipo > 0) {
        if (/^\s*end\s*;/i.test(l)) { profundidadeTipo--; }
        else if (TIPO_DECL.test(l) && !/=\s*class\s*(\([^)]*\))?\s*;/i.test(l)) {
          profundidadeTipo++;
        }
        continue;
      }

      if (secao === 'type') {
        const mt = TIPO_DECL.exec(l);
        if (mt) {
          const tipo = /interface/i.test(mt[2]) ? 'interface'
            : /record|object/i.test(mt[2]) ? 'record' : 'classe';
          this.juntar({ nome: mt[1], tipo, arquivo, linha: i });
          // `TFoo = class;` e `TFoo = class of X;` não abrem corpo
          if (!/=\s*class\s*(?:\([^)]*\))?\s*;/i.test(l) && !/=\s*class\s+of\b/i.test(l)) {
            profundidadeTipo++;
          }
          continue;
        }
        const mo = TIPO_OUTRO.exec(l);
        if (mo) { this.juntar({ nome: mo[1], tipo: 'tipo', arquivo, linha: i }); }
        continue;
      }
      if (emRotina) { continue; }
      if (secao === 'const') {
        const mc = CONST_DECL.exec(l);
        if (mc) { this.juntar({ nome: mc[1], tipo: 'constante', arquivo, linha: i }); }
        continue;
      }
      if (secao === 'var') {
        const mv = VAR_DECL.exec(l);
        if (mv) { this.juntar({ nome: mv[1], tipo: 'variavel', arquivo, linha: i }); }
      }
    }
  }

  /**
   * Busca por nome. Exato antes de prefixo, prefixo antes de contido — é a ordem que faz
   * digitar `Salvar` mostrar `Salvar` no topo, e não `SalvarComoRascunhoAntesDeFechar`.
   */
  buscar(consulta: string, limite = 300): Simbolo[] {
    const q = consulta.trim().toLowerCase();
    if (!q) { return []; }

    const exatos = (this.porNome.get(q) ?? []).map(i => this.simbolos[i]);
    if (exatos.length >= limite) { return exatos.slice(0, limite); }

    const prefixo: Simbolo[] = [];
    const contidos: Simbolo[] = [];
    for (const [nome, idx] of this.porNome) {
      if (nome === q) { continue; }
      const onde = nome.indexOf(q);
      if (onde < 0) { continue; }
      const destino = onde === 0 ? prefixo : contidos;
      for (const i of idx) { destino.push(this.simbolos[i]); }
      if (exatos.length + prefixo.length + contidos.length > limite * 4) { break; }
    }
    return [...exatos, ...prefixo, ...contidos].slice(0, limite);
  }

  /** Todas as declarações de um nome — é o que o "ir para a definição" usa como reserva. */
  declaracoesDe(nome: string): Simbolo[] {
    return (this.porNome.get(nome.toLowerCase()) ?? []).map(i => this.simbolos[i]);
  }
}
