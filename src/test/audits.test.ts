/**
 * Auditoria. O XML de exemplo é saída REAL do `AuditsCLI.exe` sobre um projeto do
 * repositório de teste — inventar o formato foi o que já fez um problem matcher passar nos
 * testes e nunca casar com nada na prática.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { argumentosAudits, lerAchados, raizDoProjeto } from '../dfm/audits';

const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<root>',
  '  <project path="D:\\p\\Exemplos\\" language="delphi" />',
  '  <audit audit-id="EVNU" inspector="audit" message="Expression value is not used"',
  '   severity="1" resource="X" url="Factory.pas" line="183" start="1" end="2" />',
  '  <audit audit-id="MANR" inspector="audit" message="Parameter can be null"',
  '   severity="1" resource="Create" url="Factory.pas" line="74" start="3" end="4">',
  '    <audit audit-id="MANR" inspector="audit" message="Null values is passed here"',
  '     severity="1" resource="Create" url="Factory.pas" line="74" start="3" end="4" />',
  '    <audit audit-id="MANR" inspector="audit" message="Dereferenced here"',
  '     severity="1" resource="Create" url="Outro.pas" line="12" start="5" end="6" />',
  '  </audit>',
  '  <audit audit-id="IR" inspector="audit" message="Infinite recursion"',
  '   severity="2" resource="Create" url="Factory.pas" line="74" start="7" end="8" />',
  '</root>',
].join('\n');

test('a raiz do projeto sai do XML, e os url são relativos a ela', () => {
  assert.equal(raizDoProjeto(XML), 'D:\\p\\Exemplos\\');
});

test('achado aninhado vira relacionado, não aviso separado', () => {
  const a = lerAchados(XML);
  assert.equal(a.length, 3, 'três no topo, não cinco');
  const manr = a.find(x => x.id === 'MANR')!;
  assert.equal(manr.relacionados.length, 2);
  assert.equal(manr.relacionados[1].arquivo, 'Outro.pas');
  assert.equal(manr.relacionados[1].linha, 12);
});

test('severidade e linha vêm como número', () => {
  const a = lerAchados(XML);
  assert.equal(a.find(x => x.id === 'IR')!.severidade, 2);
  assert.equal(a[0].linha, 183);
});

test('a configuração ativa é repassada, e o .dproj vai por último', () => {
  const args = argumentosAudits('P.dproj', 'saida.xml', 'Release');
  assert.deepEqual(args,
    ['--audits', '--xml', '-o', 'saida.xml', '--build-config=Release', 'P.dproj']);
  assert.equal(argumentosAudits('P.dproj', 's.xml').includes('--build-config='), false);
});

test('XML sem nenhum achado não inventa nada', () => {
  assert.deepEqual(lerAchados('<root><project path="" /></root>'), []);
});
