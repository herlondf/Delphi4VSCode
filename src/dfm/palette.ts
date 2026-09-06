/**
 * A paleta de componentes.
 *
 * Não é uma lista escrita à mão: sai do índice de classes e da frequência com que cada uma
 * aparece nos `.dfm` do projeto. Num projeto DevExpress, `TcxButton` aparece muito mais que
 * `TButton`, e uma paleta fixa com os tipos da VCL ofereceria justamente o que ninguém usa.
 *
 * Criar um componente exige três coisas juntas, ou o resultado não compila: o bloco no
 * `.dfm`, a unit no `uses` do `.pas`, e — sob um `TdxLayoutControl` — o `TdxLayoutItem` que
 * o posiciona.
 */

import { Kind, Registry } from './registry';

export interface ItemPaleta {
  cls: string;
  kind: Kind;
  /** Unit onde a classe é declarada, para registrar no uses. */
  unit?: string;
  /** Quantas vezes aparece nos .dfm do projeto. */
  uso: number;
  visual: boolean;
}

/** Tamanho e propriedades com que cada tipo nasce, por família. */
const PADRAO: Partial<Record<Kind, { w: number; h: number; props: [string, string][] }>> = {
  btn: { w: 75, h: 25, props: [['Caption', "'Button'"]] },
  lbl: { w: 60, h: 15, props: [['Caption', "'Label'"]] },
  edit: { w: 121, h: 21, props: [] },
  chk: { w: 97, h: 17, props: [['Caption', "'CheckBox'"]] },
  panel: { w: 185, h: 41, props: [['Caption', "'Panel'"]] },
  grid: { w: 320, h: 200, props: [] },
  image: { w: 105, h: 105, props: [] },
  bevel: { w: 50, h: 50, props: [] },
  splitter: { w: 3, h: 100, props: [] },
  shape: { w: 65, h: 65, props: [] },
  spin: { w: 42, h: 21, props: [] },
  progress: { w: 150, h: 17, props: [] },
  web: { w: 300, h: 200, props: [] },
  tab: { w: 0, h: 0, props: [] },
  form: { w: 0, h: 0, props: [] },
  misc: { w: 0, h: 0, props: [] },
};

/**
 * P07 — quando a família erra, o nome da classe acerta.
 *
 * `TMemo` e `TEdit` são os dois `edit` na taxonomia, mas nascem com alturas muito
 * diferentes no Delphi. Estas exceções são por sufixo de nome, para pegarem também as
 * versões de terceiros: `TcxMemo`, `TDBMemo`, `TdxMemo`.
 */
const POR_NOME: [RegExp, { w: number; h: number; props: [string, string][] }][] = [
  [/memo$/i, { w: 185, h: 89, props: [] }],
  [/richedit$/i, { w: 185, h: 89, props: [] }],
  [/listbox$/i, { w: 121, h: 97, props: [] }],
  [/listview$/i, { w: 250, h: 150, props: [] }],
  [/treeview$/i, { w: 200, h: 200, props: [] }],
  [/combobox$/i, { w: 145, h: 21, props: [] }],
  [/checklistbox$/i, { w: 121, h: 97, props: [] }],
  [/radiogroup$/i, { w: 185, h: 105, props: [['Caption', "'RadioGroup'"]] }],
  [/groupbox$/i, { w: 185, h: 105, props: [['Caption', "'GroupBox'"]] }],
  [/scrollbox$/i, { w: 200, h: 150, props: [] }],
  [/statusbar$/i, { w: 0, h: 19, props: [['Align', 'alBottom']] }],
  [/toolbar$/i, { w: 0, h: 29, props: [['Align', 'alTop']] }],
  [/pagecontrol$/i, { w: 289, h: 193, props: [] }],
  [/datetimepicker$|dateedit$/i, { w: 121, h: 21, props: [] }],
  [/calendar$/i, { w: 190, h: 160, props: [] }],
  [/chart$/i, { w: 320, h: 240, props: [] }],
];

export function padraoDe(kind: Kind, cls?: string):
    { w: number; h: number; props: [string, string][] } {
  if (cls) {
    const hit = POR_NOME.find(([re]) => re.test(cls));
    if (hit) { return hit[1]; }
  }
  return PADRAO[kind] ?? { w: 100, h: 25, props: [] };
}

export function montarPaleta(
  reg: Registry, contagem: Map<string, number>, limite = 60,
): ItemPaleta[] {
  return todaPaleta(reg, contagem).filter(i => i.uso > 0).slice(0, limite);
}

/**
 * A paleta inteira: tudo que dá para pôr num form, e não só o que o projeto já usa.
 *
 * A versão anterior partia da contagem de uso nos `.dfm` — ótima para pôr na frente o que o
 * time realmente usa, e inútil para achar um componente que ninguém usou ainda. Agora a
 * lista sai do índice de classes: descende de `TComponent` e não é peça interna de outro
 * componente. O uso continua ordenando, mas deixou de filtrar.
 */
