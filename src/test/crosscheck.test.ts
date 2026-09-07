/**
 * O cruzamento `.dfm` × `.pas`, e por que ele estava gritando errado.
 *
 * Medido nos 341 pares do projeto de teste: a versão que o usuário viu produzia **8.158 avisos de erro
 * num código que compila e roda**. Depois destas regras, 3 — e os 3 são achados reais.
 *
 * As duas afirmações que a mensagem antiga fazia foram conferidas com o compilador, não
 * deduzidas. Um `.dpr` de console criando um form cujo `.dfm` tem um componente sem campo e
 * um `OnClick` para um método inexistente imprimiu:
 *
 *   carregou. componentes: 2
 *     [0] BotaoDeclarado: TButton
 *     [1] BotaoSemCampo: TButton
 *
 * O form carrega nos dois casos. "o form vai falhar ao carregar" era falso.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDfm } from '../dfm/parser';
import { parsePascal, crossCheck, componentesQueExigemCampo } from '../dfm/pascal';
import { DfmNode } from '../dfm/model';

const NL = '\n';
/**
 * No teste, visual é o que o nome diz. Em produção quem responde é o `Registry`, subindo a
 * herança até `TControl` — a lista aqui existe só para o teste não precisar de um índice.
 */
const ehVisual = (cls: string): boolean =>
  /^T(cx|dx|frame)?(Form|Frame|Panel|GroupBox|Button|Edit|PageControl|TabSheet|LayoutControl|Grid)/i
    .test(cls);

const nomes = (raiz: DfmNode): string[] =>
  componentesQueExigemCampo(raiz, ehVisual).map(c => c.nome);

test('nó `inherited` é do ancestral e não exige campo aqui', () => {
  /*
   * 332 dos 341 forms do projeto de teste começam com `inherited`. Cobrar campo dos nós herdados dava
   * 5.756 avisos falsos — foi o que apareceu no ConsultaView.dfm.
   */
  const dfm = parseDfm([
    'inherited FormFilho: TFormFilho',
    '  inherited Panel1: TPanel',
    '    object BotaoNovo: TButton',
    '    end',
    '  end',
    'end',
  ].join(NL), 'x.dfm')!;
  assert.deepEqual(nomes(dfm), ['BotaoNovo'],
    'o Panel1 vem do ancestral; o botão acrescentado aqui é que precisa de campo');
});

test('conteúdo de um `inline` pertence à classe do frame', () => {
  const dfm = parseDfm([
    'object Form1: TForm1',
    '  inline FrameX: TFrameX',
    '    inherited Botao: TButton',
    '    end',
    '    object DoFrame: TEdit',
    '    end',
    '  end',
    'end',
  ].join(NL), 'x.dfm')!;
  assert.deepEqual(nomes(dfm), ['FrameX'],
    'a instância do frame precisa de campo; o que está dentro dela, não');
});

test('componente que faz o próprio streaming não gera campo no form', () => {
  /*
   * Os outros 2.402 avisos falsos estavam TODOS dentro de um `TfrxReport`: o FastReport é
   * dono dos filhos dele. O sinal geral é o pai não ser um controle visual — um
   * `TdxLayoutControl` é, e por isso os itens dele continuam sendo cobrados.
   */
  const dfm = parseDfm([
    'object Form1: TForm1',
    '  object frxReport: TfrxReport',
    '    object Pagina: TfrxReportPage',
    '      object Memo1: TfrxMemoView',
    '      end',
    '    end',
    '  end',
    '  object LayoutControl: TdxLayoutControl',
    '    object LayoutItem1: TdxLayoutItem',
    '    end',
    '  end',
    'end',
  ].join(NL), 'x.dfm')!;
  assert.deepEqual(nomes(dfm), ['frxReport', 'LayoutControl', 'LayoutItem1'],
    'o report precisa de campo; o conteúdo dele não. O item de layout precisa.');
});

