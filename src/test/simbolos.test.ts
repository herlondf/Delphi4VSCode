/**
 * O índice de símbolos que alimenta o Ctrl+T.
 *
 * O que o teste protege é o sinal/ruído: um índice que engole variável local ou campo de
 * classe enterra os nomes que a pessoa procura. Medido no projeto de teste: com essas duas travas, o
 * índice caiu de 454 mil para 30 mil entradas e de 207 MB para 23 MB.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IndiceSimbolos } from '../dfm/simbolos';

const NL = String.fromCharCode(13, 10);

function comArquivo(linhas: string[]): { idx: IndiceSimbolos; arquivo: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd4vs-sim-'));
  const arquivo = path.join(dir, 'Unidade.pas');
  fs.writeFileSync(arquivo, linhas.join(NL), 'latin1');
  const idx = new IndiceSimbolos();
  idx.varrerArquivo(arquivo);
  return { idx, arquivo };
}

const tipos = (idx: IndiceSimbolos, nome: string): string[] =>
  idx.declaracoesDe(nome).map(s => s.tipo);

test('indexa classe, interface, record, tipo, constante e variável de unidade', () => {
  const { idx } = comArquivo([
    'unit Unidade;', 'interface', 'type',
    '  TFoo = class', '    FCampo: Integer;', '  end;',
    '  IAlgo = interface', '  end;',
    '  TReg = record', '    Campo: Integer;', '  end;',
    '  TApelido = Integer;',
    'const', '  CMaximo = 10;',
    'var', '  Global: Integer;',
    'implementation', 'end.', '',
  ]);
  assert.deepEqual(tipos(idx, 'TFoo'), ['classe']);
  assert.deepEqual(tipos(idx, 'IAlgo'), ['interface']);
  assert.deepEqual(tipos(idx, 'TReg'), ['record']);
  assert.deepEqual(tipos(idx, 'TApelido'), ['tipo']);
  assert.deepEqual(tipos(idx, 'CMaximo'), ['constante']);
  assert.deepEqual(tipos(idx, 'Global'), ['variavel']);
});

test('campo de classe e de record ficam de fora', () => {
  const { idx } = comArquivo([
    'unit Unidade;', 'interface', 'type',
    '  TFoo = class', '    FCampo: Integer;', '  end;',
    '  TReg = record', '    CampoDoRecord: Integer;', '  end;',
    'implementation', 'end.', '',
  ]);
  assert.deepEqual(idx.declaracoesDe('FCampo'), []);
  assert.deepEqual(idx.declaracoesDe('CampoDoRecord'), []);
});

test('variável local não entra: `var` também abre seção dentro de rotina', () => {
  const { idx } = comArquivo([
    'unit Unidade;', 'interface', 'implementation',
    'procedure Fazer;', 'var', '  Contador: Integer;', 'begin', 'end;',
    'end.', '',
  ]);
  assert.deepEqual(idx.declaracoesDe('Contador'), [],
    'sem esta trava o índice enche de Valor, I e S');
  assert.deepEqual(tipos(idx, 'Fazer'), ['funcao']);
});

test('a variável de unidade depois de uma rotina volta a contar', () => {
  const { idx } = comArquivo([
    'unit Unidade;', 'interface', 'implementation',
    'procedure Fazer;', 'var', '  Local: Integer;', 'begin', 'end;',
    'var', '  DaUnidade: Integer;',
    'end.', '',
  ]);
  assert.deepEqual(idx.declaracoesDe('Local'), []);
  assert.deepEqual(tipos(idx, 'DaUnidade'), ['variavel']);
});

test('método implementado guarda a classe', () => {
  const { idx } = comArquivo([
    'unit Unidade;', 'interface', 'implementation',
    'procedure TFoo.Salvar;', 'begin', 'end;',
    'function TBar.Salvar: Boolean;', 'begin', 'end;',
    'end.', '',
  ]);
  const achados = idx.declaracoesDe('Salvar');
  assert.deepEqual(achados.map(s => s.classe).sort(), ['TBar', 'TFoo']);
  assert.ok(achados.every(s => s.tipo === 'metodo'));
});

test('`class of` não abre corpo e não engole o resto', () => {
  const { idx } = comArquivo([
    'unit Unidade;', 'interface', 'type',
    '  TFoo = class', '  end;',
    '  TFooClass = class of TFoo;',
    '  TDepois = class', '  end;',
    'implementation', 'end.', '',
  ]);
  assert.deepEqual(tipos(idx, 'TDepois'), ['classe']);
});

test('a busca põe o nome exato antes do prefixo, e o prefixo antes do contido', () => {
  const { idx } = comArquivo([
    'unit Unidade;', 'interface', 'type',
    '  TSalvarDepois = class', '  end;',
    '  TPreSalvar = class', '  end;',
    'implementation', 'procedure Salvar;', 'begin', 'end;', 'end.', '',
  ]);
  const ordem = idx.buscar('salvar').map(s => s.nome);
  assert.equal(ordem[0], 'Salvar');
  assert.ok(ordem.indexOf('TSalvarDepois') < ordem.indexOf('TPreSalvar') ||
    !ordem.includes('TPreSalvar'), String(ordem));
});

test('comentário não vira declaração', () => {
  const { idx } = comArquivo([
    'unit Unidade;', 'interface', 'type',
    '  // TComentada = class',
    '  { TEmBloco = class }',
    '  TReal = class', '  end;',
    'implementation', 'end.', '',
  ]);
  assert.deepEqual(idx.declaracoesDe('TComentada'), []);
  assert.deepEqual(idx.declaracoesDe('TEmBloco'), []);
  assert.deepEqual(tipos(idx, 'TReal'), ['classe']);
});

test('pasta excluída não é varrida', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'd4vs-raiz-'));
  fs.mkdirSync(path.join(raiz, 'vendor'));
  fs.mkdirSync(path.join(raiz, 'meu'));
  const corpo = ['unit U;', 'interface', 'type', '  TX = class', '  end;',
                 'implementation', 'end.', ''].join(NL);
  fs.writeFileSync(path.join(raiz, 'vendor', 'DeTerceiro.pas'), corpo, 'latin1');
  fs.writeFileSync(path.join(raiz, 'meu', 'Meu.pas'), corpo, 'latin1');

  const comTudo = new IndiceSimbolos();
  comTudo.varrer([raiz], 5000);
  assert.equal(comTudo.tamanho, 2);

  const semVendor = new IndiceSimbolos();
  semVendor.varrer([raiz], 5000, ['vendor']);
  assert.equal(semVendor.tamanho, 1,
    'terceiros são dois terços dos .pas de um projeto grande');
});
