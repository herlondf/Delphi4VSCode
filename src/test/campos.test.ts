/**
 * O campo do componente na classe do form.
 *
 * Criar componente no designer sem declarar o campo produz o pior tipo de defeito: compila, e
 * quebra ao abrir a tela. Os testes cuidam de onde o campo entra — errar a seção é tão ruim
 * quanto não declarar, porque o streaming do DFM só enxerga o bloco published.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { acharClasse, declararCampo, removerCampo } from '../dfm/campos';

const NL = '\n';
const unit = (...corpo: string[]): string => [
  'unit CadastroMan;', '', 'interface', '', 'type', ...corpo,
  '', 'implementation', '', 'end.', '',
].join(NL);

const FORM = unit(
  '  TFormCadastro = class(TForm)',
  '    Botao: TButton;',
  '    Edit: TEdit;',
  '  private',
  '    FInterno: Integer;',
  '  public',
  '    procedure Fazer;',
  '  end;');

test('acha a classe e só os campos do bloco implícito', () => {
  const c = acharClasse(FORM, 'TFormCadastro')!;
  assert.ok(c);
  assert.deepEqual(c.campos.map(x => x.nome), ['Botao', 'Edit'],
    'FInterno está em private e não é campo de componente');
  assert.equal(c.recuo, '    ');
});

test('o campo novo entra depois do último componente, antes do private', () => {
  const e = declararCampo(FORM, 'TFormCadastro', 'Memo', 'TMemo');
  assert.equal(e.length, 1);
  assert.equal(e[0].kind, 'insert');
  assert.equal(e[0].texto, '    Memo: TMemo;');
  const linhas = FORM.split(NL);
  assert.equal(linhas[e[0].linha].trim(), 'private',
    'a inserção tem de cair logo antes do private, ainda no bloco published');
});

test('classe sem campo nenhum: o campo entra logo abaixo do cabeçalho', () => {
  const vazia = unit('  TFormVazio = class(TForm)', '  private', '  end;');
  const e = declararCampo(vazia, 'TFormVazio', 'Botao', 'TButton');
  assert.equal(e.length, 1);
  const linhas = vazia.split(NL);
  assert.equal(linhas[e[0].linha - 1].trim(), 'TFormVazio = class(TForm)');
});

test('campo que já existe não é declarado de novo', () => {
  assert.deepEqual(declararCampo(FORM, 'TFormCadastro', 'Botao', 'TButton'), [],
    'declarar duas vezes é erro de compilação');
  assert.deepEqual(declararCampo(FORM, 'TFormCadastro', 'BOTAO', 'TButton'), [],
    'Pascal não diferencia maiúscula de minúscula');
});

test('classe que não existe no arquivo não gera edição', () => {
  assert.deepEqual(declararCampo(FORM, 'TOutroForm', 'X', 'TButton'), []);
});

test('apagar o componente tira a linha do campo', () => {
  const e = removerCampo(FORM, 'TFormCadastro', 'Edit');
  assert.equal(e.length, 1);
  assert.equal(e[0].kind, 'delete');
  assert.equal(FORM.split(NL)[e[0].linha].trim(), 'Edit: TEdit;');
});

test('apagar campo inexistente não mexe em nada', () => {
  assert.deepEqual(removerCampo(FORM, 'TFormCadastro', 'NaoExiste'), []);
  assert.deepEqual(removerCampo(FORM, 'TFormCadastro', 'FInterno'), [],
    'campo de private não é componente e não pode ser apagado por engano');
});

test('comentário não vira campo', () => {
  const com = unit(
    '  TFormX = class(TForm)',
    '    // Antigo: TButton;',
    '    Real: TButton;',
    '  private',
    '  end;');
  assert.deepEqual(acharClasse(com, 'TFormX')!.campos.map(c => c.nome), ['Real']);
});

test('o recuo do arquivo é respeitado', () => {
  const doisEspacos = unit(
    '  TFormY = class(TForm)',
    '  Botao: TButton;',
    '  private',
    '  end;');
  assert.equal(declararCampo(doisEspacos, 'TFormY', 'Novo', 'TEdit')[0].texto,
    '  Novo: TEdit;');
});
