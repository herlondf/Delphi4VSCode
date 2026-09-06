/**
 * De onde saem as pastas a indexar.
 *
 * Perguntar isso ao usuário era a pergunta errada: o search path já está no `.dproj`, e o
 * Library/Browsing Path já está no `EnvOptions.proj` que o próprio IDE mantém. O que este
 * teste guarda é o que dá errado ao juntar as duas listas — variável do MSBuild não
 * resolvida, pasta que não existe, pasta só de `.dcu`, e pasta contida em outra.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ambienteDe, descobrirFontes, expandirVars, semSubpastas, temFontes } from '../dfm/sources';

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi4vscode-fontes-'));

function criar(rel: string, arquivos: string[] = []): string {
  const dir = path.join(RAIZ, ...rel.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  for (const a of arquivos) { fs.writeFileSync(path.join(dir, a), 'unit X;'); }
  return dir;
}

criar('proj', []);
criar('proj/lib', ['A.pas']);
criar('proj/vendor/dx/source', ['cxButtons.pas']);
criar('proj/vendor/dx/source/extra', ['B.pas']);
criar('proj/bin', ['nada.dcu']);
criar('bds/source/vcl', ['Vcl.Forms.pas']);
criar('bds/bin', []);

const DPROJ = path.join(RAIZ, 'proj', 'Meu.dproj');
fs.writeFileSync(DPROJ,
  '<Project><PropertyGroup><DCC_UnitSearchPath>' +
  'lib;vendor\\dx\\source;vendor\\dx\\source\\extra;bin;naoexiste;$(Vazia)\\x' +
  '</DCC_UnitSearchPath></PropertyGroup></Project>');

test('as variáveis do MSBuild são resolvidas, e a caixa não importa', () => {
  const amb = ambienteDe('C:\\Delphi\\22.0\\bin', 'Win64');
  assert.equal(expandirVars('$(BDS)\\source', amb), 'C:\\Delphi\\22.0\\source');
  assert.equal(expandirVars('$(PLATFORM)', amb), 'Win64', 'o Delphi escreve nas duas caixas');
  assert.equal(expandirVars('$(Platform)', amb), 'Win64');
  assert.equal(expandirVars('$(BDSLIB)\\$(Platform)', amb), 'C:\\Delphi\\22.0\\lib\\Win64');
});

test('variável desconhecida não vira caminho inventado', () => {
  const r = descobrirFontes({ dproj: DPROJ });
  assert.ok(r.ignorados.some(i => i.motivo === 'variável não resolvida'),
    JSON.stringify(r.ignorados));
  assert.ok(!r.fontes.some(f => f.dir.includes('$(')), 'nenhuma fonte pode ter marcador cru');
});

test('pasta sem .pas fica de fora — indexar .dcu não acrescenta nada', () => {
  assert.equal(temFontes(path.join(RAIZ, 'proj', 'bin')), false);
  assert.equal(temFontes(path.join(RAIZ, 'proj', 'lib')), true);
  // e acha .pas um nível abaixo, que é o caso de vendor/x/source
  assert.equal(temFontes(path.join(RAIZ, 'bds')), true);
});

test('pasta que não existe é registrada, não silenciada', () => {
  const r = descobrirFontes({ dproj: DPROJ });
  assert.ok(r.ignorados.some(i => i.motivo === 'não existe' && /naoexiste/.test(i.dir)),
    JSON.stringify(r.ignorados));
});

test('subpasta de outra já listada sai da lista', () => {
  const pai = { dir: 'C:\\a\\b', origem: 'projeto' as const };
  const filha = { dir: 'C:\\a\\b\\c', origem: 'projeto' as const };
  const outra = { dir: 'C:\\a\\d', origem: 'projeto' as const };
  const fora = { dir: 'C:\\a\\bc', origem: 'projeto' as const };
  const r = semSubpastas([pai, filha, outra, fora]);
  assert.deepEqual(r.map(f => f.dir), ['C:\\a\\b', 'C:\\a\\d', 'C:\\a\\bc'],
    'C:\\a\\bc não é subpasta de C:\\a\\b, apesar do prefixo');
});

test('o search path do projeto vira uma raiz só, sem varrer nada duas vezes', () => {
  const r = descobrirFontes({ dproj: DPROJ });
  const dirs = r.fontes.map(f => f.dir);
  // lib, vendor e o resto estão todos dentro da pasta do .dproj: uma raiz cobre tudo
  assert.deepEqual(dirs, [path.join(RAIZ, 'proj')], dirs.join(' | '));
  const cobertas = r.ignorados.filter(i => i.motivo.startsWith('já coberta')).map(i => i.dir);
  assert.ok(cobertas.some(d => d.endsWith(path.join('proj', 'lib'))), cobertas.join(' | '));
  // e nenhuma raiz é prefixo de outra: é isso que garante uma leitura por arquivo
  for (const a of dirs) {
    for (const b of dirs) {
      if (a !== b) { assert.ok(!b.startsWith(a + path.sep), `${b} está dentro de ${a}`); }
    }
  }
});

test('pasta fora da árvore do projeto entra por conta própria', () => {
  const foraDir = criar('externo/comum', ['C.pas']);
  const r = descobrirFontes({ dproj: DPROJ, configurados: [foraDir] });
  const dirs = r.fontes.map(f => f.dir);
  assert.ok(dirs.includes(foraDir), dirs.join(' | '));
  assert.ok(dirs.includes(path.join(RAIZ, 'proj')), dirs.join(' | '));
});

test('a instalação entra pelo source, e a origem de cada pasta fica registrada', () => {
  const r = descobrirFontes({ dproj: DPROJ, bdsBin: path.join(RAIZ, 'bds', 'bin') });
  const inst = r.fontes.find(f => f.origem === 'instalacao');
  assert.ok(inst, JSON.stringify(r.fontes));
  assert.ok(inst!.dir.endsWith('source'), inst!.dir);
  assert.ok(r.fontes.every(f => f.origem), 'toda fonte precisa dizer de onde veio');
});

test('o que o usuário configurou é lido antes do resto', () => {
  const soLib = criar('avulso', ['D.pas']);
  const r = descobrirFontes({ configurados: [soLib], workspace: [path.join(RAIZ, 'proj')] });
  assert.equal(r.fontes[0].dir, soLib, 'o configurado vem primeiro na lista');
  assert.equal(r.fontes[0].origem, 'configurado');
});

test('sem projeto e sem Delphi, ainda sobra o workspace', () => {
  const r = descobrirFontes({ workspace: [path.join(RAIZ, 'proj')] });
  assert.equal(r.fontes.length, 1);
  assert.equal(r.fontes[0].origem, 'workspace');
});
