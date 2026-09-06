/**
 * Formatar Object Pascal com o formatador da própria IDE.
 *
 * A extensão chegou a ter um formatador próprio; ele foi cortado depois de medir: em 150
 * `.pas` reais, alterava 55,7% das linhas — quase todas por discordar do estilo do time, não
 * por corrigir nada (ver `src/dfm/formatar-decisao.md`). Um formatador que reescreve metade do
 * arquivo é um formatador que ninguém liga.
 *
 * `bin\Formatter.exe` resolve isso sem escrever uma linha de lógica: é o mesmo binário do
 * Ctrl+D da IDE, e lê o `Formatter.config` do próprio usuário — então o resultado é
 * exatamente o que o Delphi faria na máquina dele.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** UTF-8 BOM. */
const BOM = '﻿';

export function exeDoFormatador(bdsBin: string): string | undefined {
  const exe = path.join(bdsBin, 'Formatter.exe');
  return fs.existsSync(exe) ? exe : undefined;
}

function rodar(exe: string, arquivo: string): Promise<void> {
  return new Promise((ok, erro) => {
    execFile(exe, ['-delphi', arquivo], { timeout: 20000 }, e => (e ? erro(e) : ok()));
  });
}

/**
 * Formata o texto e devolve o resultado, ou `undefined` se o formatador não mexeu nem pôde
 * rodar. Exportada para o teste: aqui não há VS Code, só entra e sai texto.
 */
export async function formatarTexto(
  texto: string, exe: string, dir = os.tmpdir(),
): Promise<string | undefined> {
  /*
   * O arquivo temporário vai COM BOM de propósito. Sem ele o `Formatter.exe` lê o arquivo
   * como ANSI, e todo acento de comentário e de string vira lixo — num código em português
   * isso não é detalhe, é a maioria dos arquivos.
   */
  const alvo = path.join(dir, `d4vs-fmt-${Date.now().toString(36)}.pas`);
  fs.writeFileSync(alvo, BOM + texto.replace(/^﻿/, ''), 'utf8');
  try {
    await rodar(exe, alvo);
    const saida = fs.readFileSync(alvo, 'utf8').replace(/^﻿/, '');
    return saida === texto.replace(/^﻿/, '') ? undefined : saida;
  } finally {
    try { fs.unlinkSync(alvo); } catch { /* o temporário some no próximo boot, sem drama */ }
  }
}

