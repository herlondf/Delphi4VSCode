/**
 * A formatação, rodando o `Formatter.exe` de verdade quando ele existe nesta máquina.
 *
 * Não há como testar isto com um binário falso: o que interessa é justamente o que o
 * formatador da Embarcadero faz com o arquivo — inclusive o encoding, que é onde a integração
 * quebra em silêncio.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatarTexto, exeDoFormatador } from '../dfm/formatador';

const CRLF = String.fromCharCode(13, 10);

/** A instalação do Delphi não existe na máquina de CI; lá estes testes não têm o que provar. */
function acharExe(): string | undefined {
  const raiz = 'C:\\Program Files (x86)\\Embarcadero\\Studio';
  let versoes: string[];
  try { versoes = fs.readdirSync(raiz); } catch { return undefined; }
  for (const v of versoes.sort().reverse()) {
    const exe = exeDoFormatador(path.join(raiz, v, 'bin'));
    if (exe) { return exe; }
  }
  return undefined;
}

const EXE = acharExe();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd4vs-fmt-'));

const FEIO = [
  'unit Teste;', 'interface', 'type', 'TFoo=class', 'procedure Fazer(A:Integer);', 'end;',
  'implementation', 'procedure TFoo.Fazer(A:Integer);', 'begin',
  "if A>0 then WriteLn('Não é ASCII: ação, ünïcode');", 'end;', 'end.', '',
].join(CRLF);

test('o formatador da IDE endireita o código', { skip: !EXE }, async () => {
  const saida = await formatarTexto(FEIO, EXE!, tmp);
  assert.ok(saida, 'código torto tem de sair diferente');
  assert.match(saida!, /TFoo = class/);
  assert.match(saida!, /procedure Fazer\(A: Integer\)/);
  assert.match(saida!, /if A > 0 then/);
});

test('acento sobrevive à ida e volta', { skip: !EXE }, async () => {
  const saida = await formatarTexto(FEIO, EXE!, tmp);
  assert.ok(saida!.includes('Não é ASCII: ação, ünïcode'),
    'sem BOM no arquivo temporário o Formatter lê como ANSI e corrompe tudo');
});

test('formatar o que já está formatado não devolve edição', { skip: !EXE }, async () => {
  const uma = await formatarTexto(FEIO, EXE!, tmp);
  const duas = await formatarTexto(uma!, EXE!, tmp);
  assert.equal(duas, undefined,
    'segunda passada idêntica: senão o VS Code marca o arquivo como sujo à toa');
});

test('BOM na entrada não vira BOM duplicado na saída', { skip: !EXE }, async () => {
  const comBom = '\uFEFF' + FEIO;
  const saida = await formatarTexto(comBom, EXE!, tmp);
  assert.ok(saida !== undefined);
  assert.ok(!saida!.startsWith('\uFEFF'),
    'o texto volta para o buffer do editor, que já cuida do BOM do arquivo');
});

test('não sobra arquivo temporário depois de formatar', { skip: !EXE }, async () => {
  await formatarTexto(FEIO, EXE!, tmp);
  assert.deepEqual(fs.readdirSync(tmp).filter(n => n.startsWith('d4vs-fmt-')), []);
});

test('exeDoFormatador devolve undefined quando a pasta não tem o binário', () => {
  assert.equal(exeDoFormatador(path.join(os.tmpdir(), 'nao-existe-mesmo')), undefined);
});
