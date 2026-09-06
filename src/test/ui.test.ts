/**
 * C07 — o front exercitado por gestos, não por leitura de código.
 *
 * Os outros testes cruzam o JS com o HTML procurando seletor órfão. Estes carregam a página
 * de verdade num DOM, disparam clique, arrasto e tecla, e conferem a mensagem que sai. É o
 * que pega o handler registrado no elemento errado — que nenhuma varredura de texto acha.
 *
 * O jsdom não faz layout: `offsetWidth` e `getBoundingClientRect` devolvem zero. Por isso os
 * gestos aqui usam o que não depende de medida — `style.left`, que o próprio código escreve —
 * e o arrasto vai com Alt para dispensar as guias de alinhamento.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';
import { renderForm } from '../dfm/render';

const MEDIA = path.join(__dirname, '..', '..', 'media');
const SCRIPTS = ['webview.js', 'inspector.js', 'palette.js', 'dialogs.js'];

const SAMPLE = [
  'object Form1: TForm1',
  "  Caption = 'Exemplo'",
  '  ClientWidth = 400',
  '  ClientHeight = 300',
  '  object Panel1: TPanel',
  '    Left = 0',
  '    Top = 0',
  '    Width = 400',
  '    Height = 120',
  '    object Botao: TButton',
  '      Left = 40',
  '      Top = 40',
  '      Width = 75',
  '      Height = 25',
  "      Caption = 'OK'",
  '      OnClick = BotaoClick',
  '    end',
  '  end',
  '  object Timer1: TTimer',
  '    Left = 300',
  '    Top = 200',
  '  end',
  'end',
  '',
].join('\r\n');

const reg = Registry.fromJSON({
  parents: [
    ['tform1', 'tform'], ['tform', 'tcustomform'], ['tcustomform', 'twincontrol'],
    ['tpanel', 'tcustompanel'], ['tcustompanel', 'tcustomcontrol'],
    ['tcustomcontrol', 'twincontrol'],
    ['tbutton', 'tcustombutton'], ['tcustombutton', 'twincontrol'],
    ['ttimer', 'tcomponent'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
});

interface Palco {
  dom: JSDOM;
  doc: Document;
  win: Window & typeof globalThis;
  enviadas: Record<string, unknown>[];
  ultima(tipo: string): Record<string, unknown> | undefined;
}

function montar(): Palco {
  const documento = new DfmDocument('/x/Form1.dfm', SAMPLE, reg);
  const { html } = renderForm(documento, reg, {
    flexLayout: false, nonce: 'N', cssUri: 'c.css', jsUri: 'w.js',
    paletaUri: 'p.js', inspetorUri: 'i.js', dialogosUri: 'd.js',
  });
  const dom = new JSDOM(html.replace('${cspSource}', 'x'), {
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  const enviadas: Record<string, unknown>[] = [];
  (win as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (m: Record<string, unknown>) => { enviadas.push(m); },
    getState: () => undefined,
    setState: () => undefined,
  });
  // o jsdom não implementa scrollIntoView; sem o stub, o handler morre antes de postar
  (win.Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  for (const s of SCRIPTS) {
    dom.window.eval(fs.readFileSync(path.join(MEDIA, s), 'utf8'));
  }
  return {
    dom, win, doc: dom.window.document, enviadas,
    ultima: t => [...enviadas].reverse().find(m => m.type === t),
  };
}

function achar(p: Palco, nome: string): Element {
  const el = p.doc.querySelector(`[data-name="${nome}"]`);
  assert.ok(el, `não achei ${nome} no HTML`);
  return el!;
}

function mouse(p: Palco, alvo: EventTarget, tipo: string, x: number, y: number,
               extra: Record<string, unknown> = {}): void {
  const ev = new p.win.MouseEvent(tipo, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra,
  });
  alvo.dispatchEvent(ev);
}

function tecla(p: Palco, key: string, extra: Record<string, unknown> = {}): void {
  p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown',
    { bubbles: true, cancelable: true, key, ...extra }));
}

function mensagem(p: Palco, m: Record<string, unknown>): void {
  p.win.dispatchEvent(new p.win.MessageEvent('message', { data: m }));
}

// ---- seleção ----

test('clicar num componente pede as propriedades dele', () => {
  const p = montar();
  mouse(p, achar(p, 'Botao'), 'mousedown', 100, 100);
  const msg = p.ultima('props');
  assert.ok(msg, JSON.stringify(p.enviadas));
  assert.equal(msg!.path, 'Form1/Panel1/Botao');
});

test('clicar fora limpa a seleção sem pedir propriedades de ninguém', () => {
  const p = montar();
  mouse(p, achar(p, 'Botao'), 'mousedown', 100, 100);
  p.enviadas.length = 0;
  const cliente = p.doc.querySelector('.client')!;
  mouse(p, cliente, 'mousedown', 380, 280);
  assert.equal(p.doc.querySelectorAll('.c.sel').length, 0);
  assert.equal(p.ultima('props'), undefined, JSON.stringify(p.enviadas));
});

test('a árvore de estrutura seleciona o mesmo componente', () => {
  const p = montar();
  mensagem(p, {
    type: 'loaded', stats: { visuais: 2, editaveis: 2, travados: 0, externos: 0 },
    structure: {
      name: 'Form1', cls: 'TForm1', path: 'Form1', visual: true, external: false,
      kids: [{ name: 'Botao', cls: 'TButton', path: 'Form1/Panel1/Botao',
               visual: true, external: false, kids: [] }],
    },
  });
  const linha = p.doc.querySelector('.st-r[data-path="Form1/Panel1/Botao"]');
  assert.ok(linha, 'a árvore não desenhou o componente');
  mouse(p, linha!, 'click', 10, 10);
  assert.equal(p.ultima('reveal')?.path, 'Form1/Panel1/Botao');
});

// ---- arrastar e teclado ----

function arrastar(p: Palco, nome: string, dx: number, dy: number): void {
  const el = achar(p, nome);
  mouse(p, el, 'mousedown', 100, 100);
  mouse(p, p.doc, 'mousemove', 100 + dx, 100 + dy, { altKey: true });
  mouse(p, p.doc, 'mouseup', 100 + dx, 100 + dy, { altKey: true });
}

test('arrastar um componente grava a posição nova', () => {
  const p = montar();
  arrastar(p, 'Botao', 20, 10);
  const msg = p.ultima('move');
  assert.ok(msg, JSON.stringify(p.enviadas));
  assert.equal(msg!.path, 'Form1/Panel1/Botao');
  assert.equal(msg!.left, 60, 'estava em 40, andou 20');
  assert.equal(msg!.top, 50);
});

test('travar as posições bloqueia o arrasto, não a seleção', () => {
  const p = montar();
  tecla(p, 'l', { ctrlKey: true });
  arrastar(p, 'Botao', 20, 10);
  assert.equal(p.ultima('move'), undefined, 'travado não podia mover');
  assert.ok(p.ultima('props'), 'mas a seleção continua funcionando');
  tecla(p, 'l', { ctrlKey: true });
  arrastar(p, 'Botao', 20, 10);
  assert.ok(p.ultima('move'), 'destravado volta a mover');
});

test('as setas movem o selecionado, com Shift em passo maior', () => {
  const p = montar();
  mouse(p, achar(p, 'Botao'), 'mousedown', 100, 100);
  tecla(p, 'ArrowRight');
  assert.equal(p.ultima('move')?.left, 41);
  tecla(p, 'ArrowDown', { shiftKey: true });
  assert.equal(p.ultima('move')?.top, 48);
});

test('Delete apaga o selecionado e Insert abre a paleta', () => {
  const p = montar();
  mouse(p, achar(p, 'Botao'), 'mousedown', 100, 100);
  tecla(p, 'Delete');
  assert.equal(p.ultima('delete')?.path, 'Form1/Panel1/Botao');
  tecla(p, 'Insert');
  assert.ok(p.ultima('paleta'), 'a paleta precisa pedir a lista');
  assert.equal(p.doc.querySelector('#pal')!.hasAttribute('hidden'), false);
});

test('duplo clique cria o handler de OnClick', () => {
  const p = montar();
  const el = achar(p, 'Botao');
  el.dispatchEvent(new p.win.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  const msg = p.ultima('novoHandler');
  // o objeto vem do realm do jsdom: comparar campo a campo, não por identidade de protótipo
  assert.equal(msg?.path, 'Form1/Panel1/Botao');
  assert.equal(msg?.key, 'OnClick');
});

// ---- zoom ----

test('o zoom muda o rótulo e a escala da área do form', () => {
  const p = montar();
  assert.equal(p.doc.querySelector('#zlvl')!.textContent, '100%');
  mouse(p, p.doc.querySelector('#zin')!, 'click', 0, 0);
  assert.equal(p.doc.querySelector('#zlvl')!.textContent, '125%');
  mouse(p, p.doc.querySelector('#zlvl')!, 'click', 0, 0);
  assert.equal(p.doc.querySelector('#zlvl')!.textContent, '100%', 'clicar no rótulo volta');
});

// ---- menu de contexto ----

test('o menu de contexto muda conforme o que está selecionado', () => {
  const p = montar();
  const el = achar(p, 'Botao');
  el.dispatchEvent(new p.win.MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
  const menu = p.doc.querySelector('#ctx')!;
  assert.equal(menu.hasAttribute('hidden'), false);
  const cmds = [...menu.querySelectorAll('.ctx-i')].map(i => (i as HTMLElement).dataset.cmd);
  assert.ok(cmds.includes('duplicate'), cmds.join(','));
  assert.ok(cmds.includes('taborder'), cmds.join(','));
  assert.ok(!cmds.includes('al-left'), 'alinhar exige seleção múltipla: ' + cmds.join(','));
  assert.ok(!cmds.includes('editarMenu'), 'não é um menu: ' + cmds.join(','));
});

test('o item do menu dispara o comando certo', () => {
  const p = montar();
  const el = achar(p, 'Botao');
  el.dispatchEvent(new p.win.MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
  const item = p.doc.querySelector('.ctx-i[data-cmd="duplicate"]')!;
  mouse(p, item, 'click', 50, 50);
  assert.equal(p.ultima('duplicate')?.path, 'Form1/Panel1/Botao');
  assert.equal(p.doc.querySelector('#ctx')!.hasAttribute('hidden'), true);
});

// ---- inspetor ----

const PROPS = {
  type: 'props',
  data: {
    name: 'Botao', cls: 'TButton', file: 'Form1.dfm', editable: true, via: '',
    item: null, alvos: 1, groups: [], crumbs: [{ name: 'Form1', path: 'Form1' }],
    rows: [
      { key: 'caption', label: 'Caption', cat: 'Texto', type: 'str', value: 'OK',
        scope: 'control', from: 'Form1.dfm', own: true, event: false },
      { key: 'left', label: 'Left', cat: 'Layout', type: 'int', value: '40',
        scope: 'control', from: 'Form1.dfm', own: true, event: false },
      { key: 'color', label: 'Color', cat: 'Aparência', type: 'color', value: 'clRed',
        color: '#ff0000', scope: 'control', from: 'Form1.dfm', own: true, event: false },
      { key: 'font.style', label: 'Font.Style', cat: 'Texto', type: 'set', value: '[fsBold]',
        setItems: [{ nome: 'fsBold', on: true }, { nome: 'fsItalic', on: false }],
        scope: 'control', from: 'Form1.dfm', own: true, event: false,
        group: 'Font', sub: 'Style' },
      { key: 'onclick', label: 'OnClick', cat: 'Outras', type: 'enum', value: 'BotaoClick',
        scope: 'control', from: 'Form1.dfm', own: true, event: true },
    ],
  },
};

function inspecionar(p: Palco): void {
  mouse(p, achar(p, 'Botao'), 'mousedown', 100, 100);
  mensagem(p, PROPS);
}

test('o inspetor separa propriedades de eventos em abas', () => {
  const p = montar();
  inspecionar(p);
  const abas = [...p.doc.querySelectorAll('[data-oitab]')]
    .map(b => (b as HTMLElement).textContent);
  assert.equal(abas.length, 2, abas.join('|'));
  assert.ok(abas[0]!.includes('4'), 'quatro propriedades: ' + abas[0]);
  assert.ok(abas[1]!.includes('1'), 'um evento: ' + abas[1]);

  const painelProps = p.doc.querySelector('[data-oipane="props"]')!;
  assert.equal(painelProps.hasAttribute('hidden'), false);
  assert.ok(!painelProps.querySelector('[data-key="onclick"]'), 'evento não é propriedade');

  mouse(p, p.doc.querySelector('[data-oitab="events"]')!, 'click', 0, 0);
  const painelEv = p.doc.querySelector('[data-oipane="events"]')!;
  assert.equal(painelEv.hasAttribute('hidden'), false);
  assert.ok(painelEv.querySelector('[data-key="onclick"]'), 'o evento tinha de estar aqui');
});

test('editar uma propriedade manda o valor novo', () => {
  const p = montar();
  inspecionar(p);
  const campo = p.doc.querySelector('.oi-row[data-key="caption"] input') as HTMLInputElement;
  assert.ok(campo, 'sem campo para o Caption');
  campo.value = 'Salvar';
  campo.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  const msg = p.ultima('prop');
  assert.deepEqual(
    { key: msg?.key, value: msg?.value, path: msg?.path },
    { key: 'caption', value: 'Salvar', path: 'Form1/Panel1/Botao' });
});

test('a cor tem amostra e caixa de texto, e as duas gravam', () => {
  const p = montar();
  inspecionar(p);
  const amostra = p.doc.querySelector('.oi-row[data-key="color"] .oi-swatch') as HTMLInputElement;
  assert.ok(amostra, 'faltou o seletor de cor');
  assert.equal(amostra.getAttribute('value'), '#ff0000');
  amostra.value = '#00ff00';
  amostra.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  assert.equal(p.ultima('prop')?.value, '#00ff00');
});

test('sub-propriedade fica escondida até abrir o grupo', () => {
  const p = montar();
  inspecionar(p);
  const grupo = p.doc.querySelector('.oi-subh') as HTMLElement;
  assert.ok(grupo, 'Font.Style tinha de virar grupo Font');
  const caixa = p.doc.querySelector('.oi-subg')!;
  assert.equal(caixa.hasAttribute('hidden'), true, 'começa fechado');
  mouse(p, grupo, 'click', 0, 0);
  assert.equal(p.doc.querySelector('.oi-subg')!.hasAttribute('hidden'), false);
});

test('conjunto abre caixa com marcação e grava o valor montado', () => {
  const p = montar();
  inspecionar(p);
  mouse(p, p.doc.querySelector('.oi-subh')!, 'click', 0, 0);
  const botao = p.doc.querySelector('.oi-row[data-key="font.style"] .oi-blk')!;
  mouse(p, botao, 'click', 0, 0);
  const caixas = p.doc.querySelectorAll('[data-si]');
  assert.equal(caixas.length, 2, 'duas opções de estilo');
  (caixas[1] as HTMLInputElement).checked = true;
  mouse(p, p.doc.querySelector('#d-ok')!, 'click', 0, 0);
  assert.equal(p.ultima('prop')?.value, '[fsBold, fsItalic]');
});

test('o filtro esconde o que não casa', () => {
  const p = montar();
  inspecionar(p);
  const q = p.doc.querySelector('#oi-q') as HTMLInputElement;
  q.value = 'capt';
  q.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  const caption = p.doc.querySelector('.oi-row[data-key="caption"]') as HTMLElement;
  const left = p.doc.querySelector('.oi-row[data-key="left"]') as HTMLElement;
  assert.equal(caption.hidden, false);
  assert.equal(left.hidden, true);
});

test('ordem alfabética some com as categorias', () => {
  const p = montar();
  inspecionar(p);
  assert.ok(p.doc.querySelector('.oi-sec'), 'por padrão vem em categorias');
  mouse(p, p.doc.querySelector('#oi-alpha')!, 'click', 0, 0);
  assert.equal(p.doc.querySelector('[data-oipane="props"] .oi-sec'), null);
  const rotulos = [...p.doc.querySelectorAll('[data-oipane="props"] .oi-row label')]
    .map(l => l.textContent);
  assert.deepEqual(rotulos, [...rotulos].sort((a, b) => a!.localeCompare(b!)));
});

test('clicar no evento leva ao código', () => {
  const p = montar();
  inspecionar(p);
  mouse(p, p.doc.querySelector('[data-oitab="events"]')!, 'click', 0, 0);
  const botao = p.doc.querySelector('.oi-ev')!;
  mouse(p, botao, 'click', 0, 0);
  assert.equal(p.ultima('gotoCode')?.value, 'BotaoClick');
});

// ---- não visuais e paleta ----

test('o componente não visual aparece na faixa e é inspecionável', () => {
  const p = montar();
  const chip = p.doc.querySelector('.nv-i[data-name="Timer1"]');
  assert.ok(chip, 'TTimer tinha de estar na faixa de não visuais');
  mouse(p, chip!, 'click', 0, 0);
  assert.equal(p.ultima('props')?.path, 'Form1/Timer1');
});

test('a paleta desenha as categorias e cria no selecionado', () => {
  const p = montar();
  mouse(p, achar(p, 'Panel1'), 'mousedown', 10, 10);
  tecla(p, 'Insert');
  mensagem(p, {
    type: 'paleta',
    itens: [
      { cls: 'TcxButton', kind: 'btn', uso: 120, visual: true, unit: 'cxButtons' },
      { cls: 'TDataSource', kind: 'misc', uso: 30, visual: false, unit: 'Data.DB' },
    ],
  });
  const cats = [...p.doc.querySelectorAll('#pal [data-cat]')]
    .map(b => (b as HTMLElement).dataset.cat);
  // a aba inicial é "no projeto": com todos os instalados a lista passa de dois mil
  assert.deepEqual(cats, ['usados', '*', 'btn', 'nv'], cats.join(','));

  mouse(p, p.doc.querySelector('#pal .pl-i')!, 'click', 0, 0);
  const msg = p.ultima('add');
  assert.equal(msg?.cls, 'TcxButton');
  assert.equal(msg?.path, 'Form1/Panel1');
});

test('filtrar a paleta reduz a lista sem perder o foco do campo', () => {
  const p = montar();
  tecla(p, 'Insert');
  mensagem(p, {
    type: 'paleta',
    itens: [
      { cls: 'TcxButton', kind: 'btn', uso: 120, visual: true, unit: 'cxButtons' },
      { cls: 'TcxGrid', kind: 'grid', uso: 90, visual: true, unit: 'cxGrid' },
    ],
  });
  const q = p.doc.querySelector('#pl-q') as HTMLInputElement;
  q.value = 'grid';
  q.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  const itens = [...p.doc.querySelectorAll('#pal .pl-i')]
    .map(i => (i as HTMLElement).dataset.cls);
  assert.deepEqual(itens, ['TcxGrid']);
  assert.equal(p.doc.activeElement?.id, 'pl-q', 'o campo de filtro perdeu o foco');
});

// ---- sincronia com o texto ----

test('a extensão consegue selecionar pelo caminho', () => {
  const p = montar();
  mensagem(p, { type: 'select', path: 'Form1/Panel1/Botao' });
  const sel = p.doc.querySelector('.c.sel') as HTMLElement;
  assert.ok(sel, 'nada ficou selecionado');
  assert.equal(sel.dataset.name, 'Botao');
});

test('erro da extensão aparece na barra', () => {
  const p = montar();
  mensagem(p, { type: 'error', text: 'não deu' });
  const st = p.doc.querySelector('#st')!;
  assert.equal(st.textContent, 'não deu');
  assert.ok(st.className.includes('err'));
});

/*
 * Com o foco na webview o VS Code não entrega os atalhos da extensão — a tecla morre no
 * iframe. Foi assim que o Ctrl+F9 deixou de fazer qualquer coisa com o form aberto, sem
 * erro nenhum para explicar. O front reenvia, e este teste guarda esse caminho.
 */
