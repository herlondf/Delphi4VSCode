/**
 * Criar um handler de evento no `.pas`, como o duplo-clique do Delphi.
 *
 * É a operação que fecha o ciclo: sem ela, um botão criado aqui não faz nada até alguém abrir
 * a IDE. São três edições coordenadas — a declaração na classe, a implementação no corpo da
 * unit, e a ligação no `.dfm` — e todas precisam acontecer, ou o form quebra ao abrir.
 */

import { PasUnit, parsePascal } from './pascal';

export interface EdicaoTexto {
  linha: number;
  kind: 'insert' | 'replace';
  texto: string;
}

export interface NovoHandler {
  metodo: string;
  edicoes: EdicaoTexto[];
  /** Linha onde o cursor deve parar depois de aplicar (dentro do corpo novo). */
  linhaCursor: number;
}

/**
 * Assinatura padrão por evento. O Delphi gera cada uma a partir do tipo declarado no
 * componente; aqui cobrimos os eventos que aparecem na prática, e o resto cai em
 * `Sender: TObject`, que é a assinatura de longe mais comum.
 */
const ASSINATURAS: Record<string, string> = {
  onkeydown: 'Sender: TObject; var Key: Word; Shift: TShiftState',
  onkeyup: 'Sender: TObject; var Key: Word; Shift: TShiftState',
  onkeypress: 'Sender: TObject; var Key: Char',
  onmousedown: 'Sender: TObject; Button: TMouseButton; Shift: TShiftState; X, Y: Integer',
  onmouseup: 'Sender: TObject; Button: TMouseButton; Shift: TShiftState; X, Y: Integer',
  onmousemove: 'Sender: TObject; Shift: TShiftState; X, Y: Integer',
  onclosequery: 'Sender: TObject; var CanClose: Boolean',
  onclose: 'Sender: TObject; var Action: TCloseAction',
  oncanresize: 'Sender: TObject; var NewWidth, NewHeight: Integer; var Resize: Boolean',
  ondrawitem: 'Control: TWinControl; Index: Integer; Rect: TRect; State: TOwnerDrawState',
  onfilterrecord: 'DataSet: TDataSet; var Accept: Boolean',
  onvalidate: 'Sender: TField',
  ongettext: 'Sender: TField; var Text: string; DisplayText: Boolean',
  onsettext: 'Sender: TField; const Text: string',
  beforepost: 'DataSet: TDataSet',
  afterpost: 'DataSet: TDataSet',
  beforeopen: 'DataSet: TDataSet',
  afteropen: 'DataSet: TDataSet',
  onnewrecord: 'DataSet: TDataSet',
  oncalcfields: 'DataSet: TDataSet',
};

export function assinaturaDe(evento: string): string {
  return ASSINATURAS[evento.toLowerCase()] ?? 'Sender: TObject';
}

/** Nome que o Delphi daria: componente + evento sem o prefixo `On`. */
export function nomeHandler(componente: string, evento: string): string {
  const sufixo = /^on/i.test(evento) ? evento.slice(2) : evento;
  return `${componente}${sufixo}`;
}

/**
 * Monta as edições do `.pas` para criar o método.
 *
 * A declaração entra no fim da seção `published` da classe do form — que é onde o Delphi põe,
 * junto dos componentes. A implementação vai para o fim da unit, antes do `end.` final.
 */
export function criarHandler(
  texto: string, componente: string, evento: string, nomeDesejado?: string,
): NovoHandler {
  const unit: PasUnit = parsePascal(texto);
  if (!unit.classe) {
    throw new Error('não achei a classe do form nesta unit');
  }
  const metodo = nomeDesejado || nomeHandler(componente, evento);
  if (unit.metodos.some(m => m.nome.toLowerCase() === metodo.toLowerCase())) {
    throw new Error(`${metodo} já existe nesta unit`);
  }

  const linhas = texto.split(/\r?\n/);
  const assinatura = assinaturaDe(evento);

  // fim da seção published: a última linha antes de outra seção ou do fim da classe
  let fimPublished = -1;
  let dentro = false;
  let secao = 'published';
  for (let i = unit.linhaClasse; i < linhas.length; i++) {
    const l = linhas[i].trim();
    if (i === unit.linhaClasse) { dentro = true; continue; }
    if (!dentro) { break; }
    const ms = /^(private|protected|public|published|strict\s+\w+)\b/i.exec(l);
    if (ms) {
      if (secao === 'published' && fimPublished < 0) { fimPublished = i; }
      secao = ms[1].toLowerCase().replace(/strict\s+/, '');
      continue;
    }
    if (/^end\s*;/.test(l)) {
      if (secao === 'published' && fimPublished < 0) { fimPublished = i; }
      dentro = false;
      break;
    }
  }
  if (fimPublished < 0) { fimPublished = unit.linhaClasse + 1; }

  // recuo das declarações existentes, para a nova linha ficar alinhada
  const recuo = detectarRecuo(linhas, unit.linhaClasse, fimPublished);
  const decl = `${recuo}procedure ${metodo}(${assinatura});`;

  // implementação antes do `end.` final
  const fimUnit = ultimaLinhaUtil(linhas);
  const corpo = [
    '',
    `procedure ${unit.classe}.${metodo}(${assinatura});`,
    'begin',
    '',
    'end;',
  ];

  return {
    metodo,
    edicoes: [
      { linha: fimPublished, kind: 'insert', texto: decl },
      ...corpo.map(t => ({ linha: fimUnit, kind: 'insert' as const, texto: t })),
    ],
    // +1 pela declaração inserida acima, +3 para cair na linha em branco do begin/end
    linhaCursor: fimUnit + 1 + 3,
  };
}

function detectarRecuo(linhas: string[], de: number, ate: number): string {
  for (let i = de + 1; i < ate; i++) {
    const l = linhas[i];
    if (l.trim()) { return l.slice(0, l.length - l.trimStart().length); }
  }
  return '    ';
}

/** Índice da linha do `end.` que fecha a unit. */
function ultimaLinhaUtil(linhas: string[]): number {
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (/^\s*end\s*\.\s*$/.test(linhas[i])) { return i; }
  }
  return linhas.length;
}
