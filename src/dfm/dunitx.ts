/**
 * DUnitX: descobrir os testes no código e ler o resultado da execução.
 *
 * O runner do DUnitX é um `.exe` de console que já sai da compilação normal — não há nada a
 * inventar sobre como rodar. O que faltava era o VS Code saber quais testes existem antes de
 * rodar (para listar na aba de testes) e entender o que voltou (para pintar de verde e
 * vermelho e levar ao ponto da falha).
 *
 * A descoberta é por atributo no fonte, e não por executar o binário com `--list`: assim a
 * lista aparece sem compilar nada, que é o estado em que se abre o projeto.
 */

/** Um `[Test]` dentro de um `[TestFixture]`. */
export interface TesteDescoberto {
  fixture: string;
  nome: string;
  arquivo: string;
  linha: number;
  /** `[TestCase('nome', 'a,b')]` gera um caso por linha do atributo. */
  casos: string[];
}

const ATTR = /^\s*\[\s*([A-Za-z]\w*)\s*(?:\(([^)]*)\))?\s*\]/;
const CLASSE = /^\s*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*=\s*class\b/i;
const METODO = /^\s*(?:class\s+)?(?:procedure|function)\s+([A-Za-z_]\w*)/i;
const SECAO = /^\s*(private|protected|public|published|strict\s+private|strict\s+protected)\b/i;
const REGISTRO = new RegExp('TDUnitX\\.RegisterTestFixture\\s*\\(\\s*([A-Za-z_]\\w*)', 'gi');

/** Atributos que marcam um método como preparação, não como teste. */
const NAO_E_TESTE = new Set([
  'setup', 'teardown', 'setupfixture', 'teardownfixture', 'ignore',
]);

/**
 * Acha os testes de um `.pas`.
 *
 * Dois estilos convivem no DUnitX, e o projeto do projeto de teste usa o segundo:
 *
 *  - explícito: `[Test]` (e `[TestCase(...)]`) antes de cada método;
 *  - implícito: só `[TestFixture]` na classe, e **todo método `published` é teste**.
 *
 * Cobrir só o explícito achava zero testes num projeto com 618 deles. `[Setup]`,
 * `[TearDown]` e companhia continuam de fora nos dois casos — são preparação.
 *
 * Atributo em Delphi vale para a PRÓXIMA declaração, e pode haver vários empilhados
 * (`[Test]` mais três `[TestCase]`). Por isso os pendentes se acumulam até a declaração
 * aparecer, em vez de valerem só para a linha seguinte.
 */
export function descobrirTestes(src: string, arquivo: string): TesteDescoberto[] {
  const linhas = src.split(/\r?\n/);
  /*
   * O sinal mais confiável de que uma classe é fixture não é o atributo — é a chamada de
   * registro. Um teste real do projeto marca a classe com `[TestCase]` em vez de
   * `[TestFixture]`, e o runner o executa mesmo assim, porque quem manda é esta linha.
   */
  const registradas = new Set<string>();
  REGISTRO.lastIndex = 0;
  for (const m of src.matchAll(REGISTRO)) { registradas.add(m[1].toLowerCase()); }
  const out: TesteDescoberto[] = [];
  let fixture = '';
  let ehFixture = false;
  let publicada = false;
  let pendentes: { nome: string; args: string }[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].replace(/\/\/.*$/, '');
    if (!l.trim()) { continue; }

    const a = ATTR.exec(l);
    if (a) {
      const nome = a[1].toLowerCase();
      if (nome === 'testfixture') { ehFixture = true; }
      else { pendentes.push({ nome, args: a[2] ?? '' }); }
      continue;
    }

    const c = CLASSE.exec(l);
    if (c) {
      fixture = (ehFixture || registradas.has(c[1].toLowerCase())) ? c[1] : '';
      ehFixture = false;
      // classe de teste sem especificador nenhum: o padrao do Delphi ali e published
      publicada = true;
      pendentes = [];
      continue;
    }
    const sec = SECAO.exec(l);
    if (sec) { publicada = /published|public/i.test(sec[1]); pendentes = []; continue; }
    if (/^\s*end\s*;/i.test(l)) { fixture = ''; pendentes = []; continue; }

    const m = METODO.exec(l);
    if (m) {
      const marcado = pendentes.some(p => p.nome === 'test' || p.nome === 'testcase');
      const preparacao = pendentes.some(p => NAO_E_TESTE.has(p.nome));
      const ehTeste = marcado || (publicada && !preparacao && !pendentes.length);
      if (fixture && ehTeste) {
        const casos = pendentes.filter(p => p.nome === 'testcase')
          .map(p => primeiroLiteral(p.args))
          .filter((s): s is string => !!s);
        out.push({ fixture, nome: m[1], arquivo, linha: i, casos });
      }
      pendentes = [];
    }
  }
  return out;
}

