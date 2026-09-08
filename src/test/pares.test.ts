/** O salto declaração ↔ implementação — o `Ctrl+Shift+↑` da IDE. */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { cabecalhos, cabecalhoEm, par } from '../dfm/pares';

const UNIT = [
  'unit U;',                                  // 0
  'interface',                                // 1
  'type',                                     // 2
  '  TCb = procedure of object;',             // 3  tipo, não é cabeçalho
  '  TForm1 = class(TForm)',                  // 4
  '    procedure Salvar;',                    // 5
  '    class function Criar: TForm1;',        // 6
  '  end;',                                   // 7
  'implementation',                           // 8
  'procedure TForm1.Salvar;',                 // 9
  'begin',                                    // 10
  '  X := 1;',                                // 11
  'end;',                                     // 12
  'class function TForm1.Criar: TForm1;',     // 13
  'begin',                                    // 14
  'end;',                                     // 15
  'end.',                                     // 16
];

test('declaração de tipo não vira cabeçalho', () => {
  assert.deepEqual(cabecalhos(UNIT).map(c => c.linha), [5, 6, 9, 13]);
});

test('do corpo salta para a declaração na classe', () => {
  const lista = cabecalhos(UNIT);
  const atual = cabecalhoEm(lista, 11)!;   // cursor dentro do begin/end
  assert.equal(atual.linha, 9);
  assert.equal(par(lista, atual)!.linha, 5);
});

test('da declaração salta para o corpo, com class function também', () => {
  const lista = cabecalhos(UNIT);
  assert.equal(par(lista, cabecalhoEm(lista, 6)!)!.linha, 13);
});

test('a coluna aponta o nome, não a classe', () => {
  const c = cabecalhos(UNIT).find(x => x.linha === 9)!;
  assert.equal(UNIT[9].slice(c.coluna, c.coluna + 6), 'Salvar');
});

test('sobrecarga: escolhe o cabeçalho mais próximo', () => {
  const linhas = [
    '  TA = class',              // 0
    '    procedure P(A: Integer); overload;', // 1
    '    procedure P(A: string); overload;',  // 2
    '  end;',                    // 3
    'implementation',            // 4
    'procedure TA.P(A: Integer);', // 5
    'end;',                      // 6
  ];
  const lista = cabecalhos(linhas);
  assert.equal(par(lista, cabecalhoEm(lista, 5)!)!.linha, 2);
});

test('sem par, não inventa destino', () => {
  const lista = cabecalhos(['procedure Solta;', 'begin', 'end;']);
  assert.equal(par(lista, lista[0]), undefined);
});
