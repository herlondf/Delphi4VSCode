/**
 * Cópias duplicadas da extensão instaladas ao mesmo tempo.
 *
 * O caso real: sete cópias — seis com o id antigo, uma com o novo —, todas declarando o mesmo
 * `viewType` de editor de `.dfm` e os mesmos 32 comandos. A segunda a ativar estoura em
 * `registerCommand` ("command already exists"), a exceção sobe da `activate` inteira, e o
 * índice de classes, carregado na última linha, nunca roda. Na tela: todo form abrindo só com
 * a moldura, sem componente nenhum e sem erro nenhum.
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