export function todaPaleta(reg: Registry, contagem: Map<string, number>): ItemPaleta[] {
  const itens: ItemPaleta[] = [];
  for (const chave of reg.classes()) {
    const cls = reg.nomeDeclarado(chave) ?? chave;
    if (!PODE_INSTANCIAR.test(cls) || BASE.test(cls)) { continue; }
    const cadeia = reg.chain(chave);
    if (INTERNO.test(cls)) { continue; }

    const [kind, origem] = reg.kindSource(cls);
    if (kind === 'form') { continue; }
    /*
     * Exigir que a cadeia chegue a `TComponent` deixava de fora todo componente cuja
     * herança o índice não fecha — e é exatamente o de terceiros, que é o que se procura na
     * paleta. Vale também o palpite de família: se o índice sabe dizer que aquilo é um botão
     * ou uma grade, é componente, ainda que o ancestral final não tenha sido achado.
     */
    const ehComponente = cadeia.includes('tcomponent')
      || origem === 'heranca' || origem === 'propriedades';
    if (!ehComponente) { continue; }
    const visual = cadeia.some(c => VISUAIS.has(c))
      || (origem === 'heranca' && kind !== 'misc');
    itens.push({
      cls, kind, visual,
      uso: contagem.get(cls) ?? 0,
      unit: reg.unitPascalDe(cls),
    });
  }
  // primeiro o que o projeto usa, e dentro de cada grupo em ordem alfabética
  itens.sort((a, b) => b.uso - a.uso || a.cls.localeCompare(b.cls));
  return itens;
}

/*
 * Só nomes de classe Delphi, e nenhuma base.
 *
 * `TCustom*` e `TAbstract*` são as bases que o Delphi nunca registra na paleta: existem para
 * ser herdadas, várias são abstratas, e criar uma num form dá erro em runtime. É convenção
 * firme o bastante da VCL e de todo componente comercial para valer como regra.
 */
const PODE_INSTANCIAR = /^t\w/i;
const BASE = /^t(custom|abstract|base)[a-z0-9_]/i;
const VISUAIS = new Set(['tcontrol', 'twincontrol', 'tgraphiccontrol']);

/*
 * Peça interna de outro componente não se cria solta: uma coluna vive na coleção do grid, um
 * item de layout é criado pelo layout control, um campo pertence ao dataset. Oferecê-los na
 * paleta produz `.dfm` que não carrega.
 */
const INTERNO =
  /layoutitem|layoutgroup|layoutautocreated|gridcolumn|griddbcolumn|field$|tabsheet|barbutton|menuitem$|^tcx.*row$|column$|item$|node$|link$|style$|persistent$|collection$/i;

/** Nome da unit a partir do caminho do .pas: `C:\...\cxButtons.pas` -> `cxButtons`. */
export function unitDe(caminho: string | undefined): string | undefined {
  if (!caminho) { return undefined; }
  const arquivo = caminho.split(/[\\/]/).pop();
  return arquivo ? arquivo.replace(/\.pas$/i, '') : undefined;
}

export interface EdicaoUses {
  linha: number;
  kind: 'insert' | 'replace';
  /** Pode conter várias linhas: inserções na mesma posição precisam ir juntas, ou a
   *  ordem entre elas se inverte na aplicação. */
  texto: string;
}

/**
 * P03 — acrescenta a unit no `uses` da interface, se ainda não estiver lá.
 *
 * Criar um `TcxButton` sem pôr `cxButtons` no uses gera um form que não compila. Como o
 * índice sabe em que unit cada classe mora, dá para fazer isso na hora.
 */
export function garantirUses(texto: string, unit: string): EdicaoUses[] {
  const linhas = texto.split(/\r?\n/);
  const alvo = unit.toLowerCase();

  let inicio = -1;
  let fim = -1;
  let emInterface = false;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].replace(/\/\/.*$/, '').trim();
    if (/^interface\b/i.test(l)) { emInterface = true; continue; }
    if (/^implementation\b/i.test(l)) { break; }
    if (!emInterface) { continue; }
    if (inicio < 0 && /^uses\b/i.test(l)) { inicio = i; }
    if (inicio >= 0) {
      // já está declarada? nada a fazer
      for (const m of l.matchAll(/([A-Za-z_][\w.]*)/g)) {
        if (m[1].toLowerCase() === alvo) { return []; }
      }
      if (l.includes(';')) { fim = i; break; }
    }
  }

  if (inicio < 0) {
    // sem cláusula uses na interface: cria uma logo depois de `interface`
    const iInterface = linhas.findIndex(l => /^\s*interface\s*$/i.test(l));
    if (iInterface < 0) { throw new Error('não achei a seção interface desta unit'); }
    return [{ linha: iInterface + 1, kind: 'insert',
              texto: ['', 'uses', '  ' + unit + ';'].join(String.fromCharCode(10)) }];
  }
  if (fim < 0) { fim = inicio; }

  const ultima = linhas[fim];
  const semPontoVirgula = ultima.replace(/;\s*$/, '');
  // mantém o estilo do arquivo: uma unit por linha ou lista corrida
  const umaPorLinha = fim > inicio && /^\s+\S+\s*[,;]/.test(linhas[fim]);
  if (umaPorLinha) {
    const recuo = ultima.slice(0, ultima.length - ultima.trimStart().length);
    return [
      { linha: fim, kind: 'replace', texto: `${semPontoVirgula},` },
      { linha: fim + 1, kind: 'insert', texto: `${recuo}${unit};` },
    ];
  }
  return [{ linha: fim, kind: 'replace', texto: `${semPontoVirgula}, ${unit};` }];
}
