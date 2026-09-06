/**
 * Erros e avisos escritos na própria linha, no estilo do Error Lens.
 *
 * O painel Problems obriga a desviar o olho e voltar. Aqui a mensagem fica ao lado do código
 * que a causou, colorida por severidade — e a linha inteira recebe um fundo tênue, para o
 * problema ser visível mesmo sem ler o texto.
 *
 * Renderiza qualquer diagnóstico do documento, venha de onde vier: do nosso cruzamento
 * `.pas` × `.dfm`, do compilador via task de build, ou de outra extensão.
 */

import * as vscode from 'vscode';

type Nivel = 'error' | 'warning' | 'info' | 'hint';

const NIVEL: Record<number, Nivel> = {
  [vscode.DiagnosticSeverity.Error]: 'error',
  [vscode.DiagnosticSeverity.Warning]: 'warning',
  [vscode.DiagnosticSeverity.Information]: 'info',
  [vscode.DiagnosticSeverity.Hint]: 'hint',
};

/** Cor do texto e do fundo por severidade, seguindo os tokens do tema quando existem. */
const CORES: Record<Nivel, { fg: string; bg: string }> = {
  error: { fg: 'editorError.foreground', bg: 'rgba(240, 90, 80, 0.10)' },
  warning: { fg: 'editorWarning.foreground', bg: 'rgba(230, 170, 60, 0.10)' },
  info: { fg: 'editorInfo.foreground', bg: 'rgba(90, 150, 230, 0.09)' },
  hint: { fg: 'editorHint.foreground', bg: 'rgba(140, 140, 140, 0.08)' },
};

const ICONE: Record<Nivel, string> = {
  error: '✖', warning: '⚠', info: 'ℹ', hint: '○',
};

export class ErrorLens {
  private tipos = new Map<Nivel, vscode.TextEditorDecorationType>();
  private timer: NodeJS.Timeout | undefined;

  constructor(ctx: vscode.ExtensionContext) {
    for (const nivel of Object.keys(CORES) as Nivel[]) {
      const { fg, bg } = CORES[nivel];
      const tipo = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: bg,
        after: {
          color: new vscode.ThemeColor(fg),
          margin: '0 0 0 2em',
          fontStyle: 'italic',
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        overviewRulerColor: new vscode.ThemeColor(fg),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
      });
      this.tipos.set(nivel, tipo);
      ctx.subscriptions.push(tipo);
    }

    ctx.subscriptions.push(
      vscode.languages.onDidChangeDiagnostics(() => this.agendar()),
      vscode.window.onDidChangeActiveTextEditor(() => this.agendar()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.agendar()),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('delphi4vscode.errorLens')) { this.agendar(); }
      }),
    );
    this.agendar();
  }

  /** Agrupa rajadas de diagnóstico: o compilador emite tudo de uma vez. */
  private agendar(): void {
    if (this.timer) { clearTimeout(this.timer); }
    this.timer = setTimeout(() => this.aplicar(), 80);
  }

  private aplicar(): void {
    const cfg = vscode.workspace.getConfiguration('delphi4vscode');
    const ligado = cfg.get<boolean>('errorLens.enabled', true);
    const idiomas = cfg.get<string[]>('errorLens.languages', ['pascal', 'dfm']);
    const maxCols = cfg.get<number>('errorLens.maxLength', 160);

    for (const editor of vscode.window.visibleTextEditors) {
      const usar = ligado && idiomas.includes(editor.document.languageId);
      const porNivel = new Map<Nivel, vscode.DecorationOptions[]>();
      for (const n of Object.keys(CORES) as Nivel[]) { porNivel.set(n, []); }

      if (usar) {
        // uma linha pode ter vários problemas: mostra o mais grave, com a contagem
        const porLinha = new Map<number, vscode.Diagnostic[]>();
        for (const d of vscode.languages.getDiagnostics(editor.document.uri)) {
          const linha = d.range.start.line;
          porLinha.set(linha, [...(porLinha.get(linha) ?? []), d]);
        }
        for (const [linha, lista] of porLinha) {
          if (linha >= editor.document.lineCount) { continue; }
          lista.sort((a, b) => a.severity - b.severity);
          const pior = lista[0];
          const nivel = NIVEL[pior.severity] ?? 'info';
          const extras = lista.length > 1 ? `  (+${lista.length - 1})` : '';
          let texto = pior.message.replace(/\s+/g, ' ').trim();
          if (texto.length > maxCols) { texto = texto.slice(0, maxCols - 1) + '…'; }
          const fim = editor.document.lineAt(linha).range.end;
          porNivel.get(nivel)!.push({
            range: new vscode.Range(fim, fim),
            renderOptions: {
              after: { contentText: `  ${ICONE[nivel]} ${texto}${extras}` },
            },
            hoverMessage: lista.map(d =>
              `${ICONE[NIVEL[d.severity] ?? 'info']} ${d.message}` +
              (d.source ? `  _(${d.source})_` : '')).join('\n\n'),
          });
        }
      }
      for (const [nivel, tipo] of this.tipos) {
        editor.setDecorations(tipo, porNivel.get(nivel) ?? []);
      }
    }
  }
}

/**
 * Diagnósticos de Pascal: o que dá para apontar sem compilar.
 *
 * O foco é o cruzamento com o `.dfm` irmão, porque é a falha que o compilador deixa passar
 * e a aplicação descobre em runtime, ao abrir a tela.
 */
export function registrarLens(ctx: vscode.ExtensionContext): ErrorLens {
  return new ErrorLens(ctx);
}
