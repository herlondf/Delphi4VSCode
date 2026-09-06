/**
 * Os projetos Delphi da pasta aberta, numa view própria.
 *
 * Num repositório como o projeto de teste há dezenas de `.dproj` espalhados; achar o certo pelo
 * explorador é caça ao tesouro. Aqui eles aparecem juntos, o ativo fica destacado e um
 * clique troca — que é o que o Project Manager do Delphi faz.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { BuildManager } from './build';

export class ProjetoItem extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly ativo: boolean,
    /** Um .dpr sem .dproj irmão não é compilável por MSBuild. */
    public readonly temDproj: boolean,
  ) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
    const ehDproj = uri.fsPath.toLowerCase().endsWith('.dproj');
    this.description = vscode.workspace.asRelativePath(path.dirname(uri.fsPath));
    this.resourceUri = uri;
    this.contextValue = ativo ? 'projetoAtivo' : 'projeto';
    this.iconPath = new vscode.ThemeIcon(
      ativo ? 'check' : ehDproj ? 'file-code' : 'file',
      ativo ? new vscode.ThemeColor('charts.green') : undefined);
    this.tooltip = new vscode.MarkdownString(
      `**${path.basename(uri.fsPath)}**\n\n${uri.fsPath}\n\n` +
      (ativo ? '_Projeto ativo — Ctrl+F9 compila este._'
             : ehDproj ? '_Clique para tornar ativo._'
             : temDproj ? '_Prefira o .dproj irmão: é ele que o MSBuild compila._'
             : '_Sem .dproj: o MSBuild não compila um .dpr sozinho._'));
    this.command = ehDproj || !temDproj
      ? { command: 'delphi4vscode.ativarProjeto', title: 'Ativar', arguments: [this] }
      : { command: 'vscode.open', title: 'Abrir', arguments: [uri] };
  }
}

export class ProjetosProvider implements vscode.TreeDataProvider<ProjetoItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private build: BuildManager) {}

  refresh(): void { this._onDidChange.fire(); }

  getTreeItem(item: ProjetoItem): vscode.TreeItem { return item; }

  async getChildren(): Promise<ProjetoItem[]> {
    const achados = await vscode.workspace.findFiles(
      '**/*.{dproj,dpr}', '**/{node_modules,__history,__recovery,.git}/**', 500);
    const ativo = this.build.projeto?.fsPath;
    const dprojs = new Set(achados
      .filter(u => u.fsPath.toLowerCase().endsWith('.dproj'))
      .map(u => u.fsPath.toLowerCase().replace(/\.dproj$/, '')));

    return achados
      .map(u => {
        const semExt = u.fsPath.toLowerCase().replace(/\.(dproj|dpr)$/, '');
        return new ProjetoItem(u, u.fsPath === ativo, dprojs.has(semExt));
      })
      // .dproj primeiro, ativo no topo, depois por nome
      .sort((a, b) => {
        if (a.ativo !== b.ativo) { return a.ativo ? -1 : 1; }
        const da = a.uri.fsPath.endsWith('.dproj') ? 0 : 1;
        const db = b.uri.fsPath.endsWith('.dproj') ? 0 : 1;
        if (da !== db) { return da - db; }
        return a.uri.fsPath.localeCompare(b.uri.fsPath);
      });
  }
}

export function registrarProjetosView(
  ctx: vscode.ExtensionContext, build: BuildManager,
): ProjetosProvider {
  const provider = new ProjetosProvider(build);
  const view = vscode.window.createTreeView('delphi4vscode.projetos', {
    treeDataProvider: provider, showCollapseAll: false,
  });
  ctx.subscriptions.push(
    view,
    vscode.commands.registerCommand('delphi4vscode.ativarProjeto', async (item?: ProjetoItem) => {
      if (item) { await build.ativar(item.uri.fsPath); }
      else { await build.selecionar(); }
      provider.refresh();
    }),
    vscode.commands.registerCommand('delphi4vscode.atualizarProjetos', () => provider.refresh()),
  );
  // um .dproj criado ou apagado precisa aparecer na lista sem recarregar a janela
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{dproj,dpr}');
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  ctx.subscriptions.push(watcher);
  return provider;
}
