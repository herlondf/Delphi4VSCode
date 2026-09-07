/**
 * O editor visual de .dfm, registrado como CustomTextEditor.
 *
 * O VS Code entrega o documento; nós entregamos a webview e traduzimos cliques em TextEdit.
 * Nada é gravado em disco aqui: quem salva é o usuário, com Ctrl+S, e o Ctrl+Z é o nativo.
 */

import * as vscode from 'vscode';
import { declararCampo, removerCampo, EdicaoPas } from './dfm/campos';
import { DfmDocument } from './dfm/document';
import { Registry } from './dfm/registry';
import { renderForm } from './dfm/render';
import { walk, num, txt, DfmNode } from './dfm/model';
import {
  EditError, TextChange, addComponent, moveNode, removeComponent, reorderNodes,
  resizeNode, setProperty,
} from './dfm/edit';
import { place, visualKids, sizeOf } from './dfm/layout';
import {
  AlignOp, alignRects, applyTabOrder, duplicate, equalizeSize, reparent, revertInherited,
  tabOrderOf, zOrder,
} from './dfm/ops';
import { inspect, inspectMany, corDfm } from './dfm/inspector';
import { setCollectionItemProp, setCollectionProp, setStringsProp } from './dfm/blocks';
import { mudancasDfm, mudancasPascal, planejar } from './dfm/rename';
import { addNoLayout, destinoNoLayout } from './dfm/addLayout';
import { addFrame, criarTemplate, framesDoProjeto, inserirTemplate, Template }
  from './dfm/insert';
import { ItemMenu, lerMenu, setMenu } from './dfm/menu';
import { aplicarAnchors } from './dfm/anchors';
import { encodeBinaryDfm } from './dfm/encode';
import { parseDfm } from './dfm/parser';
import { validate } from './diagnostics';
import { criarHandler } from './dfm/handler';
import { garantirUses, todaPaleta } from './dfm/palette';
import { contarComponentes } from './dfm/usage';

// escritos assim para o fim de linha nao depender do encoding deste arquivo
const EOL_CRLF = String.fromCharCode(13, 10);
const EOL_LF = String.fromCharCode(10);
const SEPARADOR_LINHA = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10));

interface WebMsg {
  type: string;
  path?: string;
  other?: string;
  paths?: string[];
  left?: number; top?: number; w?: number; h?: number;
  key?: string; value?: string; scope?: 'control' | 'item';
  cls?: string; op?: string;
  lines?: string[]; ordem?: number[]; indice?: number; label?: string;
  nome?: string; itens?: ItemMenu[];
}

const TEMPLATES = 'delphi4vscode.templates';

