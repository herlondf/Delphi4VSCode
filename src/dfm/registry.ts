/**
 * Índice de herança das classes, extraído dos `.pas`.
 *
 * É o que separa "TcxGrid é um grid" de "TcxGrid é uma caixa cinza": sem a cadeia real de
 * ancestrais, componentes de terceiros viram todos a mesma coisa.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DfmNode } from './model';
import { inferirKind } from './inferir';

/**
 * `[,)]` no fim porque `TcxCustomGrid = class(TcxControl,` quebra a linha na lista de
 * interfaces — sem isso a herança do DevExpress inteiro se perde. Forward (`= class;`) não casa.
 */
const CLASS_DECL = /^[ \t]{0,8}(T\w+)\s*=\s*class\s*\(\s*(T\w+)\s*[,)]/gim;

/* C04 — corpo da classe e declarações dentro dele. */
const CLASSE_CORPO = /^\s*(T\w+)(<[^>]*>)?\s*=\s*class\b/i;   // aceita genérica: TFoo<T> = class
const PROP_DECL = /^\s*(?:published\s+)?property\s+([A-Za-z_]\w*)/i;
const CAMPO_DECL = /^\s*([A-Za-z_]\w*)\s*:\s*[A-Za-z_]/;
const SEPARADOR = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10));
const FIM_CLASSE = /^\s*end\s*;/;
const SECAO = /^\s*(published|public|private|protected|strict\s+\w+)\s*$/i;
/* A05 — tipo declarado numa propriedade, e a declaração de uma enumeração na unit. */
const TIPO_DA_PROP = /^\s*(?:published\s+)?property\s+[A-Za-z_]\w*\s*:\s*([A-Za-z_][\w.]*)/i;
const ENUM_DECL = /^[ \t]{0,8}(T\w+)\s*=\s*\(([^)]{3,600})\)\s*;/gim;
const COMENTARIO = /^\s*(\/\/|\{|\(\*)/;
const SEM_CORPO = /=\s*class\s*(\(\s*\))?\s*;|=\s*class\s+of\b/i;   // forward e class of
const ABRE_BLOCO = /^\s*\w+(<[^>]*>)?\s*=\s*(packed\s+)?(record|interface|object)\b|^\s*case\b.*\bof\s*$/i;

export type Kind =
  | 'form' | 'panel' | 'tab' | 'btn' | 'edit' | 'lbl' | 'grid' | 'chk'
  | 'image' | 'bevel' | 'splitter' | 'shape' | 'spin' | 'progress' | 'web' | 'misc';

/** Ancestral conhecido -> como desenhar. Classes de terceiros chegam aqui subindo a herança. */
const BASE_KIND = new Map<string, Kind>(Object.entries({
  tcustombutton: 'btn', tbutton: 'btn', tbitbtn: 'btn', tspeedbutton: 'btn',
  tcustomedit: 'edit', tcustommemo: 'edit', tcustomcombobox: 'edit',
  tcustommaskedit: 'edit', tcustomlistbox: 'edit',
  tcustomlabel: 'lbl', tcustomstatictext: 'lbl',
  tcustomcheckbox: 'chk', tcheckbox: 'chk', tradiobutton: 'chk',
  tcustomgrid: 'grid', tcustomdbgrid: 'grid', tcustomlistview: 'grid',
  tcustomtreeview: 'grid', tcxcustomverticalgrid: 'grid',
  tcustompanel: 'panel', tcustomgroupbox: 'panel', tcustomradiogroup: 'panel',
  tcustomscrollbox: 'panel', tcustomframe: 'panel', tcustomtabcontrol: 'panel',
  ttabsheet: 'tab', tcustompage: 'tab', tcxtabsheet: 'tab',
  tcustomform: 'form',
  // raízes DevExpress: não herdam dos equivalentes VCL, reimplementam a partir de TcxControl
  tcxcustomgrid: 'grid', tcxcustombutton: 'btn', tcxcustomlabel: 'lbl',
  tcxcustomedit: 'edit', tdxcustomlayoutcontrol: 'panel',
  // gráficos: todos descendem de TGraphicControl, só o nome concreto os separa
  tcustomimage: 'image', timage: 'image', tcximage: 'image', tdbimage: 'image',
  tbevel: 'bevel', tdxcustombevel: 'bevel',
  tsplitter: 'splitter', tcxcustomsplitter: 'splitter',
  tshape: 'shape', tcustomupdown: 'spin',
  tcustomprogressbar: 'progress', tcxprogressbar: 'progress',
  twebbrowser: 'web', tchromium: 'web',
}) as [string, Kind][]);

/** Só vale se nada específico nem o nome casar: toda árvore cx/dx passa por TWinControl. */
const GENERIC_KIND = new Map<string, Kind>([
  ['twincontrol', 'panel'], ['tcustomcontrol', 'panel'],
  ['tgraphiccontrol', 'misc'], ['tcontrol', 'misc'],
]);

/** Rede de segurança para classe fora do índice. A ordem importa: `combo` antes de `box`. */
const SUBSTR_KIND: [string, Kind][] = [
  ['grid', 'grid'], ['tree', 'grid'], ['listview', 'grid'],
  ['splitter', 'splitter'], ['bevel', 'bevel'], ['progress', 'progress'],
  ['image', 'image'], ['shape', 'shape'], ['browser', 'web'], ['chromium', 'web'],
  ['combo', 'edit'], ['memo', 'edit'], ['spin', 'spin'], ['updown', 'spin'],
  ['date', 'edit'], ['edit', 'edit'],
  ['check', 'chk'], ['radiobutton', 'chk'],
  ['button', 'btn'], ['btn', 'btn'], ['label', 'lbl'], ['tabsheet', 'tab'],
  ['panel', 'panel'], ['group', 'panel'], ['page', 'panel'], ['tab', 'panel'],
  ['bar', 'panel'], ['frame', 'panel'], ['box', 'panel'],
];

const VISUAL_ROOTS = new Set([
  'tcontrol', 'twincontrol', 'tgraphiccontrol', 'tcustomform', 'tcustomframe',
]);
const NONVISUAL_ROOTS = new Set([
  'tcomponent', 'tpersistent', 'tobject', 'tdataset', 'tcollection',
]);
const VISUAL_KINDS = new Set<Kind>([
  'btn', 'edit', 'lbl', 'grid', 'panel', 'chk', 'tab',
  'image', 'bevel', 'splitter', 'shape', 'spin', 'progress', 'web',
]);

export type KindSource = 'heranca' | 'propriedades' | 'nome' | 'generico' | 'nenhum';

/** VCL vence FMX quando as duas declaram a mesma classe — um .dfm é sempre VCL. */
function unitRank(fileName: string): number {
  const low = fileName.toLowerCase();
  if (low.startsWith('vcl.')) { return 3; }
  if (low.startsWith('fmx.')) { return 1; }
  return 2;
}

const SKIP_DIRS = new Set(['__history', '__recovery', 'node_modules', '.git']);

export class Registry {
  private parents = new Map<string, string>();
  private units = new Map<string, string>();
  private ranks = new Map<string, number>();
  private names = new Map<string, string>();
  private propsPorClasse = new Map<string, Set<string>>();
  /*
   * Só as `published`, separadas do resto.
   *
   * O conjunto amplo (`propsPorClasse`) serve ao diagnóstico: ele precisa perdoar, e uma
   * propriedade a mais só evita um aviso errado. A inferência de família precisa do
   * contrário — um `TForm` com as 645 propriedades de todas as seções casa com qualquer
   * regra e classifica formulário como botão. No `.dfm` só entra o que é published, e é
   * isso que descreve o componente.
   */
  private publicadasPorClasse = new Map<string, Set<string>>();
  /** A05 — `classe.propriedade` -> valores da enumeração, quando o tipo é uma. */
  private enums = new Map<string, string[]>();
  /*
   * Nome da unit Pascal, quando ele vem do RTTI de um pacote.
   *
   * `units` guarda o ARQUIVO de origem, e para uma classe lida de `.bpl` esse arquivo é o
   * próprio pacote. Pôr `ComponentesUI_RT.bpl` no `uses` de um `.pas` não compila; o que
   * serve é `UI.Button`, que o RTTI traz junto.
   */
  private unitPascal = new Map<string, string>();
  /** Nome do tipo de cada propriedade publicada, para resolver as enumerações depois. */
  private tipoDaProp = new Map<string, string>();
  /** Declarações de enumeração vistas nas fontes: `talign` -> ['alNone', 'alTop', ...]. */
  private enumsDeclarados = new Map<string, string[]>();
  private chainCache = new Map<string, string[]>();

  get size(): number { return this.parents.size; }

  /** Varre pastas de `.pas` e registra `filha -> ancestral`. Não seguem links nem histórico. */
  scan(roots: string[], budgetMs = 20000): void {
    const deadline = Date.now() + budgetMs;
    for (const root of roots) {
      this.scanDir(root, deadline);
    }
    this.chainCache.clear();
  }

  private scanDir(dir: string, deadline: number): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (Date.now() > deadline) { return; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase())) {
          this.scanDir(full, deadline);
        }
      } else if (e.name.toLowerCase().endsWith('.pas')) {
        this.scanFile(full, e.name);
      }
    }
  }

  private scanFile(full: string, name: string): void {
    let src: string;
    try {
      src = fs.readFileSync(full, 'latin1');
    } catch {
      return;
    }
    const rank = unitRank(name);
    CLASS_DECL.lastIndex = 0;
    for (const m of src.matchAll(CLASS_DECL)) {
      const child = m[1].toLowerCase();
      if (rank <= (this.ranks.get(child) ?? 0)) { continue; }
      this.ranks.set(child, rank);
      this.parents.set(child, m[2].toLowerCase());
      this.units.set(child, full);
      this.names.set(child, m[1]);
    }
    this.scanProps(src);
  }

  /*
   * C04 — nomes de propriedade por classe.
   *
   * O corpo de uma classe pode abrir com outra classe dentro: `TComponent` começa com
   * `TComponentAsyncResult = class(...)`, e um scan sem pilha atribuía as propriedades à
   * aninhada e perdia todo o resto — inclusive `Tag`, que aparece em quase todo form.
   *
   * `record`, `interface` e `case ... of` também fecham com `end;`, então entram na pilha
   * como marcador. Ainda assim é contagem de palavra-chave, não um parser: por isso o
   * consumidor só confia no índice quando toda a cadeia tem propriedades (`indiceConfiavel`).
   */
  private scanProps(src: string): void {
    const pilha: ({ todas: Set<string>; pub: Set<string>; classe: string } | null)[] = [];
    // enumerações declaradas na unit, para casar com o tipo das propriedades
    for (const m of src.matchAll(ENUM_DECL)) {
      const valores = m[2].split(',').map(v => v.trim()).filter(v => /^[A-Za-z_]\w*$/.test(v));
      if (valores.length > 1) { this.enumsDeclarados.set(m[1].toLowerCase(), valores); }
    }
    const publicada: boolean[] = [];
    for (const linha of src.split(SEPARADOR)) {
      if (COMENTARIO.test(linha)) { continue; }
      if (FIM_CLASSE.test(linha)) { pilha.pop(); publicada.pop(); continue; }
      const c = CLASSE_CORPO.exec(linha);
      if (c) {
        if (SEM_CORPO.test(linha)) { continue; }   // forward: `TFoo = class;`
        const chave = c[1].toLowerCase();
        const todas = this.propsPorClasse.get(chave) ?? new Set<string>();
        const pub = this.publicadasPorClasse.get(chave) ?? new Set<string>();
        this.propsPorClasse.set(chave, todas);
        this.publicadasPorClasse.set(chave, pub);
        pilha.push({ todas, pub, classe: chave });
        publicada.push(false);
        continue;
      }
      if (ABRE_BLOCO.test(linha)) { pilha.push(null); publicada.push(false); continue; }
      const topo = pilha.length - 1;
      const atual = pilha[topo];
      if (!atual) { continue; }
      const sec = SECAO.exec(linha);
      if (sec) { publicada[topo] = /published/i.test(sec[1]); continue; }
      const p = PROP_DECL.exec(linha);
      if (p) {
        atual.todas.add(p[1].toLowerCase());
        if (publicada[topo]) { atual.pub.add(p[1].toLowerCase()); }
        /*
         * O tipo é guardado venha de que seção vier, e não só de `published`.
         *
         * A VCL declara `property Align: TAlign` em `TControl`, numa seção protegida, e os
         * descendentes apenas republicam com `property Align;` — sem repetir o tipo. Exigir
         * o tipo na linha publicada deixava toda a VCL sem enumeração nenhuma.
         */
        const tipo = TIPO_DA_PROP.exec(linha);
        if (tipo && atual.classe) {
          this.tipoDaProp.set(`${atual.classe}.${p[1].toLowerCase()}`, tipo[1].toLowerCase());
        }
        continue;
      }
      const f = CAMPO_DECL.exec(linha);
      if (f) { atual.todas.add(f[1].toLowerCase()); }
    }
  }

  /**
   * A05 — valores possíveis de uma propriedade, subindo a herança.
   *
   * Vem de duas fontes: a declaração da enumeração no `.pas`, casada pelo tipo da
   * propriedade, e o RTTI do `.bpl`. Sem isso o inspetor só oferece os valores de uma tabela
   * escrita à mão, que não conhece nem os tipos do projeto nem os de terceiros.
   */
  valoresDe(cls: string, prop: string): string[] | undefined {
    const alvo = prop.toLowerCase();
    for (const c of this.chain(cls)) {
      const direto = this.enums.get(`${c}.${alvo}`);
      if (direto) { return direto; }
      const tipo = this.tipoDaProp.get(`${c}.${alvo}`);
      const decl = tipo ? this.enumsDeclarados.get(tipo) : undefined;
      if (decl) { return decl; }
    }
    return undefined;
  }

  /** A01 — só as publicadas, que são as que descrevem o componente e vão para o .dfm. */
  publicadasDe(cls: string): Set<string> {
    const out = new Set<string>();
    for (const c of this.chain(cls)) {
      for (const p of this.publicadasPorClasse.get(c) ?? []) { out.add(p); }
    }
    return out;
  }

  /**
   * Dá para cobrar propriedade desta classe?
   *
   * Três condições, e todas ganharam sua razão de ser medindo em cima dos 1.111 `.dfm` do
   * projeto de referência:
   *
   *  - a cadeia precisa alcançar `TComponent`, senão faltam ancestrais no índice;
   *  - `TComponent` precisa conhecer `Name` e `Tag`. É o canário: as duas estão declaradas
   *    lá desde sempre, e se sumiram é o scan que quebrou, não o form;
   *  - toda classe entre a folha e `TComponent` precisa ter propriedades. Conjunto vazio no
   *    meio da cadeia é declaração que o scan não entendeu — e cobrar em cima de índice
   *    furado é o aviso errado que ninguém deveria ler.
   *
   * `TPersistent` e `TObject` ficam de fora da exigência: elas são legitimamente vazias.
   */
  indiceConfiavel(cls: string): boolean {
    if (!this.canario()) { return false; }
    const chain = this.chain(cls);
    const ate = chain.indexOf('tcomponent');
    if (ate < 0) { return false; }
    for (let i = 0; i <= ate; i++) {
      if (!(this.propsPorClasse.get(chain[i])?.size)) { return false; }
    }
    return true;
  }

  private canario(): boolean {
    const base = this.propsPorClasse.get('tcomponent');
    return !!base && base.has('name') && base.has('tag');
  }

  /** Todas as propriedades publicadas da classe e dos ancestrais, em minúsculas. */
  propriedadesDe(cls: string): Set<string> {
    const out = new Set<string>();
    for (const c of this.chain(cls)) {
      for (const p of this.propsPorClasse.get(c) ?? []) { out.add(p); }
    }
    return out;
  }

  /** A classe declara (ou herda) uma propriedade com este nome? */
  conheceProp(cls: string, nome: string): boolean {
    const alvo = nome.toLowerCase();
    for (const c of this.chain(cls)) {
      if (this.propsPorClasse.get(c)?.has(alvo)) { return true; }
    }
    return false;
  }



  /**
   * C06 — relê um único .pas depois de uma gravação.
   *
   * A cadeia de herança é derivada, e o cache dela guarda o resultado antigo: sem limpá-lo,
   * uma classe que passou a herdar de outra continuaria desenhada como antes até a próxima
   * reindexação completa.
   */
  rescanFile(full: string): void {
    if (!/\.pas$/i.test(full)) { return; }
    this.scanFile(full, path.basename(full));
    this.chainCache.clear();
  }

  /**
   * A04 — completa o índice com o que veio de `.bpl`, sem sobrescrever o que veio de fonte.
   *
   * O fonte é a verdade: tem a cadeia inteira, o nome como foi declarado e as propriedades
   * na ordem do arquivo. O binário entra só onde não há fonte — componente comercial
   * distribuído sem `.pas`. A mesma regra de ranque vale aqui: um `TButton` do FMX não pode
   * roubar o lugar do da VCL, porque um `.dfm` é sempre VCL.
   */
  absorverBpl(classes: { nome: string; ancestral?: string; unidade: string;
                         props: string[]; enums?: Record<string, string[]>;
                         arquivo: string }[]): number {
    let novas = 0;
    for (const c of classes) {
      const chave = c.nome.toLowerCase();
      const rank = unitRank(c.unidade) - 1;   // binário vale menos que fonte da mesma unit
      if (rank <= (this.ranks.get(chave) ?? 0)) { continue; }
      this.ranks.set(chave, rank);
      /*
       * Sem ancestral a classe entra assim mesmo. Ela costuma ser a raiz do pacote — e é
       * dela que os descendentes herdam as propriedades publicadas. Descartá-la deixava a
       * cadeia terminando num nome que o índice não conhece, e a inferência sem nada para
       * olhar.
       */
      if (c.ancestral) { this.parents.set(chave, c.ancestral.toLowerCase()); }
      this.names.set(chave, c.nome);
      this.units.set(chave, c.arquivo);
      if (c.unidade) { this.unitPascal.set(chave, c.unidade); }
      for (const [prop, valores] of Object.entries(c.enums ?? {})) {
        this.enums.set(`${chave}.${prop.toLowerCase()}`, valores as string[]);
      }
      if (c.props.length) {
        // o RTTI de um .bpl só expõe published: serve aos dois conjuntos
        const conjunto = new Set(c.props.map(p => p.toLowerCase()));
        this.propsPorClasse.set(chave, conjunto);
        this.publicadasPorClasse.set(chave, conjunto);
      }
      novas++;
    }
    this.chainCache.clear();
    return novas;
  }

  toJSON(): unknown {
    return {
      parents: [...this.parents], units: [...this.units],
      ranks: [...this.ranks], names: [...this.names],
      // as propriedades vão como lista separada por vírgula: um array por classe
      // triplicaria o tamanho do cache, que já passa de 3 MB
      props: [...this.propsPorClasse].map(([k, v]) => [k, [...v].join(',')]),
      pub: [...this.publicadasPorClasse].map(([k, v]) => [k, [...v].join(',')]),
      enums: [...this.enums].map(([k, v]) => [k, v.join(',')]),
      tipos: [...this.tipoDaProp],
      upas: [...this.unitPascal],
      decl: [...this.enumsDeclarados].map(([k, v]) => [k, v.join(',')]),
    };
  }

  /** Todas as classes conhecidas, em minúsculas. */
  classes(): string[] {
    return [...this.parents.keys()];
  }

  /** O índice guarda em minúsculas; isto devolve o nome como foi declarado no .pas. */
  nomeDeclarado(cls: string): string | undefined {
    return this.names.get(cls.toLowerCase());
  }

  static fromJSON(data: any): Registry {
    const r = new Registry();
    if (data?.parents) { r.parents = new Map(data.parents); }
    if (data?.units) { r.units = new Map(data.units); }
    if (data?.ranks) { r.ranks = new Map(data.ranks); }
    if (data?.names) { r.names = new Map(data.names); }
    if (data?.props) {
      r.propsPorClasse = new Map((data.props as [string, string][])
        .map(([k, v]) => [k, new Set(v ? v.split(',') : [])]));
    }
    if (data?.enums) {
      r.enums = new Map((data.enums as [string, string][]).map(([k, v]) => [k, v.split(',')]));
    }
    if (data?.tipos) { r.tipoDaProp = new Map(data.tipos); }
    if (data?.upas) { r.unitPascal = new Map(data.upas); }
    if (data?.decl) {
      r.enumsDeclarados = new Map(
        (data.decl as [string, string][]).map(([k, v]) => [k, v.split(',')]));
    }
    if (data?.pub) {
      r.publicadasPorClasse = new Map((data.pub as [string, string][])
        .map(([k, v]) => [k, new Set(v ? v.split(',') : [])]));
    }
    return r;
  }

  /** Cadeia de herança a partir da própria classe, sem entrar em ciclo. */
  chain(cls: string): string[] {
    const key = cls.toLowerCase();
    const hit = this.chainCache.get(key);
    if (hit) { return hit; }
    const out: string[] = [];
    const seen = new Set<string>();
    for (let cur: string | undefined = key; cur && !seen.has(cur); cur = this.parents.get(cur)) {
      out.push(cur);
      seen.add(cur);
    }
    this.chainCache.set(key, out);
    return out;
  }

  /** A classe descende de `base`? Cadeia truncada responde não, e o chamador que decida. */
  isA(cls: string, base: string): boolean {
    return this.chain(cls).includes(base.toLowerCase());
  }

  unitOf(cls: string): string | undefined {
    return this.units.get(cls.toLowerCase());
  }

  /**
   * Nome da unit para pôr no `uses`.
   *
   * Do RTTI quando a classe veio de um pacote; do nome do arquivo quando veio de fonte.
   */
  unitPascalDe(cls: string): string | undefined {
    const chave = cls.toLowerCase();
    const doRtti = this.unitPascal.get(chave);
    if (doRtti) { return doRtti; }
    const arquivo = this.units.get(chave);
    if (!arquivo || !/\.pas$/i.test(arquivo)) { return undefined; }
    return path.basename(arquivo).replace(/\.pas$/i, '');
  }

  kindSource(cls: string): [Kind, KindSource] {
    const chain = this.chain(cls);
    for (const c of chain) {
      const k = BASE_KIND.get(c);
      if (k) { return [k, 'heranca']; }
    }
    /*
     * A01 — antes de olhar o nome, olhar o que a classe publica.
     *
     * Medido sobre as classes cujo tipo já se conhece por herança, nos 1.111 .dfm do projeto
     * de referência: a inferência por propriedade acerta 89,5%, a heurística de nome 55,5%.
     * Por isso ela vem primeiro. As duas se complementam — o nome ainda cobre 75 classes que
     * a inferência não alcança.
     */
    const palpite = inferirKind(this.publicadasDe(cls));
    if (palpite) { return [palpite.kind, 'propriedades']; }

    const low = cls.toLowerCase();
    for (const [needle, k] of SUBSTR_KIND) {
      if (low.includes(needle)) { return [k, 'nome']; }
    }
    for (const c of chain) {
      const k = GENERIC_KIND.get(c);
      if (k) { return [k, 'generico']; }
    }
    return ['misc', 'nenhum'];
  }

  kind(cls: string): Kind {
    return this.kindSource(cls)[0];
  }

  isVisual(node: DfmNode): boolean {
    const chain = this.chain(node.cls);
    if (chain.some(c => VISUAL_ROOTS.has(c))) { return true; }
    // cadeia truncada mas o ancestral diz que é um botão/edit/grid: é controle.
    // (TcxButton para em TcxBaseButton, que o DevExpress não declara nas sources.)
    const [k, origem] = this.kindSource(node.cls);
    if (origem === 'heranca' && VISUAL_KINDS.has(k)) { return true; }
    if (chain.some(c => NONVISUAL_ROOTS.has(c))) { return false; }
    if (node.cls.toLowerCase().includes('tabsheet')) { return true; }
    // índice incompleto: o próprio .dfm decide, em vez de o componente sumir da tela
    return node.props.has('width') && node.props.has('height');
  }
}
