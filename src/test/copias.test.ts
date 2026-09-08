/**
 * Detecção de cópias duplicadas da extensão.
 *
 * O caso real que motivou isto: sete cópias instaladas — seis com o id antigo, uma com o
 * novo — todas declarando o MESMO `viewType` de editor de `.dfm` e os MESMOS 32 comandos. A
 * segunda a ativar estourava em `registerCommand` ("command already exists"), a exceção subia
 * da `activate` inteira e o índice, que era carregado na última linha, nunca rodava. Resultado
 * na tela: todo form abrindo só com a moldura, sem nenhum componente e sem nenhum erro.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { copiasInstaladas } from '../dfm/copias';

const VIEW = 'delphi4vscode.form';

function ext(id: string, viewType?: string): { id: string; packageJSON: unknown } {
  return {
    id,
    packageJSON: viewType
      ? { contributes: { customEditors: [{ viewType }] } }
      : { contributes: {} },
  };
}

test('acha todas as que disputam o editor, com ids diferentes', () => {
  const achadas = copiasInstaladas([
    ext('herlondf.delphi4vscode', VIEW),
    ext('monde.delphi4vscode', VIEW),
    ext('outra.qualquer'),
  ], VIEW);
  assert.deepEqual(achadas, ['herlondf.delphi4vscode', 'monde.delphi4vscode']);
});

test('uma cópia só não é conflito', () => {
  assert.deepEqual(copiasInstaladas([ext('herlondf.delphi4vscode', VIEW)], VIEW),
    ['herlondf.delphi4vscode']);
});

test('extensão de outro editor não entra na conta', () => {
  assert.deepEqual(copiasInstaladas([ext('alguem.outro', 'outro.viewType')], VIEW), []);
});

test('manifesto sem contributes não quebra a varredura', () => {
  assert.deepEqual(copiasInstaladas([{ id: 'x', packageJSON: undefined }, ext('y')], VIEW), []);
});

test('lista ausente devolve vazio — diagnóstico não derruba a ativação', () => {
  assert.deepEqual(copiasInstaladas(undefined, VIEW), []);
});
