import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Registry } from '../dfm/registry';
import { garantirUses, montarPaleta, padraoDe, todaPaleta, unitDe } from '../dfm/palette';

const reg = Registry.fromJSON({
  parents: [
    ['tcxbutton', 'tcxcustombutton'], ['tcxcustombutton', 'tcxbasebutton'],
    ['tcxbasebutton', 'tcxcontrol'],
    ['tbutton', 'tcustombutton'], ['tcustombutton', 'twincontrol'],
    ['tcxgrid', 'tcxcustomgrid'], ['tcxcustomgrid', 'tcxcontrol'],
    ['tcxcontrol', 'twincontrol'],
    ['tdatasource', 'tcomponent'],
    ['tdxlayoutitem', 'tdxcustomlayoutitem'], ['tdxcustomlayoutitem', 'tcomponent'],
    ['twidestringfield', 'tstringfield'], ['tstringfield', 'tfield'], ['tfield', 'tcomponent'],
    ['tcxgriddbcolumn', 'tcxgridcolumn'], ['tcxgridcolumn', 'tcomponent'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
  units: [
    ['tcxbutton', 'C:/dx/source/cxButtons.pas'],
    ['tbutton', 'C:/rad/vcl/Vcl.StdCtrls.pas'],
    ['tcxgrid', 'C:/dx/source/cxGrid.pas'],
    ['tdatasource', 'C:/rad/data/Data.DB.pas'],
  ],
  // o índice guarda a chave em minúsculas e o nome como foi declarado; a paleta usa o segundo
  names: [
    ['tcxbutton', 'TcxButton'], ['tbutton', 'TButton'], ['tcxgrid', 'TcxGrid'],
    ['tdatasource', 'TDataSource'], ['tdxlayoutitem', 'TdxLayoutItem'],
    ['twidestringfield', 'TWideStringField'], ['tcxgriddbcolumn', 'TcxGridDBColumn'],
  ],
});

// como o projeto realmente usa, medido nos .dfm
const contagem = new Map<string, number>([
  ['TdxLayoutItem', 4961], ['TWideStringField', 3099], ['TcxButton', 1790],
  ['TcxGridDBColumn', 374], ['TButton', 596], ['TcxGrid', 300], ['TDataSource', 187],
]);

test('a paleta vem do uso real, não de uma lista fixa', () => {
  const p = montarPaleta(reg, contagem);
  const nomes = p.map(i => i.cls);
  // no projeto do projeto de teste, TcxButton aparece 3x mais que TButton — e vem antes
  assert.ok(nomes.indexOf('TcxButton') < nomes.indexOf('TButton'), String(nomes));
  assert.ok(nomes.includes('TcxGrid'));
});

test('o que não se cria solto fica fora da paleta', () => {
  const nomes = montarPaleta(reg, contagem).map(i => i.cls);
  // itens de layout, colunas e campos só existem dentro do dono deles
  assert.ok(!nomes.includes('TdxLayoutItem'), String(nomes));
  assert.ok(!nomes.includes('TcxGridDBColumn'), String(nomes));
  assert.ok(!nomes.includes('TWideStringField'), String(nomes));
});

test('não visuais úteis entram, marcados como tal', () => {
  const p = todaPaleta(reg, contagem);
  const ds = p.find(i => i.cls === 'TDataSource');
  assert.ok(ds, 'TDataSource precisa estar na paleta');
  assert.equal(ds!.visual, false);
  const btn = p.find(i => i.cls === 'TcxButton');
  assert.equal(btn!.visual, true);
});

test('cada item sabe a unit que precisa entrar no uses', () => {
  const p = todaPaleta(reg, contagem);
  assert.equal(p.find(i => i.cls === 'TcxButton')!.unit, 'cxButtons');
  assert.equal(p.find(i => i.cls === 'TButton')!.unit, 'Vcl.StdCtrls');
  assert.equal(unitDe(undefined), undefined);
});

/*
 * A paleta deixou de ser só o que o projeto usa.
 *
 * Filtrar por uso põe o relevante na frente, mas torna impossível achar um componente que
 * ninguém usou ainda — que é justamente quando se procura na paleta. Agora tudo que dá para
 * instanciar aparece, e o uso só ordena.
 */
test('componente nunca usado no projeto continua acessível', () => {
  const semUso = new Map<string, number>();
  const p = todaPaleta(reg, semUso);
  assert.ok(p.length > 0, 'sem contagem nenhuma, a paleta não pode ficar vazia');
  assert.ok(p.some(i => i.cls === 'TButton'), p.map(i => i.cls).join(','));
  assert.equal(montarPaleta(reg, semUso).length, 0,
    'a lista "no projeto" é que fica vazia — e é ela que a aba inicial mostra');
});

test('base de herança não entra: TCustom* e TAbstract* não vão na paleta do Delphi', () => {
  const nomes = todaPaleta(reg, contagem).map(i => i.cls);
  assert.ok(!nomes.some(n => /^T(Custom|Abstract|Base)[A-Z]/.test(n)), 
    nomes.filter(n => /^T(Custom|Abstract|Base)[A-Z]/.test(n)).join(','));
});

test('tamanho padrão sai da família do componente', () => {
  assert.deepEqual(padraoDe('btn').w, 75);
  assert.deepEqual(padraoDe('edit').h, 21);
  assert.ok(padraoDe('grid').w > 200);
  assert.ok(padraoDe('misc').w >= 0, 'tipo desconhecido não pode quebrar');
});

// ---- uses ----

function aplicar(texto: string, edicoes: { linha: number; kind: string; texto: string }[]): string {
  const linhas = texto.split('\n');
  for (const e of edicoes.filter(e => e.kind === 'replace')) { linhas[e.linha] = e.texto; }
  const ins = edicoes.filter(e => e.kind === 'insert').sort((a, b) => b.linha - a.linha);
  const agrupado = new Map<number, string[]>();
  for (const e of ins) { agrupado.set(e.linha, [e.texto, ...(agrupado.get(e.linha) ?? [])]); }
  for (const [linha, textos] of [...agrupado].sort((a, b) => b[0] - a[0])) {
    linhas.splice(linha, 0, ...textos.join(String.fromCharCode(10)).split(String.fromCharCode(10)));
  }
  return linhas.join('\n');
}

const UMA_POR_LINHA = `unit U;

interface

uses
  Vcl.Forms,
  Vcl.StdCtrls;

type
  TF = class(TForm)
  end;

implementation

end.
`;

const LISTA_CORRIDA = `unit U;

interface

uses Vcl.Forms, Vcl.StdCtrls;

implementation

end.
`;

test('acrescenta a unit mantendo uma por linha', () => {
  const novo = aplicar(UMA_POR_LINHA, garantirUses(UMA_POR_LINHA, 'cxButtons'));
  assert.match(novo, /Vcl\.StdCtrls,\r?\n\s+cxButtons;/, novo);
  // o ponto e vírgula tem de sair da linha anterior
  assert.ok(!/Vcl\.StdCtrls;/.test(novo), novo);
});

test('acrescenta na lista corrida sem quebrar a linha', () => {
  const novo = aplicar(LISTA_CORRIDA, garantirUses(LISTA_CORRIDA, 'cxGrid'));
  assert.match(novo, /uses Vcl\.Forms, Vcl\.StdCtrls, cxGrid;/, novo);
});

test('unit já declarada não é duplicada', () => {
  assert.deepEqual(garantirUses(UMA_POR_LINHA, 'Vcl.StdCtrls'), []);
  assert.deepEqual(garantirUses(UMA_POR_LINHA, 'vcl.stdctrls'), [],
    'a comparação ignora caixa, como o compilador');
});

test('unit sem cláusula uses ganha uma', () => {
  const semUses = 'unit U;\n\ninterface\n\ntype\n  TF = class(TForm)\n  end;\n\nimplementation\n\nend.\n';
  const novo = aplicar(semUses, garantirUses(semUses, 'cxButtons'));
  assert.match(novo, /interface\r?\n\r?\nuses\r?\n\s+cxButtons;/, novo);
  // e a unit continua válida: o type vem depois
  assert.ok(novo.indexOf('uses') < novo.indexOf('type'), novo);
});

test('só mexe no uses da interface, não no da implementation', () => {
  const comDois = `unit U;

interface

uses
  Vcl.Forms;

implementation

uses
  cxButtons;

end.
`;
  // cxButtons está no uses da implementation, mas falta no da interface
  const ed = garantirUses(comDois, 'cxButtons');
  assert.ok(ed.length > 0, 'precisa acrescentar na interface mesmo já estando embaixo');
  const novo = aplicar(comDois, ed);
  assert.match(novo, /uses\r?\n\s+Vcl\.Forms, cxButtons;|Vcl\.Forms,\r?\n\s+cxButtons;/, novo);
});
