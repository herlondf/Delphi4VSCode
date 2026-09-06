/**
 * Class Completion.
 *
 * A referência não é a documentação, é o `dcc32`: o corpo gerado aqui foi compilado de
 * verdade antes destes testes existirem. As regras de diretiva vieram de perguntar caso a
 * caso ao compilador — e ele desmentiu o palpite mais óbvio, o de que `overload` se repete.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { metodosPendentes, completarClasse, corpoDoMetodo } from '../dfm/classcomp';

const NL = '\n';
const unit = (...corpo: string[]): string => [
  'unit T;', '', 'interface', '', 'type', ...corpo, '', 'implementation', '', 'end.', '',
].join(NL);

const nomes = (src: string): string[] =>
  metodosPendentes(src).map(m => `${m.prefixo}${m.classe}.${m.nome}`);

test('gera só o que está declarado e sem corpo', () => {
  const src = [
    'unit T;', 'interface', 'type', '  TFoo = class',
    '    procedure Feito;', '    procedure Faltando;', '  end;',
    'implementation', 'procedure TFoo.Feito;', 'begin', 'end;', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), ['TFoo.Faltando']);
});

test('duas classes com método de mesmo nome não se confundem', () => {
  const src = [
    'unit T;', 'interface', 'type',
    '  TFoo = class', '    procedure Executar;', '  end;',
    '  TBar = class', '    procedure Executar;', '  end;',
    'implementation', 'procedure TFoo.Executar;', 'begin', 'end;', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), ['TBar.Executar']);
});

test('método de classe é reconhecido, e não engole o resto da classe', () => {
  /*
   * `class function` casava com a regex de "abre bloco" e empurrava um bloco fantasma na
   * pilha: do primeiro método de classe em diante, nenhum outro método aparecia.
   */
  const src = unit(
    '  TFoo = class',
    '    class function Instancia: TFoo;',
    '    class procedure Limpar;',
    '    procedure Depois;',
    '  end;');
  assert.deepEqual(nomes(src),
    ['class TFoo.Instancia', 'class TFoo.Limpar', 'TFoo.Depois']);
});

test('abstract não ganha corpo: seria erro de compilação', () => {
  const src = unit('  TFoo = class',
    '    procedure Abstrato; virtual; abstract;',
    '    procedure Concreto;',
    '  end;');
  assert.deepEqual(nomes(src), ['TFoo.Concreto']);
});

test('método de interface não ganha corpo', () => {
  const src = unit('  IAlgo = interface', '    procedure NaoGerar;', '  end;');
  assert.deepEqual(nomes(src), []);
});

test('record dentro da unit não vira classe', () => {
  const src = unit(
    '  TBar = record', '    Campo: Integer;', '    procedure Metodo;', '  end;',
    '  TFoo = class', '    procedure Real;', '  end;');
  assert.deepEqual(nomes(src), ['TFoo.Real']);
});

test('assinatura em mais de uma linha vem inteira', () => {
  const src = unit('  TFoo = class',
    '    function Longo(const A: Integer;',
    '      const B: string): Boolean;',
    '  end;');
  const m = metodosPendentes(src)[0];
  assert.equal(m.assinatura, 'function Longo(const A: Integer; const B: string): Boolean');
});

test('o corpo leva a classe no nome e o Result tipado', () => {
  const src = unit('  TFoo = class', '    function Calcular: Double;', '  end;');
  const corpo = corpoDoMetodo(metodosPendentes(src)[0], NL);
  assert.match(corpo, /^\nfunction TFoo\.Calcular: Double;\nbegin\n {2}Result := Default\(Double\);\nend;$/);
});

test('procedure não ganha Result', () => {
  const src = unit('  TFoo = class', '    procedure Fazer;', '  end;');
  assert.ok(!corpoDoMetodo(metodosPendentes(src)[0], NL).includes('Result'));
});

/*
 * O compilador respondeu, caso a caso:
 *   stdcall cdecl safecall register pascal  -> ok
 *   overload inline                         -> E1030
 *   virtual reintroduce static              -> E2070
 */
test('convenção de chamada se repete no corpo', () => {
  const src = unit('  TFoo = class', '    procedure Externa(A: Integer); stdcall;', '  end;');
  assert.match(corpoDoMetodo(metodosPendentes(src)[0], NL), /stdcall;/);
});

test('overload NÃO se repete: no corpo é E1030', () => {
  const src = unit('  TFoo = class', '    procedure Fazer(A: Integer); overload;', '  end;');
  assert.ok(!corpoDoMetodo(metodosPendentes(src)[0], NL).includes('overload'));
});

test('virtual, override, static e inline não se repetem', () => {
  for (const d of ['virtual', 'override', 'static', 'inline', 'reintroduce']) {
    const src = unit('  TFoo = class', `    procedure Fazer(A: Integer); ${d};`, '  end;');
    const corpo = corpoDoMetodo(metodosPendentes(src)[0], NL);
    assert.ok(!corpo.includes(d), `${d} vazou para o corpo: ${corpo}`);
  }
});

test('parâmetro com o mesmo nome do método não confunde a troca', () => {
  const src = unit('  TFoo = class', '    procedure Nome(const Nome: string);', '  end;');
  const corpo = corpoDoMetodo(metodosPendentes(src)[0], NL);
  assert.match(corpo, /procedure TFoo\.Nome\(const Nome: string\);/);
});

test('a inserção vai antes do end. que fecha a unit', () => {
  const src = unit('  TFoo = class', '    procedure Fazer;', '  end;');
  const r = completarClasse(src, NL)!;
  assert.equal(src.split(NL)[r.linha], 'end.');
});

test('unit sem pendência não devolve edição nenhuma', () => {
  const src = [
    'unit T;', 'interface', 'type', '  TFoo = class', '    procedure Feito;', '  end;',
    'implementation', 'procedure TFoo.Feito;', 'begin', 'end;', 'end.', '',
  ].join(NL);
  assert.equal(completarClasse(src, NL), undefined);
});

test('comentário e diretiva de compilação não viram declaração', () => {
  const src = unit('  TFoo = class',
    '    // procedure Comentada;',
    '    {$IFDEF DEBUG}',
    '    procedure SoNoDebug;',
    '    {$ENDIF}',
    '    { procedure EmBloco; }',
    '  end;');
  assert.deepEqual(nomes(src), ['TFoo.SoNoDebug']);
});

/*
 * Os dois casos abaixo saíram de varrer os 810 `.pas` do projeto de teste: eram os únicos 3 arquivos
 * que acusavam pendência num código que compila. Depois de corrigidos, zero.
 */
test('`class of` é referência de classe e não abre corpo nenhum', () => {
  const src = [
    'unit T;', 'interface', 'type',
    '  TFoo = class', '    procedure Metodo;', '  end;',
    '  TFooClass = class of TFoo;', '',
    'function FuncaoSolta: TFoo;', '',
    'implementation',
    'procedure TFoo.Metodo;', 'begin', 'end;',
    'function FuncaoSolta: TFoo;', 'begin', 'end;', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), [],
    'função solta da interface não pode virar método da classe anterior');
});

test('implementação com o nome na linha seguinte conta como implementada', () => {
  const src = [
    'unit T;', 'interface', 'type', '  TFoo = class',
    '    procedure NomeMuitoLongoQueNaoCabeNaMargemDaLinha(Sender: TObject);', '  end;',
    'implementation',
    'procedure',
    '  TFoo.NomeMuitoLongoQueNaoCabeNaMargemDaLinha(',
    '  Sender: TObject);', 'begin', 'end;', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), []);
});
