/**
 * Cópias duplicadas da extensão instaladas ao mesmo tempo.
 *
 * Guarda contra um risco concreto, não contra um caso já observado: se duas cópias estiverem
 * REGISTRADAS, as duas ativam, declaram o mesmo `viewType` de editor de `.dfm` e os mesmos
 * comandos, e a segunda a chamar `registerCommand` recebe "command already exists". A exceção
 * sobe da `activate` inteira e o índice de classes não carrega — o designer então desenha a
 * moldura e mais nada.
 *
 * O que motivou o guarda: uma máquina com sete pastas de versões diferentes em
 * `.vscode/extensions`. Ali seis eram órfãs, fora do `extensions.json`, e o VS Code ignorava —
 * então NÃO foi a causa daquele caso. Mas o dia em que duas estiverem registradas, a falha é
 * muda, e descobrir pelo comportamento custa horas; a lista de ids resolve em um olhar.
 */

export interface ExtensaoInstalada {
  id: string;
  packageJSON?: unknown;
}

/** As instaladas que disputam o editor de `.dfm`. Mais de uma já é problema. */
export function copiasInstaladas(
  extensoes: readonly ExtensaoInstalada[] | undefined, viewType: string,
): string[] {
  // diagnóstico não pode derrubar a ativação: um host antigo pode não expor a lista
  return (extensoes ?? [])
    .filter(e => {
      const p = e.packageJSON as
        { contributes?: { customEditors?: { viewType?: string }[] } } | undefined;
      return p?.contributes?.customEditors?.some(c => c.viewType === viewType) ?? false;
    })
    .map(e => e.id);
}
