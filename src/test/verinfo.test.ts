/**
 * Ícone e version info no `.dproj`. O teste que importa é o de não achatar: o arquivo repete
 * `VerInfo_Keys` por configuração, com conteúdo diferente, e copiar a primeira por cima das
 * outras apaga a diferença sem avisar.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  analisarVersao, escreverChaves, gravar, gravarVersao, incrementarBuild, ler, lerChaves,
  lerVersao, mapear, textoVersao,
} from '../dfm/verinfo';

const DPROJ = [
  '<Project>',
  '    <PropertyGroup Condition="\'$(Config)\'==\'Base\' or \'$(Base)\'!=\'\'">',
  '        <VerInfo_Keys>CompanyName=;FileVersion=1.0.0.0;FileDescription=App</VerInfo_Keys>',
  '        <Icon_MainIcon>$(BDS)\bin\delphi_PROJECTICON.ico</Icon_MainIcon>',
  '    </PropertyGroup>',
  '    <PropertyGroup Condition="\'$(Cfg_2)\'!=\'\'">',
  '        <VerInfo_Keys>CompanyName=;FileVersion=1.0.0.0</VerInfo_Keys>',
  '    </PropertyGroup>',
  '</Project>',
].join('\n');

test('chaves vão e voltam sem perder valor vazio nem ordem', () => {
  const c = lerChaves('A=1;B=;C=x=y');
  assert.equal(c.get('B'), '');
  assert.equal(c.get('C'), 'x=y');
  assert.equal(escreverChaves(c), 'A=1;B=;C=x=y');
});

test('gravar troca todas as ocorrências: o Release não pode ficar para trás', () => {
  const xml = '<a><P>1</P><P>1</P></a>';
  assert.equal(gravar(xml, 'P', '2'), '<a><P>2</P><P>2</P></a>');
});

test('propriedade ausente é criada no grupo Base', () => {
  const fora = gravar(DPROJ, 'VerInfo_Build', '7');
  assert.match(fora, /<VerInfo_Build>7<\/VerInfo_Build>/);
  // e no grupo certo: antes do fecha do primeiro PropertyGroup
  assert.ok(fora.indexOf('<VerInfo_Build>') < fora.indexOf('</PropertyGroup>'));
});

test('mapear reescreve cada ocorrência a partir dela mesma', () => {
  const fora = mapear(DPROJ, 'VerInfo_Keys', a => `${a};Novo=1`);
  const todas = fora.match(/<VerInfo_Keys>[^<]*/g)!;
  assert.ok(todas[0].includes('FileDescription=App'), 'a primeira mantém o que só ela tinha');
  assert.ok(!todas[1].includes('FileDescription'), 'a segunda não herda o que não era dela');
  assert.ok(todas.every(t => t.endsWith(';Novo=1')));
});

test('gravar a versão sincroniza FileVersion sem achatar as configurações', () => {
  const fora = gravarVersao(DPROJ, { major: 2, minor: 1, release: 0, build: 5 });
  const todas = fora.match(/<VerInfo_Keys>[^<]*/g)!;
  assert.ok(todas.every(t => t.includes('FileVersion=2.1.0.5')));
  assert.equal(new Set(todas).size, 2, 'as duas configurações continuam diferentes');
  assert.equal(textoVersao(lerVersao(fora)), '2.1.0.5');
});

test('incrementar mexe só no build', () => {
  assert.deepEqual(incrementarBuild({ major: 1, minor: 2, release: 3, build: 4 }),
    { major: 1, minor: 2, release: 3, build: 5 });
});

test('versão inválida é recusada, e parcial completa com zero', () => {
  assert.equal(analisarVersao('1.2.x'), undefined);
  assert.equal(analisarVersao('1.2.3.4.5'), undefined);
  assert.deepEqual(analisarVersao('3.1'), { major: 3, minor: 1, release: 0, build: 0 });
});

test('o ícone é lido e trocado', () => {
  assert.match(ler(DPROJ, 'Icon_MainIcon')!, /delphi_PROJECTICON/);
  assert.match(gravar(DPROJ, 'Icon_MainIcon', 'res\app.ico'),
    /<Icon_MainIcon>res\app\.ico<\/Icon_MainIcon>/);
});
