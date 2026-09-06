/**
 * Criar um form do zero: o `.dfm`, o `.pas` e o registro no `.dpr`.
 *
 * Um form no Delphi é sempre um par de arquivos que se referenciam — o `{$R *.dfm}` liga os
 * dois, e o nome da classe precisa bater com o `object` do form, senão a tela não carrega.
 * E sem entrar no `uses` do `.dpr`, a unit compila mas não vai para o executável.
 */

export type TipoNovo = 'form' | 'frame' | 'datamodule';

/** N05 — modelos prontos. `vazio` é o form em branco de sempre. */
export type Modelo1 = 'vazio' | 'dialogo' | 'consulta';

export interface Opcoes {
  /** N04 — herdar de um form que já existe, em vez de TForm. */
  ancestral?: { cls: string; unit: string };
  modelo?: Modelo1;
}

export interface Arquivo {
  /** Caminho relativo ao diretório escolhido. */
  nome: string;
  conteudo: string;
}

export interface Esqueleto {
  unit: string;
  classe: string;
  variavel: string;
  arquivos: Arquivo[];
}

const CRLF = String.fromCharCode(13, 10);

interface Modelo {
  ancestral: string;
  usesExtra: string[];
  prefixo: string;
  /** Data module não tem área cliente: o .dfm usa Width/Height. */
  dfmTamanho: (nome: string, cls: string, tam?: { w: number; h: number }) => string[];
}

const MODELOS: Record<TipoNovo, Modelo> = {
  form: {
    ancestral: 'TForm',
    usesExtra: ['Winapi.Windows', 'Winapi.Messages', 'System.SysUtils', 'System.Variants',
                'System.Classes', 'Vcl.Graphics', 'Vcl.Controls', 'Vcl.Forms', 'Vcl.Dialogs'],
    prefixo: 'Form',
    dfmTamanho: (nome, cls, tam) => [
      `object ${nome}: ${cls}`,
      '  Left = 0',
      '  Top = 0',
      "  Caption = '" + nome + "'",
      `  ClientHeight = ${tam ? tam.h : 300}`,
      `  ClientWidth = ${tam ? tam.w : 500}`,
      '  Color = clBtnFace',
      '  Font.Charset = DEFAULT_CHARSET',
      '  Font.Color = clWindowText',
      '  Font.Height = -12',
      "  Font.Name = 'Segoe UI'",
      '  Font.Style = []',
      '  Position = poScreenCenter',
      '  TextHeight = 15',
      'end',
    ],
  },
  frame: {
    ancestral: 'TFrame',
    usesExtra: ['Winapi.Windows', 'Winapi.Messages', 'System.SysUtils', 'System.Variants',
                'System.Classes', 'Vcl.Graphics', 'Vcl.Controls', 'Vcl.Forms', 'Vcl.Dialogs'],
    prefixo: 'Frame',
    dfmTamanho: (nome, cls) => [
      `object ${nome}: ${cls}`,
      '  Left = 0',
      '  Top = 0',
      '  Width = 400',
      '  Height = 200',
      '  TabOrder = 0',
      'end',
    ],
  },
  datamodule: {
    ancestral: 'TDataModule',
    usesExtra: ['System.SysUtils', 'System.Classes'],
    prefixo: 'Dm',
    dfmTamanho: (nome, cls) => [
      `object ${nome}: ${cls}`,
      '  Height = 300',
      '  Width = 400',
      'end',
    ],
  },
};

/** Nome de classe a partir do nome da unit, no padrão do Delphi. */
export function classeDe(unit: string, tipo: TipoNovo): string {
  const base = unit.replace(/[^A-Za-z0-9_]/g, '');
  const modelo = MODELOS[tipo];
  return `T${modelo.prefixo}${base}`;
}

export function variavelDe(unit: string, tipo: TipoNovo): string {
  return `${MODELOS[tipo].prefixo}${unit.replace(/[^A-Za-z0-9_]/g, '')}`;
}

/**
 * N05 — conteúdo que cada modelo acrescenta ao form recém-criado.
 *
 * São blocos de `.dfm` e métodos de `.pas` que andam juntos: um botão com `ModalResult` sem
 * o `Caption` não ajuda ninguém, e um botão com `OnClick` sem o método no `.pas` derruba a
 * tela ao abrir.
 */
interface Conteudo {
  dfm: string[];
  campos: string[];
  tamanho?: { w: number; h: number };
}

const CONTEUDO: Record<Modelo1, Conteudo> = {
  vazio: { dfm: [], campos: [] },
  dialogo: {
    tamanho: { w: 360, h: 160 },
    campos: [
      '    BotaoOk: TButton;',
      '    BotaoCancelar: TButton;',
    ],
    dfm: [
      '  object BotaoOk: TButton',
      '    Left = 176',
      '    Top = 120',
      '    Width = 80',
      '    Height = 25',
      "    Caption = 'OK'",
      '    Default = True',
      '    ModalResult = 1',
      '    TabOrder = 0',
      '  end',
      '  object BotaoCancelar: TButton',
      '    Left = 264',
      '    Top = 120',
      '    Width = 80',
      '    Height = 25',
      '    Cancel = True',
      "    Caption = 'Cancelar'",
      '    ModalResult = 2',
      '    TabOrder = 1',
      '  end',
    ],
  },
  consulta: {
    tamanho: { w: 640, h: 400 },
    campos: [
      '    PainelTopo: TPanel;',
      '    Grade: TDBGrid;',
    ],
    dfm: [
      '  object PainelTopo: TPanel',
      '    Left = 0',
      '    Top = 0',
      '    Width = 640',
      '    Height = 41',
      '    Align = alTop',
      '    BevelOuter = bvNone',
      '    TabOrder = 0',
      '  end',
      '  object Grade: TDBGrid',
      '    Left = 0',
      '    Top = 41',
      '    Width = 640',
      '    Height = 359',
      '    Align = alClient',
      '    TabOrder = 1',
      '    TitleFont.Charset = DEFAULT_CHARSET',
      '    TitleFont.Color = clWindowText',
      '    TitleFont.Height = -12',
      "    TitleFont.Name = 'Segoe UI'",
      '    TitleFont.Style = []',
      '  end',
    ],
  },
};

