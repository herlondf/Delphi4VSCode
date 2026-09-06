/**
 * Se o Code Insight do compilador está no ar.
 *
 * Mora sozinho, sem dependências, de propósito: quem consulta isto é o `pascalNav`, e se a
 * bandeira viesse do módulo do cliente ele arrastaria o `vscode-languageclient` junto — que
 * só carrega dentro do VS Code de verdade, e derruba os testes de ativação.
 */

let ligado = false;

export function lspNoAr(): boolean {
  return ligado;
}

export function marcarLsp(valor: boolean): void {
  ligado = valor;
}