test('F9 dentro do designer pede o build à extensão', () => {
  const p = montar();
  tecla(p, 'F9', { ctrlKey: true });
  assert.ok(p.ultima('build'), JSON.stringify(p.enviadas));
  tecla(p, 'F9', { shiftKey: true });
  assert.ok(p.ultima('rebuild'), JSON.stringify(p.enviadas));
});

test('o botão de compilar na barra faz o mesmo', () => {
  const p = montar();
  const b = p.doc.querySelector('#build-btn');
  assert.ok(b, 'a barra precisa do botão de compilar');
  mouse(p, b!, 'click', 0, 0);
  assert.ok(p.ultima('build'), JSON.stringify(p.enviadas));
});

/*
 * Todo elemento marcado `hidden` tem de estar mesmo escondido.
 *
 * O atributo `hidden` vem do user-agent, e regra de user-agent perde para qualquer regra de
 * autor: um `#dlg { display: flex }` deixa o overlay visível mesmo com `hidden` no HTML. Foi
 * assim que o designer passou a aparecer escurecido, com um retângulo preto a 45% por cima
 * da tela inteira comendo todos os cliques — e nada no JS denunciava isso.
 */
test('o que está hidden não é desenhado', () => {
  const css = fs.readFileSync(path.join(MEDIA, 'webview.css'), 'utf8');
  const dom = new JSDOM(`<style>${css}</style>` +
    ['dlg', 'ctx', 'hud', 'lasso', 'guides'].map(id => `<div id="${id}" hidden></div>`).join('') +
    '<div id="pal" class="pal" hidden></div>' +
    '<div data-tab-pane="1" hidden></div><div class="oi-subg" hidden></div>');
  const w = dom.window;
  for (const el of [...w.document.querySelectorAll('[hidden]')]) {
    const display = w.getComputedStyle(el).display;
    const quem = (el as HTMLElement).id || (el as HTMLElement).className;
    assert.equal(display, 'none', `${quem} continua visível mesmo com hidden`);
  }
});

