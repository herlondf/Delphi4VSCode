/**
 * Se o Code Insight do compilador está no ar E atendendo.
 *
 * Mora sozinho, sem dependências, de propósito: quem consulta isto é o `pascalNav`, e se a
 * bandeira viesse do módulo do cliente ela arrastaria o `vscode-languageclient` junto — que
 * só carrega dentro do VS Code de verdade, e derruba os testes de ativação.
 *
 * São duas condições, e não uma. O servidor pode estar de pé sem projeto apontado, e nesse
 * estado ele responde `null` a tudo. Silenciar o índice próprio só porque o processo subiu
 * deixaria o usuário sem completar nenhum — pior do que antes de existir LSP.
 */

let ligado = false;
let comProjeto = false;

export function lspNoAr(): boolean {
  return ligado && comProjeto;
}

export function marcarLsp(valor: boolean): void {
  ligado = valor;
  if (!valor) { comProjeto = false; }
}

export function marcarProjeto(valor: boolean): void {
  comProjeto = valor;
}
