/**
 * Leitura leve de uma unit Object Pascal.
 *
 * Não é um compilador: extrai o suficiente para cruzar o `.pas` com o `.dfm` irmão, que é
 * onde mora uma classe de erro cara — o form compila, e quebra ao abrir em runtime, porque
 * o componente do `.dfm` não tem campo na classe ou o handler não existe.
 */

export interface PasField {
  nome: string;
  tipo: string;
  linha: number;
}

export interface PasMethod {
  nome: string;
  linha: number;
  /** Declarado na classe (interface) ou implementado (`procedure TForm1.X`). */
  implementado: boolean;
}

export interface PasUnit {
  nome: string;
  linhaUnit: number;
  /** Classe do form: a primeira que descende de algo com `Form`, `Frame` ou `DataModule`. */
  classe?: string;
  linhaClasse: number;
  ancestral?: string;
  /** Campos da seção published — é lá que os componentes do .dfm são declarados. */
  campos: PasField[];
  metodos: PasMethod[];
  uses: { nome: string; linha: number }[];
}

const RE_UNIT = /^\s*unit\s+([\w.]+)/i;
const RE_CLASSE = /^\s*(T\w+)\s*=\s*class\s*\(\s*(T\w+)/i;
const RE_CAMPO = /^\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.]*)\s*;/;
const RE_DECL = /^\s*(?:procedure|function)\s+([A-Za-z_]\w*)\s*[(;:]/i;
const RE_IMPL = /^\s*(?:procedure|function)\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)/i;
const RE_SECAO = /^\s*(private|protected|public|published|strict\s+private|strict\s+protected)\b/i;
const RE_FIM_CLASSE = /^\s*end\s*;/;
const SO_PALAVRA_CHAVE = new RegExp(
  '^' + String.fromCharCode(92) + 's*(?:class' + String.fromCharCode(92) + 's+)?' +
  '(?:procedure|function|constructor|destructor)' + String.fromCharCode(92) + 's*$', 'i');

function contarParenteses(linha: string): number {
  let n = 0;
  for (const c of linha) {
    if (c === '(') { n++; }
    if (c === ')') { n--; }
  }
  return n;
}

/**
 * Uma classe cujo ancestral parece de tela — e nao de apoio.
 *
 * A unit pode declarar varias classes, e o que interessa ao cruzamento com o `.dfm` e a do
 * form. Pegar simplesmente a primeira fazia o `RelatorioData.pas` do projeto de teste ser
 * cruzado contra um `TTotaisAuxiliar` de apoio: todo componente do form aparecia
 * como "nao declarado", e nenhum daqueles avisos era verdadeiro.
 */
const ANCESTRAL_DE_TELA = /form|frame|datamodule|dm[A-Z]|webmodule/i;

