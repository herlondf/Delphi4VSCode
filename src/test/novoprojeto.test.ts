/**
 * Criar projeto e unit do zero.
 *
 * O `.dproj` gerado aqui foi compilado de verdade com o MSBuild do Delphi 11 antes destes
 * testes existirem — console e VCL com form, os dois passaram. O que os testes travam é o
 * formato: um `.dproj` que abre mas perde Debug/Release, ou um `.dpr` que não cria o form,
 * falha em silêncio e só aparece na hora de compilar.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { novoProjeto, guidDe, unitSimples } from '../dfm/novoProjeto';

const arquivo = (r: ReturnType<typeof novoProjeto>, ext: string): string =>
  r.arquivos.find(a => a.nome.endsWith(ext))!.conteudo;

test('o GUID sai do nome: gerar o mesmo projeto duas vezes dá o mesmo arquivo', () => {
  assert.equal(guidDe('MeuApp'), guidDe('MeuApp'));
  assert.notEqual(guidDe('MeuApp'), guidDe('OutroApp'));
  assert.match(guidDe('MeuApp'), /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/);
});

test('VCL nasce com o form no uses e no CreateForm', () => {
  const r = novoProjeto({ nome: 'MeuApp', tipo: 'vcl',
    form: { unit: 'PrincipalView', classe: 'TFormPrincipalView', variavel: 'FormPrincipalView' } });
  const dpr = arquivo(r, '.dpr');
  assert.match(dpr, /PrincipalView in 'PrincipalView\.pas' \{FormPrincipalView\}/);
  assert.match(dpr, /Application\.CreateForm\(TFormPrincipalView, FormPrincipalView\)/);
  assert.match(dpr, /Application\.Run;/);
  // o .dproj precisa saber do form, ou a IDE não lista a tela no Project Manager
  assert.match(arquivo(r, '.dproj'), /<DCCReference Include="PrincipalView\.pas">/);
});

test('VCL sem form não deixa vírgula solta no uses', () => {
  const dpr = arquivo(novoProjeto({ nome: 'MeuApp', tipo: 'vcl' }), '.dpr');
  assert.match(dpr, /uses\r\n  Vcl\.Forms;/);
  assert.ok(!dpr.includes('CreateForm'), dpr);
});

test('console liga o APPTYPE e o alvo continua sendo .exe', () => {
  const r = novoProjeto({ nome: 'Cli', tipo: 'console' });
  assert.match(arquivo(r, '.dpr'), /\{\$APPTYPE CONSOLE\}/);
  assert.match(arquivo(r, '.dproj'), /<DCC_ConsoleTarget>true<\/DCC_ConsoleTarget>/);
  assert.equal(r.alvo, 'Cli.exe');
});

test('package gera .dpk, não .dpr, e alvo .bpl', () => {
  const r = novoProjeto({ nome: 'MeuPack', tipo: 'package' });
  assert.deepEqual(r.arquivos.map(a => a.nome), ['MeuPack.dpk', 'MeuPack.dproj']);
  assert.equal(r.alvo, 'MeuPack.bpl');
  assert.match(arquivo(r, '.dproj'), /<AppType>Package<\/AppType>/);
});

test('Debug e Release entram como configurações, que é o que a extensão lista', () => {
  const dproj = arquivo(novoProjeto({ nome: 'MeuApp', tipo: 'vcl' }), '.dproj');
  assert.match(dproj, /<BuildConfiguration Include="Debug"><Key>Cfg_1<\/Key>/);
  assert.match(dproj, /<BuildConfiguration Include="Release"><Key>Cfg_2<\/Key>/);
  assert.match(dproj, /'\$\(Cfg_1\)'!=''[\s\S]*DEBUG;\$\(DCC_Define\)/);
  assert.match(dproj, /'\$\(Cfg_2\)'!=''[\s\S]*RELEASE;\$\(DCC_Define\)/);
});

test('as plataformas pedidas viram grupo próprio', () => {
  const so32 = arquivo(novoProjeto({ nome: 'A', tipo: 'vcl', plataformas: ['Win32'] }), '.dproj');
  assert.ok(!so32.includes("'$(Platform)'=='Win64'"), 'Win64 não foi pedido');
  const ambos = arquivo(novoProjeto({ nome: 'A', tipo: 'vcl' }), '.dproj');
  assert.match(ambos, /'\$\(Platform\)'=='Win64'/);
});

test('nome inválido é recusado antes de escrever qualquer arquivo', () => {
  assert.throws(() => novoProjeto({ nome: '2Errado', tipo: 'vcl' }), /nome do projeto/);
  assert.throws(() => novoProjeto({ nome: 'com espaço', tipo: 'vcl' }), /nome do projeto/);
  assert.throws(() => unitSimples('9x'), /nome da unit/);
});

test('a unit simples compila sozinha: unit, interface, implementation e end.', () => {
  const u = unitSimples('Utilitarios');
  assert.match(u, /^unit Utilitarios;/);
  assert.match(u, /\binterface\b/);
  assert.match(u, /\bimplementation\b/);
  assert.match(u, /end\.\r\n$/);
  assert.ok(!u.includes('{$R'), 'unit sem form não tem recurso de form');
});
