/**
 * Descoberta de testes DUnitX e leitura do resultado.
 *
 * Os dois lados foram conferidos contra o projeto real: a descoberta encontra 686 testes em
 * 50 fixtures nos `.pas` de `lib/tests` do projeto de teste, e a leitura do `dunitx-results.xml` de uma
 * execução verdadeira devolve os 618 casos que o cabeçalho do arquivo declara.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { descobrirTestes, lerResultados, resumo } from '../dfm/dunitx';

const NL = '\n';
const nomes = (src: string): string[] =>
  descobrirTestes(src, 'X.pas').map(t => `${t.fixture}.${t.nome}`);

test('estilo explícito: [Test] antes de cada método', () => {
  const src = [
    'unit X;', 'interface', 'type',
    '  [TestFixture]', '  TFooTests = class', '  public',
    '    [Setup]', '    procedure Preparar;',
    '    [Test]', '    procedure Somar;',
    '    [Test]', '    procedure Subtrair;',
    '    procedure NaoMarcado;',
    '  end;', 'implementation', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), ['TFooTests.Somar', 'TFooTests.Subtrair', 'TFooTests.NaoMarcado'],
    'em public sem atributo o DUnitX ainda pega por RTTI');
  assert.ok(!nomes(src).includes('TFooTests.Preparar'), '[Setup] é preparação, não teste');
});

test('estilo implícito: só [TestFixture], e todo published é teste', () => {
  /*
   * É o estilo do projeto de teste. Cobrir só o explícito achava ZERO testes num projeto com 618 —
   * o primeiro resultado desta implementação, antes de olhar um arquivo real.
   */
  const src = [
    'unit X;', 'interface', 'type',
    '  [TestFixture]', '  TValidadorTests = class',
    '  private', '    FInterno: Integer;',
    '  published',
    '    procedure Valido_CPFValido_Validar;',
    '    procedure Valido_NumerosIguais_NaoValidar;',
    '  end;', 'implementation', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), [
    'TValidadorTests.Valido_CPFValido_Validar',
    'TValidadorTests.Valido_NumerosIguais_NaoValidar',
  ]);
});

test('campo de private não vira teste', () => {
  const src = [
    'unit X;', 'interface', 'type',
    '  [TestFixture]', '  TFooTests = class',
    '  private', '    procedure Auxiliar;',
    '  published', '    procedure Real;',
    '  end;', 'implementation', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), ['TFooTests.Real']);
});

test('RegisterTestFixture vale como marcação de fixture', () => {
  /*
   * Um teste real do projeto marca a classe com `[TestCase]` em vez de `[TestFixture]` e
   * roda assim mesmo — porque quem manda é a chamada de registro, não o atributo.
   */
  const src = [
    'unit X;', 'interface', 'type',
    '  [TestCase]', '  TCompressaoTests = class',
    '  published', '    procedure ZiparArquivo;',
    '  end;', 'implementation', 'initialization',
    '  TDUnitX.RegisterTestFixture(TCompressaoTests);', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), ['TCompressaoTests.ZiparArquivo']);
});

test('classe sem marcação nenhuma não entra', () => {
  const src = [
    'unit X;', 'interface', 'type',
    '  TAjudante = class', '  published', '    procedure Fazer;', '  end;',
    'implementation', 'end.', '',
  ].join(NL);
  assert.deepEqual(nomes(src), []);
});

test('[TestCase] guarda o nome do caso', () => {
  const src = [
    'unit X;', 'interface', 'type',
    '  [TestFixture]', '  TFooTests = class', '  public',
    "    [TestCase('Positivo', '1,2,3')]",
    "    [TestCase('Negativo', '-1,-2,-3')]",
    '    procedure Somar(A, B, Esperado: Integer);',
    '  end;', 'implementation', 'end.', '',
  ].join(NL);
  const t = descobrirTestes(src, 'X.pas');
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].casos, ['Positivo', 'Negativo']);
});

/* ---- leitura do XML ---- */

const XML = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
  '<test-results name="T.exe" total="3">',
  '  <test-suite type="Assembly" name="T.exe">',
  '    <results>',
  '      <test-suite type="Namespace" name="FooTests">',
  '        <results>',
  '          <test-suite type="Fixture" name="TFooTests">',
  '            <results>',
  '              <test-case name="Passa" executed="True" result="Success" success="True" time="0.010" />',
  '              <test-case name="Falha" executed="True" result="Failure" success="False" time="0.020">',
  '                <failure><message>Expected 1 but got 2</message></failure>',
  '              </test-case>',
  '              <test-case name="Pulado" executed="False" result="Ignored" success="False" time="0.000" />',
  '            </results>',
  '          </test-suite>',
  '        </results>',
  '      </test-suite>',
  '    </results>',
  '  </test-suite>',
  '</test-results>',
].join(NL);

test('cada caso volta com fixture, resultado, tempo e mensagem', () => {
  const r = lerResultados(XML);
  assert.equal(r.length, 3);
  assert.ok(r.every(x => x.fixture === 'TFooTests'),
    'o fixture vem do test-suite mais próximo ANTES do caso');
  assert.deepEqual(r.map(x => x.nome), ['Passa', 'Falha', 'Pulado']);
  assert.deepEqual(r.map(x => x.passou), [true, false, false]);
  assert.deepEqual(r.map(x => x.executado), [true, true, false]);
  assert.equal(r[1].mensagem, 'Expected 1 but got 2');
  assert.equal(r[0].tempo, 0.01);
});

test('caso que passou não inventa mensagem', () => {
  assert.equal(lerResultados(XML)[0].mensagem, undefined);
});

test('o resumo separa passou, falhou e não executado', () => {
  assert.equal(resumo(lerResultados(XML)),
    '1 passaram, 1 falharam, 1 não executados em 0.03s');
});

test('entidade e CDATA da mensagem voltam como texto', () => {
  const xml = XML.replace('<message>Expected 1 but got 2</message>',
    '<message><![CDATA[Esperava <a> &amp; achou &quot;b&quot;]]></message>');
  assert.equal(lerResultados(xml)[1].mensagem, 'Esperava <a> & achou "b"');
});

test('XML vazio ou truncado não lança', () => {
  assert.deepEqual(lerResultados(''), []);
  assert.deepEqual(lerResultados('<test-results total="0"></test-results>'), []);
});