/** O nome do caso é o primeiro literal do `[TestCase('nome', 'args')]`. */
function primeiroLiteral(args: string): string | undefined {
  const m = /'([^']*)'/.exec(args);
  return m ? m[1] : undefined;
}

export interface ResultadoTeste {
  fixture: string;
  nome: string;
  passou: boolean;
  executado: boolean;
  /** Segundos, como o DUnitX reporta. */
  tempo: number;
  mensagem?: string;
}

const SUITE = /<test-suite\b([^>]*)>/gi;
const CASO = /<test-case\b([^>]*?)(\/>|>([\s\S]*?)<\/test-case>)/gi;
const ATRIB = /([\w-]+)="([^"]*)"/g;

function atributos(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATRIB.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATRIB.exec(s))) { out[m[1].toLowerCase()] = m[2]; }
  return out;
}

/**
 * Lê o `dunitx-results.xml` que o logger NUnit do DUnitX escreve.
 *
 * Não é um parser de XML — é varredura por marca, e é o bastante: o arquivo é gerado sempre
 * pelo mesmo código, não por um humano. Trazer uma dependência de XML para ler um formato de
 * uma fonte só custaria mais do que resolve.
 */
export function lerResultados(xml: string): ResultadoTeste[] {
  /*
   * O nome do fixture é o `test-suite type="Fixture"` mais próximo ANTES do caso. Varrer
   * suites e casos em passadas separadas perderia essa relação, então as duas posições são
   * casadas por deslocamento no texto.
   */
  const fixtures: { pos: number; nome: string }[] = [];
  SUITE.lastIndex = 0;
  let s: RegExpExecArray | null;
  while ((s = SUITE.exec(xml))) {
    const at = atributos(s[1]);
    if ((at.type ?? '').toLowerCase() === 'fixture') {
      fixtures.push({ pos: s.index, nome: at.name ?? '' });
    }
  }

  const out: ResultadoTeste[] = [];
  CASO.lastIndex = 0;
  let c: RegExpExecArray | null;
  while ((c = CASO.exec(xml))) {
    const at = atributos(c[1]);
    let fixture = '';
    for (const f of fixtures) {
      if (f.pos < c.index) { fixture = f.nome; } else { break; }
    }
    const corpo = c[3] ?? '';
    const msg = /<message>([\s\S]*?)<\/message>/i.exec(corpo);
    out.push({
      fixture,
      nome: at.name ?? '',
      passou: (at.success ?? '').toLowerCase() === 'true',
      executado: (at.executed ?? '').toLowerCase() === 'true',
      tempo: parseFloat(at.time ?? '0') || 0,
      mensagem: msg ? desescapar(msg[1].trim()) : undefined,
    });
  }
  return out;
}

function desescapar(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Resumo de uma execução, para a barra de status e o canal. */
export function resumo(r: ResultadoTeste[]): string {
  const passaram = r.filter(x => x.passou).length;
  const falharam = r.filter(x => x.executado && !x.passou).length;
  const pulados = r.filter(x => !x.executado).length;
  const tempo = r.reduce((a, x) => a + x.tempo, 0);
  return `${passaram} passaram, ${falharam} falharam` +
    (pulados ? `, ${pulados} não executados` : '') +
    ` em ${tempo.toFixed(2)}s`;
}
