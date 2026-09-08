/**
 * Auditoria de código pelo `AuditsCLI.exe` da instalação.
 *
 * Três coisas a saber antes de usar, todas medidas:
 *
 *  - o binário existe só a partir do RAD Studio 11 (`22.0`). Numa máquina com várias
 *    instalações ele pode não estar na versão que compila o projeto, então é procurado em
 *    todas;
 *  - ele analisa PROJETO INTEIRO, não arquivo. Não há modo por unit, e é daí que vem o
 *    tempo: num projeto de 874 units passa de 15 minutos. Por isso é comando sob demanda,
 *    com progresso e cancelamento, e não diagnóstico ao vivo;
 *  - a saída é XML com um `<audit>` por achado, e `url` é o nome do arquivo RELATIVO ao
 *    `<project path>`.
 */

export interface Achado {
  id: string;
  mensagem: string;
  /** 0 Info, 1 Warning, 2 Error, 3 Fatal — a tabela vem no próprio XML. */
  severidade: number;
  arquivo: string;
  linha: number;
  /** Locais relacionados: o "passa null aqui" e o "desreferencia aqui" do mesmo achado. */
  relacionados: Achado[];
}

const RE_PROJETO = /<project\s+path="([^"]*)"/;
const RE_AUDIT = /<audit\s([^>]*?)(\/)?>/g;

function atributo(bruto: string, nome: string): string {
  const m = new RegExp(`${nome}="([^"]*)"`).exec(bruto);
  return m ? desescapar(m[1]) : '';
}

function desescapar(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** A pasta a que os `url` dos achados são relativos. */
export function raizDoProjeto(xml: string): string {
  const m = RE_PROJETO.exec(xml);
  return m ? m[1] : '';
}

/**
 * Lê os achados preservando o aninhamento.
 *
 * O XML aninha `<audit>` dentro de `<audit>` quando um achado tem mais de um lugar — o
 * `MANR`, por exemplo, aponta onde o null entra e onde ele é desreferenciado. Jogar todos no
 * mesmo nível dobraria o número de avisos e perderia a relação entre eles.
 */
export function lerAchados(xml: string): Achado[] {
  const raiz: Achado[] = [];
  const pilha: Achado[] = [];
  RE_AUDIT.lastIndex = 0;
  let m: RegExpExecArray | null;
  let pos = 0;
  while ((m = RE_AUDIT.exec(xml))) {
    // fecha os que terminaram entre o achado anterior e este
    const entre = xml.slice(pos, m.index);
    for (let i = 0; i < (entre.match(/<\/audit>/g) || []).length; i++) { pilha.pop(); }
    pos = RE_AUDIT.lastIndex;

    const a: Achado = {
      id: atributo(m[1], 'audit-id'),
      mensagem: atributo(m[1], 'message'),
      severidade: Number(atributo(m[1], 'severity')) || 0,
      arquivo: atributo(m[1], 'url'),
      linha: Number(atributo(m[1], 'line')) || 1,
      relacionados: [],
    };
    const dono = pilha[pilha.length - 1];
    if (dono) { dono.relacionados.push(a); } else { raiz.push(a); }
    if (!m[2]) { pilha.push(a); }
  }
  return raiz;
}

/** Argumentos do AuditsCLI: XML dos audits deste projeto, na saída indicada. */
export function argumentosAudits(dproj: string, saida: string, config?: string): string[] {
  const args = ['--audits', '--xml', '-o', saida];
  if (config) { args.push(`--build-config=${config}`); }
  args.push(dproj);
  return args;
}