test('o overlay do diálogo cobre a tela — logo, não pode vazar visível', () => {
  const css = fs.readFileSync(path.join(MEDIA, 'webview.css'), 'utf8');
  // se um dia o overlay deixar de cobrir tudo, este teste perde o motivo de existir
  assert.match(css, /#dlg\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/,
    'o #dlg deixou de ser um overlay de tela cheia');
  const dom = new JSDOM(`<style>${css}</style><div id="dlg" hidden></div>`);
  assert.equal(
    dom.window.getComputedStyle(dom.window.document.getElementById('dlg')!).display, 'none');
});

/*
 * Geometria: o número mostrado tem de ser o número gravado.
 *
 * O recuo da área cliente de um container (bevel, BorderWidth, rótulo de GroupBox) desloca o
 * desenho, mas não pode entrar nas coordenadas — o front lê `style.left` para gravar `Left`,
 * e somar o recuo ali fazia o arrasto gravar a posição errada.
 */
test('a coordenada desenhada é a mesma que está no .dfm', async () => {
  const { place, visualKids, insetCliente } = await import('../dfm/layout');
  const { DfmDocument } = await import('../dfm/document');
  const src = [
    'object Form1: TForm1',
    '  ClientWidth = 400',
    '  ClientHeight = 300',
    '  object Painel: TPanel',
    '    Left = 20',
    '    Top = 30',
    '    Width = 200',
    '    Height = 100',
    '    object Dentro: TButton',
    '      Left = 8',
    '      Top = 8',
    '      Width = 75',
    '      Height = 25',
    '    end',
    '  end',
    'end',
    '',
  ].join('\r\n');
  const d = new DfmDocument('/x/F.dfm', src, reg);
  const painel = d.byName.get('Painel')!;
  const dentro = d.byName.get('Dentro')!;

  const noForm = place(visualKids(d.root, reg), 400, 300, reg, 12, d.root);
  assert.deepEqual(
    (({ x, y }) => ({ x, y }))(noForm.get(painel)!), { x: 20, y: 30 },
    'o painel fica onde o .dfm diz');

  const noPainel = place(visualKids(painel, reg), 200, 100, reg, 12, painel);
  assert.deepEqual(
    (({ x, y }) => ({ x, y }))(noPainel.get(dentro)!), { x: 8, y: 8 },
    'o filho também: o recuo do bevel é desenho, não coordenada');

  // e o recuo existe, senão o painel apareceria sem espessura nenhuma
  assert.ok(insetCliente(painel, reg).x >= 1, 'TPanel nasce com BevelOuter = bvRaised');
});