const UNITS_MODELO: Record<Modelo1, string[]> = {
  vazio: [],
  dialogo: ['Vcl.StdCtrls'],
  consulta: ['Vcl.ExtCtrls', 'Vcl.Grids', 'Vcl.DBGrids'],
};

/**
 * Monta os dois arquivos. O nome da unit vem do arquivo, e o compilador exige que batam —
 * é o erro que o nosso diagnóstico já aponta em unidades existentes.
 */
export function novoEsqueleto(unit: string, tipo: TipoNovo, opcoes: Opcoes = {}): Esqueleto {
  if (!/^[A-Za-z_]\w*$/.test(unit)) {
    throw new Error('o nome da unit só aceita letras, números e sublinhado, começando por letra');
  }
  const modelo = MODELOS[tipo];
  const classe = classeDe(unit, tipo);
  const variavel = variavelDe(unit, tipo);
  // modelo e herança são coisas de form: um frame com botão ModalResult não faz sentido
  const modeloEscolhido = tipo === 'form' ? (opcoes.modelo ?? 'vazio') : 'vazio';
  const conteudo = CONTEUDO[modeloEscolhido];

  // N04 — herdar de um form do projeto troca a base e traz a unit dele para o uses
  const heranca = tipo === 'form' ? opcoes.ancestral : undefined;
  const base = heranca ? heranca.cls : modelo.ancestral;
  const uses = [...modelo.usesExtra];
  for (const u of [...UNITS_MODELO[modeloEscolhido], heranca?.unit]) {
    if (u && !uses.some(x => x.toLowerCase() === u.toLowerCase())) { uses.push(u); }
  }

  const pas = [
    `unit ${unit};`,
    '',
    'interface',
    '',
    'uses',
    ...uses.map((u, i) => `  ${u}${i === uses.length - 1 ? ';' : ','}`),
    '',
    'type',
    `  ${classe} = class(${base})`,
    ...conteudo.campos,
    '  private',
    '    { Private declarations }',
    '  public',
    '    { Public declarations }',
    '  end;',
    '',
    'var',
    `  ${variavel}: ${classe};`,
    '',
    'implementation',
    '',
    '{$R *.dfm}',
    '',
    'end.',
    '',
  ].join(CRLF);

  const corpo = modelo.dfmTamanho(variavel, classe, conteudo.tamanho);
  // um form que herda de outro nasce como `inherited`, e é isso que faz o Delphi
  // trazer os componentes do ancestral em vez de duplicá-los
  if (heranca) { corpo[0] = `inherited ${variavel}: ${classe}`; }
  corpo.splice(corpo.length - 1, 0, ...conteudo.dfm);
  const dfm = corpo.join(CRLF) + CRLF;

  return {
    unit, classe, variavel,
    arquivos: [
      { nome: `${unit}.pas`, conteudo: pas },
      { nome: `${unit}.dfm`, conteudo: dfm },
    ],
  };
}

export interface EdicaoDpr {
  linha: number;
  kind: 'insert' | 'replace';
  texto: string;
}

/**
 * N02 — registra a unit no `uses` do `.dpr`, com o comentário do form que o Delphi escreve.
 *
 * O formato é `Unit1 in 'Unit1.pas' {Form1}`, e é esse comentário que faz a IDE listar o form
 * no Project Manager. Sem a entrada, a unit simplesmente não entra no executável.
 */
export function registrarNoDpr(
  texto: string, unit: string, arquivoRelativo: string, variavel: string, tipo: TipoNovo,
): EdicaoDpr[] {
  const linhas = texto.split(/\r?\n/);
  const alvo = unit.toLowerCase();

  let inicio = -1;
  let fim = -1;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].replace(/\/\/.*$/, '');
    if (inicio < 0 && /^\s*uses\b/i.test(l)) { inicio = i; }
    if (inicio >= 0) {
      for (const m of l.matchAll(/\b([A-Za-z_][\w.]*)\s+in\b/g)) {
        if (m[1].toLowerCase() === alvo) { return []; }
      }
      if (l.includes(';')) { fim = i; break; }
    }
  }
  if (inicio < 0) { throw new Error('não achei a cláusula uses do .dpr'); }
  if (fim < 0) { fim = inicio; }

  const marca = tipo === 'datamodule' ? `{${variavel}: TDataModule}` : `{${variavel}}`;
  const entrada = `  ${unit} in '${arquivoRelativo}' ${marca};`;
  const ultima = linhas[fim];
  return [
    { linha: fim, kind: 'replace', texto: ultima.replace(/;\s*$/, ',') },
    { linha: fim + 1, kind: 'insert', texto: entrada },
  ];
}