export function parsePascal(texto: string, preferida?: string): PasUnit {
  const linhas = texto.split(/\r?\n/);
  const out: PasUnit = {
    nome: '', linhaUnit: 0, linhaClasse: 0,
    campos: [], metodos: [], uses: [],
  };

  let secao = '';
  let dentroClasse = false;
  /** Parenteses ainda abertos de uma declaracao de metodo que passou de linha. */
  let parametrosAbertos = 0;
  let emUses = false;
  let emComentario = false;

  for (let i = 0; i < linhas.length; i++) {
    const bruta = linhas[i];
    // tira comentários para não confundir declaração com texto
    let l = bruta;
    if (emComentario) {
      const fim = l.indexOf('}');
      if (fim < 0) { continue; }
      l = l.slice(fim + 1);
      emComentario = false;
    }
    l = l.replace(/\/\/.*$/, '');
    const abre = l.indexOf('{');
    if (abre >= 0 && !/\{\$/.test(l.slice(abre))) {
      const fecha = l.indexOf('}', abre);
      if (fecha < 0) { emComentario = true; l = l.slice(0, abre); }
      else { l = l.slice(0, abre) + l.slice(fecha + 1); }
    }
    if (!l.trim()) { continue; }

    if (!out.nome) {
      const m = RE_UNIT.exec(l);
      if (m) { out.nome = m[1]; out.linhaUnit = i; continue; }
    }

    if (/^\s*uses\b/i.test(l)) { emUses = true; }
    if (emUses) {
      for (const m of l.matchAll(/([A-Za-z_][\w.]*)/g)) {
        const nome = m[1];
        if (/^(uses|in)$/i.test(nome)) { continue; }
        out.uses.push({ nome, linha: i });
      }
      if (l.includes(';')) { emUses = false; }
      continue;
    }

    const mc = RE_CLASSE.exec(l);
    if (mc) {
      /*
       * A escolha, em ordem: a classe que o chamador pediu (ele leu o `.dfm` e sabe o nome),
       * depois a primeira que descende de algo com cara de tela, e so entao a primeira de
       * todas. Trocar de classe no meio zera o que ja foi colhido da anterior.
       */
      const ehPreferida = !!preferida && mc[1].toLowerCase() === preferida.toLowerCase();
      const ehDeTela = ANCESTRAL_DE_TELA.test(mc[2]);
      const jaTemMelhor = out.classe
        && (!preferida || out.classe.toLowerCase() === preferida.toLowerCase())
        && (ehPreferida ? false : !ehDeTela || ANCESTRAL_DE_TELA.test(out.ancestral ?? ''));
      if (!jaTemMelhor) {
        out.classe = mc[1];
        out.ancestral = mc[2];
        out.linhaClasse = i;
        out.campos = [];
        out.metodos = out.metodos.filter(m => m.implementado);
      }
      dentroClasse = true;
      secao = 'published';   // antes da primeira seção, o padrão do Delphi é published
      continue;
    }
    if (dentroClasse && RE_CLASSE.test(l)) { continue; }

    if (dentroClasse) {
      /*
       * Declaracao de metodo pode passar de uma linha, e a continuacao tem cara de campo:
       *
       *   procedure Clicou(Sender: TObject;
       *     AButton: TMouseButton; AShift: TShiftState);
       *
       * A segunda linha casava com o padrao de campo, e `AButton: TMouseButton` entrava na
       * lista de componentes do form — 31 avisos de "declarado mas nao existe no .dfm" nos
       * forms do projeto de teste, todos falsos.
       */
      if (parametrosAbertos > 0) {
        parametrosAbertos += contarParenteses(l);
        continue;
      }
      const ms = RE_SECAO.exec(l);
      if (ms) { secao = ms[1].toLowerCase().replace(/strict\s+/, ''); continue; }
      if (RE_FIM_CLASSE.test(l)) { dentroClasse = false; continue; }
      const md = RE_DECL.exec(l);
      if (md) {
        parametrosAbertos = contarParenteses(l);
        /*
         * `abstract` nao tem corpo por definicao: cobrar implementacao dele deu 54 avisos
         * falsos, e o compilador confirma — declarar o corpo de um abstract e erro.
         */
        if (!/\babstract\b/i.test(l)) {
          out.metodos.push({ nome: md[1], linha: i, implementado: false });
        }
        continue;
      }
      const mf = RE_CAMPO.exec(l);
      if (mf && secao === 'published') {
        out.campos.push({ nome: mf[1], tipo: mf[2], linha: i });
      }
      continue;
    }

    /*
     * O nome pode cair na linha seguinte a palavra-chave: o formatador da IDE quebra ali
     * sozinho quando `TClasse.MetodoComNomeLongo(` nao cabe na margem. Sem juntar, o metodo
     * parecia nao ter corpo.
     */
    const linhaImpl = SO_PALAVRA_CHAVE.test(l)
      ? `${l} ${(linhas[i + 1] ?? '').trim()}` : l;
    const mi = RE_IMPL.exec(linhaImpl);
    if (mi) {
      /*
       * Marca TODAS as declaracoes com esse nome, nao a primeira.
       *
       * Sobrecarga declara o mesmo nome duas ou mais vezes, e casar uma implementacao com uma
       * declaracao so deixava as outras como "sem corpo" — 19 avisos falsos nos forms do
       * projeto de teste. Casar por assinatura exigiria comparar tipos de parametro, e um aviso que erra
       * custa mais do que a precisao que ganharia.
       */
      const iguais = out.metodos.filter(x => x.nome.toLowerCase() === mi[2].toLowerCase());
      if (iguais.length) { for (const m of iguais) { m.implementado = true; } }
      else { out.metodos.push({ nome: mi[2], linha: i, implementado: true }); }
    }
  }

  return out;
}

/*
 * Não há checagem de begin/end aqui, e é deliberado.
 *
 * Contar blocos por palavra-chave marcou 35 de 150 units válidas do projeto como
 * desbalanceadas: `case` dentro de variant record fecha no `end` do próprio record,
 * `class var` e `class function` casam com o padrão sem abrir bloco, e `end.` fecha a unit
 * sem par. Um aviso que erra em 23% dos casos custa mais atenção do que economiza — isso
 * exige um parser de verdade, não uma contagem.
 */

export interface CrossIssue {
  linha: number;
  severidade: 'error' | 'warning' | 'info';
  mensagem: string;
  /** Onde o problema foi visto: no .pas ou no .dfm. */
  origem: 'pas' | 'dfm';
}

/**
 * Cruza a unit com o form: é aqui que aparecem os erros que o compilador não pega e que
 * derrubam a aplicação ao abrir a tela.
 */
export interface OpcoesCross {
  /**
   * TODOS os nomes que aparecem no `.dfm`, inclusive os que não exigem campo nesta classe.
   *
   * A checagem inversa — campo declarado que não existe no form — precisa dessa lista
   * inteira: num form herdado, o campo pode casar com um nó `inherited`, que fica de fora
   * de `componentes` de propósito.
   */
  todosOsNomes?: string[];
}

/**
 * O que o compilador respondeu, quando perguntei em vez de supor.
 *
 * Um `.dpr` de console criando um form cujo `.dfm` tem um componente SEM campo na classe, e
 * um `OnClick` apontando para um método inexistente:
 *
 *   carregou. componentes: 2
 *     [0] BotaoDeclarado: TButton
 *     [1] BotaoSemCampo: TButton
 *
 * Ou seja: **o form carrega nos dois casos**. O componente sem campo é criado e pertence ao
 * form, só não dá para alcançá-lo pelo nome no código; o evento sem método simplesmente nunca
 * dispara. A mensagem antiga dizia "o form vai falhar ao carregar", e isso é falso — foi
 * escrita de memória, e é o tipo de exagero que faz o usuário parar de ler os avisos.
 */
export function crossCheck(
  unit: PasUnit,
  componentes: { nome: string; cls: string; linha: number }[],
  handlers: { nome: string; linha: number; prop: string }[],
  opcoes: OpcoesCross = {},
): CrossIssue[] {
  const issues: CrossIssue[] = [];
  const campos = new Map(unit.campos.map(c => [c.nome.toLowerCase(), c]));
  const metodos = new Map(unit.metodos.map(m => [m.nome.toLowerCase(), m]));

  for (const c of componentes) {
    const campo = campos.get(c.nome.toLowerCase());
    if (!campo) {
      issues.push({
        linha: c.linha, origem: 'dfm', severidade: 'warning',
        mensagem: `${c.nome} não tem campo em ${unit.classe ?? unit.nome}: o componente é ` +
          'criado, mas nenhum código consegue chamá-lo pelo nome',
      });
    } else if (campo.tipo.toLowerCase() !== c.cls.toLowerCase()) {
      issues.push({
        linha: c.linha, origem: 'dfm', severidade: 'warning',
        mensagem: `${c.nome} é ${c.cls} no form, mas ${campo.tipo} na classe`,
      });
    }
  }

  for (const h of handlers) {
    if (!metodos.has(h.nome.toLowerCase())) {
      issues.push({
        linha: h.linha, origem: 'dfm', severidade: 'warning',
        mensagem: `${h.prop} aponta para ${h.nome}, que não existe em ` +
          `${unit.classe ?? unit.nome}: o evento nunca vai disparar`,
      });
    }
  }

  const noForm = new Set(
    (opcoes.todosOsNomes ?? componentes.map(c => c.nome)).map(n => n.toLowerCase()));
  for (const campo of unit.campos) {
    // só reclama de tipos de componente: T* que não sejam tipos básicos
    if (!/^T[A-Z]/.test(campo.tipo) || noForm.has(campo.nome.toLowerCase())) { continue; }
    issues.push({
      linha: campo.linha, origem: 'pas', severidade: 'info',
      mensagem: `${campo.nome} está declarado como published mas não existe no .dfm`,
    });
  }

  for (const m of unit.metodos) {
    if (!m.implementado) {
      issues.push({
        linha: m.linha, origem: 'pas', severidade: 'error',
        mensagem: `${m.nome} está declarado mas não tem implementação nesta unit`,
      });
    }
  }

  const vistos = new Map<string, number>();
  for (const u of unit.uses) {
    const chave = u.nome.toLowerCase();
    if (vistos.has(chave)) {
      issues.push({
        linha: u.linha, origem: 'pas', severidade: 'warning',
        mensagem: `${u.nome} aparece duas vezes no uses`,
      });
    }
    vistos.set(chave, u.linha);
  }

  return issues;
}

/**
 * Quais componentes do `.dfm` precisam de campo publicado na classe DESTE arquivo.
 *
 * A pergunta parece boba e não é. Medido nos 341 pares `.dfm`/`.pas` do projeto de teste, a regra
 * ingênua — "todo componente nomeado precisa de campo" — produzia **8.158 erros num código
 * que compila e roda**. Duas coisas explicam todos eles:
 *
 * 1. **Herança visual de form.** 332 dos 341 forms começam com `inherited`. Um nó escrito
 *    `inherited Panel1: TcxGroupBox` é do ANCESTRAL, e o descendente não o redeclara — foram
 *    5.756 erros. O mesmo vale para o conteúdo de um `inline`, que pertence à classe do frame.
 *
 * 2. **Componente que faz o próprio streaming.** Os outros 2.402 estavam todos dentro de um
 *    `TfrxReport`: o FastReport é dono dos filhos dele, que nunca ganham campo no form. O
 *    sinal geral disso é o pai não ser um controle visual — `TdxLayoutControl` é, e por isso
 *    os `TdxLayoutItem` continuam sendo cobrados; `TfrxReport` não é.
 *
 * A regra erra para o lado de não avisar. Um `TMenuItem` dentro de um `TPopupMenu` deixa de
 * ser cobrado, e ele de fato tem campo — mas deixar de apontar um problema real custa menos
 * que apontar oito mil que não existem.
 */
export interface ComponenteDoForm {
  nome: string;
  cls: string;
  linha: number;
}

export function componentesQueExigemCampo(
  raiz: DfmNodeMinimo, ehVisual: (cls: string) => boolean,
): ComponenteDoForm[] {
  const out: ComponenteDoForm[] = [];
  const anda = (n: DfmNodeMinimo, donoProprio: boolean, emFrame: boolean): void => {
    for (const k of n.kids) {
      /*
       * `inline` é uma instância de frame acrescentada AQUI: ela precisa de campo, igual a um
       * `object`. O que não precisa é o conteúdo dela, que pertence à classe do frame — e é
       * por isso que `emFrame` corta a partir do nível de baixo, não neste.
       */
      const daClasse = (k.kind === 'object' || k.kind === 'inline')
        && !donoProprio && !emFrame;
      if (k.name && daClasse) { out.push({ nome: k.name, cls: k.cls, linha: k.line }); }
      anda(k, donoProprio || !ehVisual(k.cls), emFrame || k.kind === 'inline');
    }
  };
  anda(raiz, false, false);
  return out;
}

/** O mínimo do nó de `.dfm` que esta regra precisa — evita importar o modelo inteiro. */
export interface DfmNodeMinimo {
  name: string;
  cls: string;
  line: number;
  kind: 'object' | 'inherited' | 'inline';
  kids: DfmNodeMinimo[];
}
