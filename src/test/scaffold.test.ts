import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { classeDe, novoEsqueleto, registrarNoDpr, variavelDe } from '../dfm/scaffold';
import { parseDfm } from '../dfm/parser';
import { parsePascal, crossCheck } from '../dfm/pascal';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';

const reg = Registry.fromJSON({
  parents: [
    ['tformcadastro', 'tform'], ['tform', 'tcustomform'],
    ['tcustomform', 'tscrollingwincontrol'], ['tscrollingwincontrol', 'twincontrol'],
    ['tframemeu', 'tframe'], ['tframe', 'tcustomframe'], ['tcustomframe', 'twincontrol'],
    ['tdmvendas', 'tdatamodule'], ['tdatamodule', 'tcomponent'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
});

test('nomes seguem a convenção do Delphi', () => {
  assert.equal(classeDe('Cadastro', 'form'), 'TFormCadastro');
  assert.equal(variavelDe('Cadastro', 'form'), 'FormCadastro');
  assert.equal(classeDe('Meu', 'frame'), 'TFrameMeu');
  assert.equal(classeDe('Dados', 'datamodule'), 'TDmDados');
});

test('recusa nome de unit inválido', () => {
  for (const ruim of ['1Form', 'com espaço', 'com-traco', '']) {
    assert.throws(() => novoEsqueleto(ruim, 'form'), /nome da unit/, ruim);
  }
});

test('form novo: os dois arquivos e o vínculo entre eles', () => {
  const e = novoEsqueleto('Cadastro', 'form');
  assert.deepEqual(e.arquivos.map(a => a.nome), ['Cadastro.pas', 'Cadastro.dfm']);
  const pas = e.arquivos[0].conteudo;
  const dfm = e.arquivos[1].conteudo;

  // o nome da unit precisa bater com o arquivo, ou o compilador recusa
  assert.match(pas, /^unit Cadastro;/);
  // e o {$R *.dfm} é o que liga o form ao .pas
  assert.match(pas, /\{\$R \*\.dfm\}/);
  assert.match(pas, /TFormCadastro = class\(TForm\)/);
  assert.match(pas, /FormCadastro: TFormCadastro;/);
  assert.match(dfm, /object FormCadastro: TFormCadastro/);
});

test('o .dfm gerado é lido pelo nosso próprio parser', () => {
  const e = novoEsqueleto('Cadastro', 'form');
  const root = parseDfm(e.arquivos[1].conteudo, 'Cadastro.dfm');
  assert.ok(root, 'o .dfm precisa ser parseável');
  assert.equal(root!.name, 'FormCadastro');
  assert.equal(root!.cls, 'TFormCadastro');
  const doc = new DfmDocument('Cadastro.dfm', e.arquivos[1].conteudo, reg);
  assert.equal(doc.root.props.has('clientwidth'), true, 'form precisa de área cliente');
});

test('o par novo não nasce com nenhum diagnóstico', () => {
  const e = novoEsqueleto('Cadastro', 'form');
  const unit = parsePascal(e.arquivos[0].conteudo);
  assert.equal(unit.nome, 'Cadastro');
  assert.equal(unit.classe, 'TFormCadastro');
  // sem componentes ainda: o cruzamento tem de sair limpo
  const issues = crossCheck(unit, [], []);
  assert.deepEqual(issues, [], JSON.stringify(issues));
});

test('frame e data module usam a base certa', () => {
  const f = novoEsqueleto('Selecao', 'frame');
  assert.match(f.arquivos[0].conteudo, /TFrameSelecao = class\(TFrame\)/);
  assert.match(f.arquivos[1].conteudo, /Width = 400/);
  assert.ok(!/ClientWidth/.test(f.arquivos[1].conteudo), 'frame não tem área cliente');

  const d = novoEsqueleto('Dados', 'datamodule');
  assert.match(d.arquivos[0].conteudo, /TDmDados = class\(TDataModule\)/);
  assert.match(d.arquivos[1].conteudo, /object DmDados: TDmDados/);
  // data module não carrega a VCL visual
  assert.ok(!/Vcl\.Controls/.test(d.arquivos[0].conteudo), d.arquivos[0].conteudo);
});

test('o data module gerado é reconhecido como tal', async () => {
  const d = novoEsqueleto('Dados', 'datamodule');
  const doc = new DfmDocument('Dados.dfm', d.arquivos[1].conteudo, reg);
  const { isDataModule } = await import('../dfm/render');
  assert.equal(isDataModule(doc.root, reg), true);
});

// ---- registro no .dpr ----

function aplicar(texto: string, edicoes: { linha: number; kind: string; texto: string }[]): string {
  const linhas = texto.split('\n');
  for (const e of edicoes.filter(e => e.kind === 'replace')) { linhas[e.linha] = e.texto; }
  for (const e of edicoes.filter(e => e.kind === 'insert').sort((a, b) => b.linha - a.linha)) {
    linhas.splice(e.linha, 0, e.texto);
  }
  return linhas.join('\n');
}

const DPR = `program App;

uses
  Vcl.Forms,
  Principal in 'Principal.pas' {FormPrincipal};

{$R *.res}

begin
  Application.Initialize;
  Application.Run;
end.
`;

test('registra a unit no .dpr no formato que o Delphi escreve', () => {
  const ed = registrarNoDpr(DPR, 'Cadastro', 'Cadastro.pas', 'FormCadastro', 'form');
  const novo = aplicar(DPR, ed);
  assert.match(novo, /Principal in 'Principal\.pas' \{FormPrincipal\},/,
    'a linha anterior troca o ; por ,');
  assert.match(novo, /Cadastro in 'Cadastro\.pas' \{FormCadastro\};/, novo);
  // e o begin do programa continua depois do uses
  assert.ok(novo.indexOf('Cadastro in') < novo.indexOf('{$R *.res}'), novo);
});

test('data module recebe a marca própria no .dpr', () => {
  const novo = aplicar(DPR, registrarNoDpr(DPR, 'Dados', 'Dados.pas', 'DmDados', 'datamodule'));
  assert.match(novo, /Dados in 'Dados\.pas' \{DmDados: TDataModule\};/, novo);
});

test('unit já registrada não entra duas vezes', () => {
  assert.deepEqual(registrarNoDpr(DPR, 'Principal', 'Principal.pas', 'FormPrincipal', 'form'), []);
  assert.deepEqual(registrarNoDpr(DPR, 'principal', 'Principal.pas', 'FormPrincipal', 'form'), [],
    'a comparação ignora caixa');
});

test('caminho relativo com subpasta é preservado', () => {
  const novo = aplicar(DPR,
    registrarNoDpr(DPR, 'Cadastro', 'views\\Cadastro.pas', 'FormCadastro', 'form'));
  assert.match(novo, /Cadastro in 'views\\Cadastro\.pas'/, novo);
});

test('dpr sem uses falha alto em vez de corromper', () => {
  assert.throws(() => registrarNoDpr('program X;\n\nbegin\nend.\n', 'U', 'U.pas', 'F', 'form'),
    /não achei a cláusula uses/);
});
