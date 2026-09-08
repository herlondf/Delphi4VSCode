/**
 * Traz o que estava sob `dfmview.*` para `delphi4vscode.*`.
 *
 * A extensão mudou de nome quando deixou de ser só um visualizador de `.dfm`. O nome é o
 * prefixo de tudo — 26 comandos, 14 configurações, o projeto ativo guardado no workspace —, e
 * sem esta passagem quem já tinha o caminho do Delphi e o script de build configurados
 * recomeçaria do zero, com a extensão nova reindexando o mundo errado.
 *
 * Roda uma vez e deixa a marca. As chaves antigas ficam onde estão: o VS Code preserva chave
 * desconhecida no `settings.json`, e apagá-las é o único passo que não teria volta se alguém
 * precisar reinstalar a versão anterior.
 */

import * as vscode from 'vscode';

const MARCA = 'delphi4vscode.migradoDeDfmview';
const ANTIGO = 'dfmview';
const NOVO = 'delphi4vscode';

/** Só as configurações do usuário; as do designer não existiam antes do rename. */
const CHAVES = [
  'sourcePaths', 'validate', 'bdsBinPath', 'buildConfig', 'buildPlatform',
  'errorLens.enabled', 'errorLens.languages', 'errorLens.maxLength',
  'validatePascal', 'validarPropriedades', 'buildScript', 'buildScriptCwd',
  'buildVerbosity', 'lerPacotes',
];

/*
 * O projeto ativo NÃO vem junto, e não é esquecimento.
 *
 * `workspaceState` é isolado por id de extensão: `app.delphi4vscode` não enxerga o que
 * a anterior guardou, e não existe API para isso. A primeira versão desta migração
 * tentava — lia a própria caixa vazia procurando a chave antiga, não achava nada, e dava tudo
 * por migrado.
 *
 * O efeito foi mudo e caro: depois do rename todo mundo ficou sem projeto ativo, e sem
 * projeto o Code Insight sobe, aponta para lugar nenhum e responde `null` a tudo. Quem cobre
 * esse buraco agora é `BuildManager.garantirProjeto`, que pergunta em vez de deixar em
 * branco.
 */

export async function migrarConfiguracoes(ctx: vscode.ExtensionContext): Promise<string[]> {
  if (ctx.globalState.get<boolean>(MARCA)) { return []; }
  const velho = vscode.workspace.getConfiguration(ANTIGO);
  const novo = vscode.workspace.getConfiguration(NOVO);
  const movidas: string[] = [];

  for (const chave of CHAVES) {
    const antes = velho.inspect(chave);
    const depois = novo.inspect(chave);
    if (!antes) { continue; }
    /*
     * Global e workspace são alvos separados de propósito: o caminho do BDS costuma ser
     * global e o script de build é do projeto. Juntar os dois num alvo só espalharia a
     * configuração de um projeto para todos os outros.
     */
    const pares: [unknown, unknown, vscode.ConfigurationTarget][] = [
      [antes.globalValue, depois?.globalValue, vscode.ConfigurationTarget.Global],
      [antes.workspaceValue, depois?.workspaceValue, vscode.ConfigurationTarget.Workspace],
      [antes.workspaceFolderValue, depois?.workspaceFolderValue,
       vscode.ConfigurationTarget.WorkspaceFolder],
    ];
    for (const [valorAntigo, valorNovo, alvo] of pares) {
      // o que o usuário já configurou no nome novo manda: não sobrescrever decisão recente
      if (valorAntigo === undefined || valorNovo !== undefined) { continue; }
      try {
        await novo.update(chave, valorAntigo, alvo);
        movidas.push(chave);
      } catch {
        // workspace sem pasta aberta recusa o alvo; não é motivo para abortar o resto
      }
    }
  }

  await ctx.globalState.update(MARCA, true);
  return [...new Set(movidas)];
}