test('a mensagem não promete uma falha que não acontece', () => {
  const dfm = parseDfm([
    'object Form1: TForm1', '  object Orfao: TButton', '  end', 'end',
  ].join(NL), 'x.dfm')!;
  const pas = ['unit U;', 'interface', 'type', '  TForm1 = class(TForm)', '  end;',
               'implementation', 'end.', ''].join(NL);
  const issues = crossCheck(parsePascal(pas, 'TForm1'),
    componentesQueExigemCampo(dfm, ehVisual), []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severidade, 'warning', 'o form carrega: não é erro');
  assert.ok(!/vai falhar ao carregar/.test(issues[0].mensagem));
  assert.match(issues[0].mensagem, /nenhum código consegue chamá-lo pelo nome/);
});

test('campo que casa com componente herdado não vira aviso', () => {
  /*
   * A checagem inversa precisa da lista COMPLETA de nomes do `.dfm`, não só dos que exigem
   * campo — senão filtrar os herdados criaria um falso positivo do outro lado.
   */
  const pas = ['unit U;', 'interface', 'type', '  TFormFilho = class(TFormPai)',
               '    Panel1: TPanel;', '  end;', 'implementation', 'end.', ''].join(NL);
  const unit = parsePascal(pas, 'TFormFilho');
  const semLista = crossCheck(unit, [], []);
  assert.equal(semLista.filter(i => /não existe no .dfm/.test(i.mensagem)).length, 1);
  const comLista = crossCheck(unit, [], [], { todosOsNomes: ['Panel1'] });
  assert.equal(comLista.filter(i => /não existe no .dfm/.test(i.mensagem)).length, 0);
});

test('método abstract não é cobrado: não tem corpo por definição', () => {
  const pas = ['unit U;', 'interface', 'type', '  TFoo = class(TForm)',
               '    function TipoDocumento: string; virtual; abstract;',
               '    procedure Concreto;',
               '  end;', 'implementation', 'end.', ''].join(NL);
  const semCorpo = parsePascal(pas, 'TFoo').metodos.filter(m => !m.implementado);
  assert.deepEqual(semCorpo.map(m => m.nome), ['Concreto']);
});

test('sobrecarga: uma implementação satisfaz todas as declarações do nome', () => {
  const pas = ['unit U;', 'interface', 'type', '  TFoo = class(TForm)',
               '    procedure Fazer(const A: Integer); overload;',
               '    procedure Fazer(const B: string); overload;',
               '  end;', 'implementation',
               'procedure TFoo.Fazer(const A: Integer);', 'begin', 'end;',
               'procedure TFoo.Fazer(const B: string);', 'begin', 'end;',
               'end.', ''].join(NL);
  assert.deepEqual(parsePascal(pas, 'TFoo').metodos.filter(m => !m.implementado), []);
});

test('parâmetro de declaração multi-linha não vira campo do form', () => {
  /*
   * `AButton: TMouseButton` na continuação de um cabeçalho virava componente: 31 avisos de
   * "declarado mas não existe no .dfm" nos forms do projeto de teste, todos falsos.
   */
  const pas = ['unit U;', 'interface', 'type', '  TFoo = class(TForm)',
               '    Botao: TButton;',
               '    procedure Clicou(Sender: TObject;',
               '      AButton: TMouseButton; AShift: TShiftState);',
               '  end;', 'implementation', 'end.', ''].join(NL);
  assert.deepEqual(parsePascal(pas, 'TFoo').campos.map(c => c.nome), ['Botao']);
});

test('implementação com o nome na linha seguinte conta como implementada', () => {
  const pas = ['unit U;', 'interface', 'type', '  TFoo = class(TForm)',
               '    procedure NomeQueNaoCabeNaMargemDaLinha(Sender: TObject);',
               '  end;', 'implementation',
               'procedure',
               '  TFoo.NomeQueNaoCabeNaMargemDaLinha(Sender: TObject);',
               'begin', 'end;', 'end.', ''].join(NL);
  assert.deepEqual(parsePascal(pas, 'TFoo').metodos.filter(m => !m.implementado), []);
});