export class DfmEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'delphi4vscode.form';
  /** Modo de layout por documento: o usuário alterna e a escolha vale enquanto a aba viver. */
  private flexByUri = new Map<string, boolean>();
  private panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly registry: () => Registry,
    private readonly diagnostics: vscode.DiagnosticCollection,
  ) {}

  toggleLayout(uri: vscode.Uri): void {
    const key = uri.toString();
    this.flexByUri.set(key, !this.flexByUri.get(key));
    const panel = this.panels.get(key);
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === key);
    if (panel && doc) { this.refresh(panel, doc); }
  }

  /**
   * C03 — o cursor no texto manda a seleção no designer.
   *
   * O componente é o bloco mais interno cuja faixa de linhas contém o cursor: um clique
   * dentro de um `object` aninhado não deve selecionar o pai.
   */
  selecionarPorLinha(uri: vscode.Uri, linha: number): void {
    const panel = this.panels.get(uri.toString());
    if (!panel) { return; }
    const document = vscode.workspace.textDocuments
      .find(d => d.uri.toString() === uri.toString());
    if (!document) { return; }
    let doc: DfmDocument;
    try {
      doc = this.load(document);
    } catch {
      return;
    }
    let alvo: DfmNode | undefined;
    for (const n of doc.index.values()) {
      if (n.uri !== doc.uri || linha < n.line || linha > n.endLine) { continue; }
      if (!alvo || n.line > alvo.line) { alvo = n; }
    }
    if (alvo) { panel.webview.postMessage({ type: 'select', path: alvo.path }); }
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const key = document.uri.toString();
    this.panels.set(key, panel);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'media')],
    };

    this.refresh(panel, document);

    const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === key && e.contentChanges.length) {
        this.refresh(panel, document);
      }
    });
    panel.onDidDispose(() => {
      changeSub.dispose();
      this.panels.delete(key);
      this.diagnostics.delete(document.uri);
    });

    panel.webview.onDidReceiveMessage(async (msg: WebMsg) => {
      try {
        await this.handle(msg, document, panel);
      } catch (err) {
        const texto = err instanceof EditError || err instanceof Error
          ? err.message : String(err);
        panel.webview.postMessage({ type: 'error', text: texto });
      }
    });
  }

  /** Alinhamento em lote: resolve os retângulos, aplica a operação e grava cada movimento. */
  private alignMany(doc: DfmDocument, paths: string[], op: AlignOp): TextChange[] {
    const nodes = paths.map(p => doc.index.get(p)).filter((n): n is DfmNode => !!n);
    if (nodes.length < 1) { throw new EditError('nada selecionado'); }
    const pai = nodes[0].parent;
    if (!pai || nodes.some(n => n.parent !== pai)) {
      throw new EditError('alinhamento só entre componentes do mesmo container');
    }
    const reg = this.registry();
    const [pw, ph] = pai.parent ? sizeOf(pai, reg)
      : [num(pai, 'clientwidth') || num(pai, 'width'),
         num(pai, 'clientheight') || num(pai, 'height')];
    const rects = place(visualKids(pai, reg), pw, ph, reg, 12, pai);
    const alvo = alignRects(
      nodes.map(n => ({ path: n.path, ...toXY(rects.get(n)) })), op, { w: pw, h: ph });
    const changes: TextChange[] = [];
    for (const n of nodes) {
      const pos = alvo.get(n.path);
      if (pos) { changes.push(...moveNode(doc, n, pos.x, pos.y)); }
    }
    return changes;
  }

  /**
   * I02 — cria o handler no .pas e liga no .dfm, como o duplo-clique do Delphi.
   *
   * As duas escrituras vão num WorkspaceEdit só: se o usuário desfizer, desfaz inteiro.
   * Um form com `OnClick = X` apontando para método inexistente não abre.
   */
  private async novoHandler(
    document: vscode.TextDocument, node: DfmNode, evento: string,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const pasUri = document.uri.with({ path: document.uri.path.replace(/\.(dfm|fmx)$/i, '.pas') });
    let pas: vscode.TextDocument;
    try {
      pas = await vscode.workspace.openTextDocument(pasUri);
    } catch {
      throw new EditError(`não achei ${pasUri.path.split('/').pop()} ao lado do form`);
    }

    const doc = this.load(document);
    const jaTem = node.props.get(evento.toLowerCase());
    const nome = jaTem ? txt(node, evento.toLowerCase()) : undefined;
    const r = criarHandler(pas.getText(), node.name, evento, nome);

    const edit = new vscode.WorkspaceEdit();
    const eolPas = pas.eol === vscode.EndOfLine.CRLF ? EOL_CRLF : EOL_LF;
    for (const e of [...r.edicoes].sort((a, b) => b.linha - a.linha)) {
      edit.insert(pasUri, new vscode.Position(e.linha, 0), e.texto + eolPas);
    }
    // liga o evento no .dfm, se ainda não estiver ligado
    if (!jaTem) {
      const changes = setProperty(doc, node, evento.toLowerCase(), r.metodo, 'control');
      const eol = document.eol === vscode.EndOfLine.CRLF ? EOL_CRLF : EOL_LF;
      for (const c of changes) {
        if (c.kind === 'replace') {
          edit.replace(document.uri, document.lineAt(c.line).range, c.text!);
        } else if (c.kind === 'insert') {
          edit.insert(document.uri, new vscode.Position(c.line, 0), c.text! + eol);
        }
      }
    }
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new EditError('o VS Code recusou a edição');
    }

    const pos = new vscode.Position(r.linhaCursor, 0);
    const ed = await vscode.window.showTextDocument(pas, {
      viewColumn: vscode.ViewColumn.Beside, preserveFocus: false,
    });
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    panel.webview.postMessage({ type: 'info', text: `${r.metodo} criado` });
  }

  /**
   * I11 — renomeia o componente no .dfm e na unit, num WorkspaceEdit só.
   *
   * Confirma antes porque o que acontece no .pas é uma substituição textual: o usuário
   * precisa ver quantas linhas mudam e quais handlers vêm junto.
   */
  private async renomear(
    document: vscode.TextDocument, doc: DfmDocument, node: DfmNode, novo: string,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const plano = planejar(doc, node, novo.trim());
    const pasUri = document.uri.with({ path: document.uri.path.replace(/\.(dfm|fmx)$/i, '.pas') });
    let pas: vscode.TextDocument | undefined;
    try {
      pas = await vscode.workspace.openTextDocument(pasUri);
    } catch {
      pas = undefined;
    }
    const noPas = pas ? mudancasPascal(pas.getText(), plano) : [];

    const detalhe = [
      `${plano.antigo} passa a ${plano.novo}.`,
      pas ? `${noPas.length} linha(s) em ${pasUri.path.split('/').pop()}.`
          : 'Não achei o .pas ao lado: só o .dfm será alterado.',
      plano.metodos.length
        ? 'Handlers: ' + plano.metodos.map(m => `${m.de} → ${m.para}`).join(', ') : '',
      plano.referencias.length
        ? 'Referências no form: ' + plano.referencias.join(', ') : '',
    ].filter(Boolean).join(' ');

    const resposta = await vscode.window.showWarningMessage(
      `Renomear ${plano.antigo}?`, { modal: true, detail: detalhe }, 'Renomear');
    if (resposta !== 'Renomear') { return; }

    const edit = new vscode.WorkspaceEdit();
    for (const c of mudancasDfm(doc, node, plano)) {
      edit.replace(document.uri, document.lineAt(c.line).range, c.text!);
    }
    if (pas) {
      for (const e of noPas) { edit.replace(pasUri, pas.lineAt(e.linha).range, e.texto); }
    }
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new EditError('o VS Code recusou a edição');
    }
    panel.webview.postMessage({ type: 'info', text: `${plano.antigo} → ${plano.novo}` });
  }

  /**
   * N06 — grava uma cópia binária do form.
   *
   * A árvore usada é a do arquivo aberto, recém-parseada: a do designer traz junto o que veio
   * de frame e de ancestral, e gravar isso produziria um form com os componentes do pai
   * duplicados dentro dele.
   */
  async salvarBinario(document: vscode.TextDocument): Promise<void> {
    const raiz = parseDfm(document.getText(), document.uri.fsPath);
    if (!raiz) { throw new EditError('não consegui ler este .dfm'); }
    const destino = await vscode.window.showSaveDialog({
      title: 'Gravar .dfm binário',
      defaultUri: document.uri,
      filters: { 'Delphi form': ['dfm'] },
    });
    if (!destino) { return; }
    const bytes = encodeBinaryDfm(raiz);
    await vscode.workspace.fs.writeFile(destino, bytes);
    vscode.window.showInformationMessage(
      `${destino.path.split('/').pop()} gravado em binário (${bytes.length} bytes). ` +
      'O designer abre binário só para leitura.');
  }

  /** P06 — a lista de frames também custa I/O: uma varredura por sessão basta. */
  private framesCache: ReturnType<typeof framesDoProjeto> | undefined;

  private frames(): ReturnType<typeof framesDoProjeto> {
    if (!this.framesCache) { this.framesCache = framesDoProjeto(this.registry()); }
    return this.framesCache;
  }

  /** P09 — modelos ficam no storage global: valem para qualquer projeto aberto depois. */
  private templates(): Template[] {
    return this.ctx.globalState.get<Template[]>(TEMPLATES, []);
  }

  private async salvarTemplate(
    document: vscode.TextDocument, node: DfmNode, panel: vscode.WebviewPanel,
  ): Promise<void> {
    const nome = await vscode.window.showInputBox({
      title: 'Salvar como modelo',
      prompt: `${node.name}: ${node.cls}` +
        (node.kids.length ? ` e ${node.kids.length} filho(s)` : ''),
      value: node.name,
    });
    if (!nome) { return; }
    const t = criarTemplate(document.getText(), node, nome);
    const lista = this.templates().filter(x => x.nome !== t.nome);
    lista.push(t);
    await this.ctx.globalState.update(TEMPLATES, lista);
    panel.webview.postMessage({ type: 'info', text: `modelo ${t.nome} salvo` });
  }

  /** A paleta, montada uma vez por sessão: a varredura dos .dfm custa alguns segundos. */
  private paletaCache: ReturnType<typeof todaPaleta> | undefined;

  private paleta(): ReturnType<typeof todaPaleta> {
    if (!this.paletaCache) {
      const raizes = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
      this.paletaCache = todaPaleta(this.registry(), contarComponentes(raizes));
    }
    return this.paletaCache;
  }

  /**
   * P03 — põe a unit da classe no `uses` do `.pas` irmão.
   *
   * Sem isso, o componente nasce no form e o projeto deixa de compilar: o `.dfm` referencia
   * uma classe que a unit não conhece.
   */
  private async registrarUses(document: vscode.TextDocument, cls: string): Promise<void> {
    // a unit do RTTI quando a classe veio de pacote; do arquivo quando veio de fonte
    const unit = this.registry().unitPascalDe(cls);
    if (!unit) { return; }
    const pasUri = document.uri.with({ path: document.uri.path.replace(/[.](dfm|fmx)$/i, '.pas') });
    let pas: vscode.TextDocument;
    try {
      pas = await vscode.workspace.openTextDocument(pasUri);
    } catch {
      return;   // .dfm sem .pas ao lado: nada a registrar
    }
    let edicoes;
    try {
      edicoes = garantirUses(pas.getText(), unit);
    } catch {
      return;
    }
    if (!edicoes.length) { return; }
    const edit = new vscode.WorkspaceEdit();
    const eol = pas.eol === vscode.EndOfLine.CRLF ? EOL_CRLF : EOL_LF;
    for (const e of edicoes) {
      if (e.kind === 'replace') {
        edit.replace(pasUri, pas.lineAt(e.linha).range, e.texto);
      } else {
        edit.insert(pasUri, new vscode.Position(e.linha, 0), e.texto + eol);
      }
    }
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * Mexe na classe do form no `.pas` irmão.
   *
   * O par `.dfm` + `.pas` tem de andar junto: componente no arquivo sem campo na classe
   * compila e quebra ao abrir a tela. Falhar aqui não pode desfazer a edição do `.dfm` — o
   * componente já foi criado, e o pior desfecho é o usuário ficar sem nenhum dos dois.
   */
  private async editarClasse(
    document: vscode.TextDocument, doc: DfmDocument,
    fazer: (texto: string, classe: string) => EdicaoPas[],
  ): Promise<string> {
    const classe = doc.root.cls;
    if (!classe) { return ''; }
    const pasUri = document.uri.with({
      path: document.uri.path.replace(/[.](dfm|fmx)$/i, '.pas') });
    let pas: vscode.TextDocument;
    try {
      pas = await vscode.workspace.openTextDocument(pasUri);
    } catch {
      return '';   // .dfm sem .pas ao lado
    }
    let edicoes: EdicaoPas[];
    try {
      edicoes = fazer(pas.getText(), classe);
    } catch {
      return ' (não consegui mexer na classe)';
    }
    if (!edicoes.length) { return ''; }
    const edit = new vscode.WorkspaceEdit();
    const eol = pas.eol === vscode.EndOfLine.CRLF ? EOL_CRLF : EOL_LF;
    for (const e of edicoes) {
      if (e.kind === 'delete') {
        edit.delete(pasUri, pas.lineAt(e.linha).rangeIncludingLineBreak);
      } else if (e.kind === 'replace') {
        edit.replace(pasUri, pas.lineAt(e.linha).range, e.texto);
      } else {
        edit.insert(pasUri, new vscode.Position(e.linha, 0), e.texto + eol);
      }
    }
    await vscode.workspace.applyEdit(edit);
    return ' e declarado na classe';
  }

  private load(document: vscode.TextDocument): DfmDocument {
    return new DfmDocument(document.uri.fsPath, document.getText(), this.registry());
  }

  private refresh(panel: vscode.WebviewPanel, document: vscode.TextDocument): void {
    let doc: DfmDocument;
    try {
      doc = this.load(document);
    } catch (err) {
      panel.webview.html = errorPage(err instanceof Error ? err.message : String(err));
      return;
    }
    const reg = this.registry();
    const media = (f: string) =>
      panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', f)).toString();
    const { html, stats } = renderForm(doc, reg, {
      flexLayout: this.flexByUri.get(document.uri.toString()) ?? doc.temLayoutControl,
      nonce: nonce(),
      cssUri: media('webview.css'),
      jsUri: media('webview.js'),
      paletaUri: media('palette.js'),
      inspetorUri: media('inspector.js'),
      dialogosUri: media('dialogs.js'),
    });
    panel.webview.html = html.replace('${cspSource}', panel.webview.cspSource);
    panel.title = `${doc.root.name || doc.root.cls}`;

    if (vscode.workspace.getConfiguration('delphi4vscode').get<boolean>('validate', true)) {
      this.diagnostics.set(document.uri, validate(doc, reg, document));
    }
    panel.webview.postMessage({
      type: 'loaded',
      stats, binary: doc.binary,
      structure: structureOf(doc, reg),
    });
  }

  private async handle(
    msg: WebMsg, document: vscode.TextDocument, panel: vscode.WebviewPanel,
  ): Promise<void> {
    const doc = this.load(document);
    const node = msg.path ? doc.index.get(msg.path) : undefined;

    if (msg.type === 'props') {
      if (!node) { throw new EditError('componente não encontrado'); }
      panel.webview.postMessage({
        type: 'props', data: inspect(doc, node, this.registry()) });
      return;
    }
    if (msg.type === 'propsMulti') {
      const nodes = (msg.paths ?? []).map(x => doc.index.get(x))
        .filter((n): n is DfmNode => !!n);
      if (!nodes.length) { throw new EditError('nada selecionado'); }
      panel.webview.postMessage({
        type: 'props', data: inspectMany(doc, nodes, this.registry()) });
      return;
    }
    if (msg.type === 'reveal' && node) {
      // levar o cursor até o componente no editor de texto, quando alguém abrir os dois
      const pos = new vscode.Position(node.line, 0);
      const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
      editor?.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      return;
    }
    if (msg.type === 'gotoCode' && msg.value) {
      await openMethod(document.uri, msg.value);
      return;
    }
    if (msg.type === 'novoHandler') {
      if (!node) { throw new EditError('componente não encontrado'); }
      await this.novoHandler(document, node, msg.key ?? 'OnClick', panel);
      return;
    }
    if (msg.type === 'paleta') {
      panel.webview.postMessage({ type: 'paleta', itens: this.paleta() });
      return;
    }
    if (msg.type === 'frames') {
      panel.webview.postMessage({ type: 'frames', itens: this.frames() });
      return;
    }
    if (msg.type === 'templates') {
      panel.webview.postMessage({ type: 'templates', itens: this.templates() });
      return;
    }
    if (msg.type === 'menu') {
      if (!node) { throw new EditError('componente não encontrado'); }
      if (!node.kids.length) { throw new EditError(`${node.name} não tem itens`); }
      panel.webview.postMessage({
        type: 'menu', path: node.path, nome: node.name, itens: lerMenu(node) });
      return;
    }
    /*
     * D03 — copiar e colar componentes entre forms.
     *
     * O que vai para a área de transferência é o bloco de texto do `.dfm`, com o recuo
     * normalizado. Assim funciona entre janelas, entre projetos, e continua legível se
     * alguém colar num e-mail — que é como esse tipo de coisa costuma circular num time.
     */
    if (msg.type === 'copiar') {
      if (!node) { throw new EditError('componente não encontrado'); }
      const t = criarTemplate(document.getText(), node, node.name || node.cls);
      await vscode.env.clipboard.writeText(t.linhas.join(EOL_CRLF));
      panel.webview.postMessage({
        type: 'info', text: `${node.name || node.cls} copiado (${t.linhas.length} linhas)` });
      return;
    }
    if (msg.type === 'colar') {
      if (!node) { throw new EditError('selecione o container que vai receber'); }
      const texto = (await vscode.env.clipboard.readText()).trim();
      if (!/^(object|inherited|inline)[ 	]/i.test(texto)) {
        throw new EditError('a área de transferência não tem um bloco de componente');
      }
      const doc2 = this.load(document);
      const alvo = doc2.index.get(msg.path!) ?? doc2.root;
      const r = inserirTemplate(doc2, alvo, {
        nome: "colado", cls: "", linhas: texto.split(SEPARADOR_LINHA),
      }, msg.left ?? 8, msg.top ?? 8);
      await applyChanges(document, r.changes);
      panel.webview.postMessage({ type: 'info', text: `${r.name} colado` });
      return;
    }
    if (msg.type === 'salvarTemplate') {
      if (!node) { throw new EditError('componente não encontrado'); }
      await this.salvarTemplate(document, node, panel);
      return;
    }
    // o atalho não chega à extensão com o foco na webview: o front reenvia por aqui
    if (msg.type === 'build' || msg.type === 'rebuild') {
      await vscode.commands.executeCommand(
        msg.type === 'build' ? 'delphi4vscode.build' : 'delphi4vscode.rebuild');
      return;
    }
    if (msg.type === 'openText') {
      await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      return;
    }

    if (doc.binary) {
      throw new EditError('este .dfm está em formato binário: só leitura');
    }

    let changes: TextChange[] = [];
    let aviso = '';
    switch (msg.type) {
      case 'move':
        if (!node) { throw new EditError('componente não encontrado'); }
        changes = moveNode(doc, node, msg.left ?? 0, msg.top ?? 0);
        break;
      case 'resize':
        if (!node) { throw new EditError('componente não encontrado'); }
        changes = resizeNode(doc, node, msg.w ?? 0, msg.h ?? 0);
        // C02 — container que muda de tamanho arrasta os filhos ancorados
        changes.push(...aplicarAnchors(doc, node,
          (msg.w ?? 0) - num(node, 'width'), (msg.h ?? 0) - num(node, 'height'),
          this.registry()));
        break;
      case 'resizeForm': {
        const raiz = doc.root;
        const w = msg.w ?? 0;
        const h = msg.h ?? 0;
        const dw = w - (num(raiz, 'clientwidth') || num(raiz, 'width'));
        const dh = h - (num(raiz, 'clientheight') || num(raiz, 'height'));
        const chave = raiz.props.has('clientwidth') ? 'client' : 'plain';
        changes = chave === 'client'
          ? setProperty(doc, raiz, 'clientwidth', String(w), 'control')
            .concat(setProperty(doc, raiz, 'clientheight', String(h), 'control'))
          : resizeNode(doc, raiz, w, h);
        changes.push(...aplicarAnchors(doc, raiz, dw, dh, this.registry()));
        aviso = `form em ${w} × ${h}`;
        break;
      }
      case 'reorder': {
        const outro = msg.other ? doc.index.get(msg.other) : undefined;
        if (!node || !outro) { throw new EditError('componente não encontrado'); }
        changes = reorderNodes(doc, node, outro);
        break;
      }
      case 'prop': {
        // I11 — Name muda o campo published da classe: passa pelo fluxo de renomear
        if (msg.key === 'name') {
          if (!node) { throw new EditError('componente não encontrado'); }
          await this.renomear(document, doc, node, msg.value ?? '', panel);
          return;
        }
        const alvos = msg.paths?.length
          ? msg.paths.map(x => doc.index.get(x)).filter((n): n is DfmNode => !!n)
          : node ? [node] : [];
        if (!alvos.length) { throw new EditError('componente não encontrado'); }
        // o seletor de cor devolve #rrggbb; o .dfm guarda $00BBGGRR
        const valor = (msg.value ?? '').startsWith('#')
          ? corDfm(msg.value!) : (msg.value ?? '');
        for (const n of alvos) {
          changes.push(...setProperty(doc, n, msg.key!, valor, msg.scope ?? 'control'));
        }
        if (alvos.length > 1) { aviso = `${msg.key} aplicada a ${alvos.length} componentes`; }
        break;
      }
      case 'setStrings':
        if (!node) { throw new EditError('componente não encontrado'); }
        changes = setStringsProp(doc, node, msg.key!, msg.lines ?? [],
                                 msg.scope ?? 'control');
        aviso = `${msg.key} atualizada`;
        break;
      case 'setCollection':
        if (!node) { throw new EditError('componente não encontrado'); }
        changes = setCollectionProp(doc, node, msg.key!, msg.ordem ?? [],
                                    msg.scope ?? 'control');
        aviso = 'coleção atualizada';
        break;
      case 'setCollectionItem':
        if (!node) { throw new EditError('componente não encontrado'); }
        changes = setCollectionItemProp(doc, node, msg.key!, msg.indice ?? 0,
                                        msg.label ?? '', msg.value ?? "''",
                                        msg.scope ?? 'control');
        break;
      case 'add': {
        if (!node) { throw new EditError('container não encontrado'); }
        const cls = msg.cls ?? 'TButton';
        const reg = this.registry();
        // P08 — sob layout control o componente precisa do TdxLayoutItem junto
        const destino = destinoNoLayout(doc, reg, node);
        const r = destino
          ? addNoLayout(doc, destino, cls, reg)
          : addComponent(doc, node, cls, msg.left ?? 8, msg.top ?? 8, reg);
        changes = r.changes;
        await this.registrarUses(document, cls);
        const naClasse = await this.editarClasse(document, doc,
          (texto, classe) => declararCampo(texto, classe, r.name, cls));
        aviso = (destino
          ? `${r.name} criado no grupo ${destino.grupo}` : `${r.name} criado`) + naClasse;
        break;
      }
      case 'addFrame': {
        if (!node) { throw new EditError('container não encontrado'); }
        const frame = this.frames().find(f => f.cls === msg.cls);
        if (!frame) { throw new EditError(`não achei o frame ${msg.cls}`); }
        const r = addFrame(doc, node, frame, msg.left ?? 8, msg.top ?? 8);
        changes = r.changes;
        await this.registrarUses(document, frame.cls);
        aviso = `${r.name} inserido`;
        break;
      }
      case 'inserirTemplate': {
        if (!node) { throw new EditError('container não encontrado'); }
        const t = this.templates().find(x => x.nome === msg.nome);
        if (!t) { throw new EditError(`não achei o modelo ${msg.nome}`); }
        const r = inserirTemplate(doc, node, t, msg.left ?? 8, msg.top ?? 8);
        changes = r.changes;
        aviso = `${r.name} criado a partir de ${t.nome}`;
        break;
      }
      case 'setMenu':
        if (!node) { throw new EditError('menu não encontrado'); }
        changes = setMenu(doc, document.getText(), node, msg.itens ?? []);
        aviso = 'menu atualizado';
        break;
      case 'delete': {
        if (!node) { throw new EditError('componente não encontrado'); }
        const nome = node.name;
        changes = removeComponent(doc, node);
        const daClasse = await this.editarClasse(document, doc,
          (texto, classe) => removerCampo(texto, classe, nome));
        aviso = `${nome} apagado` + (daClasse ? ' e tirado da classe' : '');
        break;
      }
      case 'duplicate': {
        if (!node) { throw new EditError('componente não encontrado'); }
        const r = duplicate(doc, document.getText(), node);
        changes = r.changes;
        aviso = `${r.name} criado`;
        break;
      }
      case 'reparent': {
        const destino = msg.other ? doc.index.get(msg.other) : undefined;
        if (!node || !destino) { throw new EditError('componente ou destino não encontrado'); }
        changes = reparent(doc, document.getText(), node, destino,
                           msg.left ?? 0, msg.top ?? 0);
        aviso = `${node.name} movido para ${destino.name}`;
        break;
      }
      case 'zorder':
        if (!node) { throw new EditError('componente não encontrado'); }
        changes = zOrder(doc, document.getText(), node,
                         msg.op === 'back' ? 'back' : 'front');
        break;
      case 'revert':
        if (!node) { throw new EditError('componente não encontrado'); }
        changes = revertInherited(doc, node, msg.key);
        aviso = msg.key ? `${msg.key} revertida` : `${node.name} revertido ao ancestral`;
        break;
      case 'align': {
        changes = this.alignMany(doc, msg.paths ?? [], msg.op as AlignOp);
        aviso = 'alinhado';
        break;
      }
      case 'sameSize': {
        const nodes = (msg.paths ?? []).map(p => doc.index.get(p))
          .filter((n): n is DfmNode => !!n);
        const eixo = msg.op === 'h' ? 'h' : 'w';
        const alvo = equalizeSize(nodes, eixo, 'max');
        for (const [n, v] of alvo) {
          const [w, h] = sizeOf(n, this.registry());
          changes.push(...resizeNode(doc, n, eixo === 'w' ? v : w, eixo === 'h' ? v : h));
        }
        aviso = 'tamanhos igualados';
        break;
      }
      case 'tabOrder': {
        // o alvo é o container: pede-se a ordem do pai do componente clicado
        const host = node?.parent ?? node;
        if (!host) { throw new EditError('componente não encontrado'); }
        const itens = tabOrderOf(host);
        if (!itens.length) {
          throw new EditError(`${host.name || host.cls} não tem filhos com TabOrder`);
        }
        panel.webview.postMessage({
          type: 'tabOrder', host: host.path, hostName: host.name || host.cls, data: itens,
        });
        return;
      }
      case 'applyTabOrder': {
        if (!node) { throw new EditError('container não encontrado'); }
        for (const { node: n, valor } of applyTabOrder(node, msg.paths ?? [])) {
          changes.push(...setProperty(doc, n, 'taborder', String(valor), 'control'));
        }
        aviso = changes.length ? 'ordem de tabulação atualizada' : 'a ordem já era essa';
        break;
      }
      default:
        return;
    }
    await applyChanges(document, changes);
    if (aviso) { panel.webview.postMessage({ type: 'info', text: aviso }); }
  }
}

