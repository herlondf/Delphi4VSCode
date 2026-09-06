import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { assinaturaDe, criarHandler, nomeHandler } from '../dfm/handler';
import { parsePascal, crossCheck } from '../dfm/pascal';

const UNIT = `unit VendaMan;

interface

uses
  Vcl.Forms, Vcl.StdCtrls;

type
  TFormItem = class(TForm)
    BotaoOk: TButton;
    EditNome: TEdit;
    procedure FormCreate(Sender: TObject);
  private
    FTotal: Currency;
  public
    procedure Recalcular;
  end;

var
  FormItem: TFormItem;

implementation

{$R *.dfm}

procedure TFormItem.FormCreate(Sender: TObject);
begin
  Caption := 'Venda';
end;

procedure TFormItem.Recalcular;
begin
end;

end.
`;

/** Aplica as edições como o WorkspaceEdit faz: de baixo para cima. */
function aplicar(texto: string, edicoes: { linha: number; texto: string }[]): string {
  const linhas = texto.split('\n');
  const porLinha = new Map<number, string[]>();
  for (const e of edicoes) {
    porLinha.set(e.linha, [...(porLinha.get(e.linha) ?? []), e.texto]);
  }
  for (const [linha, textos] of [...porLinha].sort((a, b) => b[0] - a[0])) {
    linhas.splice(linha, 0, ...textos);
  }
  return linhas.join('\n');
}

test('nome do handler segue a convenção do Delphi', () => {
  assert.equal(nomeHandler('BotaoOk', 'OnClick'), 'BotaoOkClick');
  assert.equal(nomeHandler('Grid', 'OnKeyDown'), 'GridKeyDown');
  assert.equal(nomeHandler('cds', 'BeforePost'), 'cdsBeforePost');
});

test('assinatura muda conforme o evento', () => {
  assert.equal(assinaturaDe('OnClick'), 'Sender: TObject');
  assert.equal(assinaturaDe('OnKeyDown'), 'Sender: TObject; var Key: Word; Shift: TShiftState');
  assert.equal(assinaturaDe('BeforePost'), 'DataSet: TDataSet');
  assert.match(assinaturaDe('OnMouseDown'), /Button: TMouseButton/);
  // evento desconhecido cai no formato mais comum, em vez de falhar
  assert.equal(assinaturaDe('OnQualquerCoisa'), 'Sender: TObject');
});

test('cria declaração na classe e implementação no corpo', () => {
  const r = criarHandler(UNIT, 'BotaoOk', 'OnClick');
  assert.equal(r.metodo, 'BotaoOkClick');
  const novo = aplicar(UNIT, r.edicoes);

  // a declaração entra na published, junto dos componentes — não em private
  const linhas = novo.split('\n');
  const iDecl = linhas.findIndex(l => l.includes('procedure BotaoOkClick'));
  const iPrivate = linhas.findIndex(l => l.trim() === 'private');
  assert.ok(iDecl > 0 && iDecl < iPrivate, `declaração em ${iDecl}, private em ${iPrivate}`);
  assert.ok(linhas[iDecl].startsWith('    '), 'alinhada com as outras: ' + JSON.stringify(linhas[iDecl]));

  // a implementação vai para o fim, antes do end.
  assert.match(novo, /procedure TFormItem\.BotaoOkClick\(Sender: TObject\);\r?\nbegin/);
  const iImpl = linhas.findIndex(l => l.startsWith('procedure TFormItem.BotaoOkClick'));
  const iFim = linhas.findIndex(l => l.trim() === 'end.');
  assert.ok(iImpl > 0 && iImpl < iFim, `implementação em ${iImpl}, end. em ${iFim}`);

  // e o resultado continua sendo uma unit válida para o nosso parser
  const unit = parsePascal(novo);
  const m = unit.metodos.find(x => x.nome === 'BotaoOkClick');
  assert.ok(m, 'o método precisa ser reconhecido depois');
  assert.equal(m!.implementado, true, 'e contar como implementado');
});

test('o método novo silencia o diagnóstico que o form gerava', () => {
  // antes: o .dfm aponta OnClick para um método que não existe
  const antes = crossCheck(parsePascal(UNIT),
    [{ nome: 'BotaoOk', cls: 'TButton', linha: 5 }, { nome: 'EditNome', cls: 'TEdit', linha: 9 }],
    [{ nome: 'BotaoOkClick', linha: 6, prop: 'OnClick' }]);
  assert.ok(antes.some(i => i.mensagem.includes('BotaoOkClick')), JSON.stringify(antes));

  const depois = crossCheck(parsePascal(aplicar(UNIT, criarHandler(UNIT, 'BotaoOk', 'OnClick').edicoes)),
    [{ nome: 'BotaoOk', cls: 'TButton', linha: 5 }, { nome: 'EditNome', cls: 'TEdit', linha: 9 }],
    [{ nome: 'BotaoOkClick', linha: 6, prop: 'OnClick' }]);
  assert.ok(!depois.some(i => i.mensagem.includes('BotaoOkClick')),
    'o handler criado deve resolver o apontamento: ' + JSON.stringify(depois));
});

test('recusa criar um método que já existe', () => {
  assert.throws(() => criarHandler(UNIT, 'Form', 'OnCreate', 'FormCreate'), /já existe/);
});

test('recusa unit sem classe de form', () => {
  assert.throws(() => criarHandler('unit X;\n\ninterface\n\nimplementation\n\nend.\n',
    'B', 'OnClick'), /não achei a classe/);
});

test('o cursor cai dentro do corpo criado', () => {
  const r = criarHandler(UNIT, 'EditNome', 'OnChange');
  const novo = aplicar(UNIT, r.edicoes).split('\n');
  const linha = novo[r.linhaCursor];
  assert.equal(linha.trim(), '', `esperava a linha vazia do begin/end, achei ${JSON.stringify(linha)}`);
  assert.equal(novo[r.linhaCursor - 1].trim(), 'begin');
  assert.equal(novo[r.linhaCursor + 1].trim(), 'end;');
});

test('unit sem seção published explícita ainda recebe a declaração', () => {
  const simples = `unit U;

interface

type
  TForm2 = class(TForm)
    Botao: TButton;
  end;

implementation

end.
`;
  const r = criarHandler(simples, 'Botao', 'OnClick');
  const novo = aplicar(simples, r.edicoes);
  assert.match(novo, /procedure BotaoClick\(Sender: TObject\);/);
  assert.match(novo, /procedure TForm2\.BotaoClick/);
  const unit = parsePascal(novo);
  assert.ok(unit.metodos.some(m => m.nome === 'BotaoClick' && m.implementado));
});
