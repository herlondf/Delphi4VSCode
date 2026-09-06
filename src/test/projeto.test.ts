/**
 * Bloco E — o que a verificação do projeto acha, e o que ela conta.
 *
 * As duas coisas que quebram um projeto Delphi sem o compilador dizer nada de útil: unit no
 * `.dpr` apontando para arquivo que não existe, e `.pas` que declara `{$R *.dfm}` sem o form
 * ao lado. A segunda só aparece quando alguém abre a tela em produção.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dfmOrfaos, resumoDoProjeto, unitsDoDpr, verificarProjeto } from '../dfm/projeto';

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi4vscode-proj-'));
const CRLF = String.fromCharCode(13, 10);

function escrever(rel: string, linhas: string[]): string {
  const alvo = path.join(RAIZ, ...rel.split('/'));
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, linhas.join(CRLF), 'latin1');
  return alvo;
}

escrever('Principal.pas', ['unit Principal;', 'interface', 'implementation', '{$R *.dfm}', 'end.']);
escrever('Principal.dfm', ['object FormPrincipal: TFormPrincipal',
  '  object Grade: TDBGrid', '  end', '  object Botao: TButton', '  end', 'end']);
escrever('SemForm.pas', ['unit SemForm;', 'interface', 'implementation', '{$R *.dfm}', 'end.']);
escrever('NomeTrocado.pas', ['unit OutroNome;', 'interface', 'implementation', 'end.']);
escrever('Dados.pas', ['unit Dados;', 'interface', 'implementation', '{$R *.dfm}', 'end.']);
escrever('Dados.dfm', ['object Dm: TMeuDataModule', 'end']);
escrever('orfao/Perdido.dfm', ['object X: TForm', 'end']);

const DPR = escrever('Meu.dpr', [
  'program Meu;',
  'uses',
  "  Principal in 'Principal.pas' {FormPrincipal},",
  "  SemForm in 'SemForm.pas' {FormSem},",
  "  NomeTrocado in 'NomeTrocado.pas',",
  "  Dados in 'Dados.pas' {Dm: TDataModule},",
  "  Sumiu in 'Sumiu.pas',",
  "  Principal in 'Principal.pas';",
  'begin',
  'end.',
]);

test('as units do .dpr saem com arquivo e linha', () => {
  const us = unitsDoDpr(fs.readFileSync(DPR, 'latin1'));
  assert.equal(us.length, 6);
  assert.equal(us[0].unit, 'Principal');
  assert.equal(us[0].arquivo, 'Principal.pas');
  assert.ok(us[0].linha > 0, 'a linha serve para navegar do painel Problems');
});

test('unit apontando para arquivo inexistente é erro', () => {
  const a = verificarProjeto(DPR);
  const erro = a.find(x => x.mensagem.includes('Sumiu'));
  assert.ok(erro, JSON.stringify(a));
  assert.equal(erro!.gravidade, 'erro');
  assert.equal(erro!.arquivo, DPR, 'o problema é do .dpr, não do arquivo que não existe');
});

test('{$R *.dfm} sem o .dfm ao lado é erro — a tela não abre', () => {
  const a = verificarProjeto(DPR);
  assert.ok(a.some(x => x.mensagem.includes('não há SemForm.dfm')), JSON.stringify(a));
});

test('unit que se declara com outro nome que o do arquivo', () => {
  const a = verificarProjeto(DPR);
  assert.ok(a.some(x => x.mensagem.includes('OutroNome') && x.mensagem.includes('NomeTrocado')),
    JSON.stringify(a));
});

test('unit repetida no uses do .dpr', () => {
  const a = verificarProjeto(DPR);
  assert.ok(a.some(x => x.mensagem.includes('duas vezes')), JSON.stringify(a));
});

test('projeto sem problema nenhum devolve lista vazia', () => {
  const limpo = escrever('limpo/So.dpr', [
    'program So;', 'uses', "  Uma in 'Uma.pas';", 'begin', 'end.']);
  escrever('limpo/Uma.pas', ['unit Uma;', 'interface', 'implementation', 'end.']);
  assert.deepEqual(verificarProjeto(limpo), []);
});

test('.dfm sem .pas ao lado vira aviso', () => {
  const o = dfmOrfaos([RAIZ]);
  assert.ok(o.some(x => x.arquivo.endsWith('Perdido.dfm')), JSON.stringify(o));
  assert.ok(!o.some(x => x.arquivo.endsWith('Principal.dfm')), 'esse tem par');
  assert.ok(o.every(x => x.gravidade === 'aviso'), 'órfão não impede compilar');
});

test('o resumo separa form, data module e frame pela classe da raiz', () => {
  const r = resumoDoProjeto(DPR,
    cls => cls === 'TMeuDataModule', cls => cls === 'TMeuFrame')!;
  assert.equal(r.units, 6, 'conta as entradas do uses, inclusive a repetida');
  assert.equal(r.dataModules, 1, 'Dados.dfm tem TMeuDataModule na raiz');
  assert.equal(r.forms, 1, 'Principal aparece duas vezes no .dpr, mas é um form só');
});

test('o resumo conta componentes por classe, do mais usado ao menos', () => {
  const r = resumoDoProjeto(DPR, () => false, () => false)!;
  const nomes = r.componentes.map(([c]) => c);
  assert.ok(nomes.includes('TDBGrid') && nomes.includes('TButton'), nomes.join(','));
  assert.equal(r.totalComponentes, r.componentes.reduce((a, [, n]) => a + n, 0));
  for (let i = 1; i < r.componentes.length; i++) {
    assert.ok(r.componentes[i - 1][1] >= r.componentes[i][1], 'fora de ordem');
  }
});

test('.dfm com BOM não engana a leitura da raiz', () => {
  // o Delphi grava BOM; sem tirá-lo, o regex pulava a linha 1 e classificava por um filho
  const comBom = path.join(RAIZ, 'Bom.dfm');
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);   // BOM de UTF-8, como o Delphi grava
  fs.writeFileSync(comBom, Buffer.concat([bom, Buffer.from(
    ['object FormBom: TFormBom', '  object Interno: TdxLayoutControl', '  end', 'end']
      .join(CRLF), 'latin1')]));
  escrever('Bom.pas', ['unit Bom;', 'interface', 'implementation', '{$R *.dfm}', 'end.']);
  const dpr2 = escrever('ComBom.dpr', ['program ComBom;', 'uses', "  Bom in 'Bom.pas';",
    'begin', 'end.']);
  const r = resumoDoProjeto(dpr2, cls => cls === 'TdxLayoutControl', () => false)!;
  assert.equal(r.dataModules, 0, 'a raiz é TFormBom, não o TdxLayoutControl de dentro');
  assert.equal(r.forms, 1);
});