/**
 * Aplica as mudanças como um único WorkspaceEdit — uma entrada só no undo.
 * Inserções vão de baixo para cima para os números de linha seguirem válidos.
 */
async function applyChanges(document: vscode.TextDocument, changes: TextChange[]): Promise<void> {
  if (!changes.length) { return; }
  const edit = new vscode.WorkspaceEdit();
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

  for (const c of changes.filter(c => c.kind === 'replace')) {
    // count > 1: o valor ocupa várias linhas (lista de strings, coleção)
    const fim = Math.min(c.line + (c.count ?? 1) - 1, document.lineCount - 1);
    edit.replace(document.uri, new vscode.Range(
      document.lineAt(c.line).range.start, document.lineAt(fim).range.end), c.text!);
  }
  const posteriores = changes.filter(c => c.kind !== 'replace')
    .sort((a, b) => b.line - a.line);
  for (const c of posteriores) {
    if (c.kind === 'insert') {
      edit.insert(document.uri, new vscode.Position(c.line, 0), c.text! + eol);
    } else {
      const fim = Math.min(c.line + (c.count ?? 1), document.lineCount);
      edit.delete(document.uri, new vscode.Range(
        new vscode.Position(c.line, 0), new vscode.Position(fim, 0)));
    }
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) { throw new EditError('o VS Code recusou a edição'); }
}