test('BevelOuter = bvNone não recua a área cliente', async () => {
  const { insetCliente } = await import('../dfm/layout');
  const { DfmDocument } = await import('../dfm/document');
  const semBevel = new DfmDocument('/x/F.dfm', [
    'object Form1: TForm1', '  ClientWidth = 400', '  ClientHeight = 300',
    '  object P: TPanel', '    Left = 0', '    Top = 0', '    Width = 100', '    Height = 50',
    '    BevelOuter = bvNone', '  end', 'end', '',
  ].join('\r\n'), reg);
  assert.equal(insetCliente(semBevel.byName.get('P')!, reg).x, 0,
    'o .dfm diz que não há bevel: descontar mesmo assim soma erro a cada nível');
});

test('BorderWidth entra no recuo, como no Delphi', async () => {
  const { insetCliente } = await import('../dfm/layout');
  const { DfmDocument } = await import('../dfm/document');
  const d = new DfmDocument('/x/F.dfm', [
    'object Form1: TForm1', '  ClientWidth = 400', '  ClientHeight = 300',
    '  object P: TPanel', '    Left = 0', '    Top = 0', '    Width = 100', '    Height = 50',
    '    BevelOuter = bvNone', '    BorderWidth = 4', '  end', 'end', '',
  ].join('\r\n'), reg);
  assert.equal(insetCliente(d.byName.get('P')!, reg).x, 4);
});

test('a altura do título do form é a mesma no HTML e no CSS', async () => {
  const { ALTURA_TITULO } = await import('../dfm/render');
  const css = fs.readFileSync(path.join(MEDIA, 'webview.css'), 'utf8');
  // `[^}]*` guloso casaria `line-height`; a busca é pela altura declarada, não por ela
  const bloco = /\.title\s*\{([^}]*)\}/.exec(css)![1];
  const m = /(?:^|;)\s*height:\s*(\d+)px/.exec(bloco);
  assert.ok(m, 'o .title precisa de altura fixa: por soma de padding ela muda com a fonte');
  assert.equal(Number(m![1]), ALTURA_TITULO,
    'CSS e render discordando põem a área cliente fora de lugar');
});

test('a moldura do form não come largura da área cliente', () => {
  const css = fs.readFileSync(path.join(MEDIA, 'webview.css'), 'utf8');
  const bloco = /\.form\s*\{[^}]*\}/.exec(css)![0];
  assert.ok(/outline:/.test(bloco), bloco);
  assert.ok(!/[^-]border:\s*\d/.test(bloco),
    'com box-sizing: border-box, a borda tiraria 2px do ClientWidth');
});