/** Abre o .pas irmão na implementação do método, para o clique no evento levar ao código. */
async function openMethod(dfmUri: vscode.Uri, method: string): Promise<void> {
  const pas = dfmUri.with({ path: dfmUri.path.replace(/\.(dfm|fmx)$/i, '.pas') });
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(pas);
  } catch {
    vscode.window.showWarningMessage(`Não achei ${pas.path.split('/').pop()}`);
    return;
  }
  const re = new RegExp(`^\\s*(?:procedure|function)\\s+[\\w.]*\\.?${method}\\b`, 'i');
  for (let i = 0; i < doc.lineCount; i++) {
    if (re.test(doc.lineAt(i).text)) {
      const pos = new vscode.Position(i, 0);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.Beside,
      });
      return;
    }
  }
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
  vscode.window.showInformationMessage(`${method} não tem implementação no .pas`);
}

/** Árvore completa, incluindo os não visuais — que na tela não existem. */
function structureOf(doc: DfmDocument, reg: Registry): unknown {
  const build = (n: DfmNode): unknown => ({
    name: n.name || '(sem nome)', cls: n.cls, path: n.path,
    visual: reg.isVisual(n), external: n.external,
    kids: n.kids.map(build),
  });
  return build(doc.root);
}

function toXY(r: { x: number; y: number; w: number; h: number } | undefined) {
  return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.w ?? 0, h: r?.h ?? 0 };
}

function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) { s += chars[Math.floor(Math.random() * chars.length)]; }
  return s;
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html><html><body style="font:13px sans-serif;padding:20px">
<h3>Não consegui abrir este .dfm</h3><pre>${msg.replace(/</g, '&lt;')}</pre>
<p>Use <b>Delphi Form: abrir como texto</b> para ver o arquivo cru.</p></body></html>`;
}

export { place, visualKids, walk, num };
