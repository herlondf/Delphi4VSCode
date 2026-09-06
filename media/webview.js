/**
 * Front do editor visual.
 *
 * Toda edição vira uma mensagem para a extensão, que aplica um WorkspaceEdit. A webview
 * nunca escreve em disco — e por isso o Ctrl+Z aqui é o do VS Code, não uma pilha nossa.
 */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = s => document.querySelector(s);
  const state = {
    sel: null, multi: [], inspect: null, filtro: '', alvos: 0,
    travado: false,   // D10 — Lock Controls
    zoom: 1,          // D14
  };
  const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
  const SNAP = 5;

  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const geom = el => ({
    l: parseInt(el.style.left) || 0, t: parseInt(el.style.top) || 0,
    w: el.offsetWidth, h: el.offsetHeight,
  });

  function status(txt, cls) {
    const s = $('#st');
    if (s) { s.textContent = txt; s.className = 'st ' + (cls || ''); }
  }

  // ---- seleção ----
  function select(el) {
    if (state.sel) { state.sel.classList.remove('sel'); }
    state.sel = el;
    state.alvos = el ? 1 : 0;
    if (!el) { state.inspect = null; pintarProps(null); return; }
    el.classList.add('sel');
    const g = geom(el);
    const modo = el.dataset.mode;
    status(`${el.dataset.name}: ${el.dataset.cls}  ${g.w}×${g.h}` +
      (modo ? '' : ` — travado: ${el.dataset.why}`));
    state.inspect = el.dataset.path;
    post({ type: 'props', path: el.dataset.path });
  }

  function post(msg) { vscode.postMessage(msg); }

  /*
   * Escapa um caminho para dentro das aspas de um seletor de atributo.
   *
   * Não é trabalho para `CSS.escape`: ela escapa identificador, e um caminho como
   * `Form1/Panel1/Botao` sai de lá com barra invertida antes de cada `/` — o que dentro de
   * `[data-path="..."]` já não quer dizer a mesma coisa. Aqui só a aspa e a própria barra
   * invertida precisam de escape.
   */
  function sel(valor) {
    return String(valor).replace(/[\\\"]/g, function (c) { return '\\' + c; });
  }

  // ---- zoom (D14) ----
  function aplicarZoom(z) {
    state.zoom = Math.min(2, Math.max(0.5, z));
    const wrap = document.querySelector('.wrap');
    if (wrap) { wrap.style.zoom = state.zoom; }
    const lbl = $('#zlvl');
    if (lbl) { lbl.textContent = Math.round(state.zoom * 100) + '%'; }
  }
  /** D04 — o maior zoom em que o form inteiro cabe na área visível. */
  function caber() {
    const forma = document.querySelector('.form');
    const area = document.querySelector('.wrap');
    if (!forma || !area) { return; }
    const disp = { w: area.clientWidth - 48, h: window.innerHeight - 120 };
    const alvo = Math.min(disp.w / forma.offsetWidth, disp.h / forma.offsetHeight, 2);
    aplicarZoom(Math.max(0.5, Math.round(alvo * 20) / 20));
    status(`ajustado para ${Math.round(state.zoom * 100)}%`);
  }

  function passoZoom(dir) {
    const i = ZOOMS.findIndex(z => Math.abs(z - state.zoom) < 0.01);
    const base = i >= 0 ? i : ZOOMS.indexOf(1);
    aplicarZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, base + dir))]);
  }

  // ---- travar posições (D10) ----
  function alternarTrava() {
    state.travado = !state.travado;
    document.body.classList.toggle('travado', state.travado);
    const b = $('#lock');
    if (b) { b.textContent = state.travado ? '🔒' : '🔓'; }
    status(state.travado
      ? 'posições travadas: seleção e propriedades continuam liberadas'
      : 'posições liberadas');
  }

  /** D12 — o número que se persegue ao arrastar aparece junto do cursor. */
  function hud(texto, x, y) {
    const h = $('#hud');
    if (!h) { return; }
    if (!texto) { h.hidden = true; return; }
    h.textContent = texto;
    h.style.left = (x + 14) + 'px';
    h.style.top = (y + 16) + 'px';
    h.hidden = false;
  }

  // ---- guias de alinhamento ----
  function siblingsOf(el) {
    return [...el.parentElement.children].filter(c => c !== el && c.classList?.contains('c'));
  }
  function snap(el, l, t) {
    const w = el.offsetWidth, h = el.offsetHeight, guides = [];
    let sl = l, st = t;
    for (const s of siblingsOf(el)) {
      const pares = [
        [l, s.offsetLeft, 'v'], [l + w, s.offsetLeft + s.offsetWidth, 'v'],
        [l + w / 2, s.offsetLeft + s.offsetWidth / 2, 'v'],
        [t, s.offsetTop, 'h'], [t + h, s.offsetTop + s.offsetHeight, 'h'],
        [t + h / 2, s.offsetTop + s.offsetHeight / 2, 'h'],
      ];
      for (const [meu, dele, eixo] of pares) {
        if (Math.abs(meu - dele) > SNAP) { continue; }
        if (eixo === 'v') { sl = l + (dele - meu); guides.push({ x: dele }); }
        else { st = t + (dele - meu); guides.push({ y: dele }); }
      }
    }
    return { l: sl, t: st, guides };
  }
  function showGuides(el, list) {
    const box = $('#guides');
    if (!list.length) { box.innerHTML = ''; return; }
    const host = el.parentElement.getBoundingClientRect();
    const page = document.body.getBoundingClientRect();
    const z = state.zoom;
    box.innerHTML = list.map(g => g.x !== undefined
      ? `<i style="left:${host.left - page.left + g.x * z}px;top:${host.top - page.top}px;` +
        `height:${host.height}px;width:1px"></i>`
      : `<i style="top:${host.top - page.top + g.y * z}px;left:${host.left - page.left}px;` +
        `width:${host.width}px;height:1px"></i>`).join('');
  }

  // ---- arrastar, redimensionar, reordenar ----
  let act = null;
  document.addEventListener('mousedown', e => {
    if (e.button === 2) { return; }               // botão direito abre o menu, não arrasta
    // a alça do próprio form: redimensiona a área cliente (C02)
    if (e.target.classList.contains('form-grip')) {
      const cliente = document.querySelector('.client');
      if (cliente && !state.travado) {
        act = { type: 'form', el: cliente, x: e.clientX, y: e.clientY,
                l: 0, t: 0, w: cliente.offsetWidth, h: cliente.offsetHeight };
        e.preventDefault();
      }
      return;
    }
    const el = e.target.closest('.c');
    if (!el) {
      select(null);
      if (!e.ctrlKey && !e.shiftKey) { clearMulti(); }
      const host = e.target.closest('.client, .c');
      if (host) { act = { type: 'lasso', host, x: e.clientX, y: e.clientY }; }
      return;
    }
    if (e.ctrlKey || e.shiftKey) { toggleMulti(el); e.preventDefault(); return; }
    if (!state.multi.includes(el)) { clearMulti(); }
    select(el);
    const modo = el.dataset.mode;
    if (!modo) { return; }
    if (state.travado) { return; }
    const g = geom(el);
    if (e.target.classList.contains('grip')) {
      act = { type: 'resize', el, x: e.clientX, y: e.clientY, ...g,
              dir: e.target.dataset.dir || 'se' };
    }
    else if (modo === 'free') { act = { type: 'move', el, x: e.clientX, y: e.clientY, ...g }; }
    else { act = { type: 'swap', el, x: e.clientX, y: e.clientY }; }
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', e => {
    if (!act) { return; }
    const passo = e.shiftKey ? 8 : 1;
    // com zoom, um pixel de tela não é um pixel do form
    const dx = (e.clientX - act.x) / state.zoom, dy = (e.clientY - act.y) / state.zoom;
    if (act.type === 'move') {
      let nl = Math.round((act.l + dx) / passo) * passo;
      let nt = Math.round((act.t + dy) / passo) * passo;
      if (!e.altKey) {
        const g = snap(act.el, nl, nt);
        nl = g.l; nt = g.t; showGuides(act.el, g.guides);
      } else { showGuides(act.el, []); }
      act.el.style.left = nl + 'px';
      act.el.style.top = nt + 'px';
      hud(`${nl}, ${nt}`, e.clientX, e.clientY);
    } else if (act.type === 'resize') {
      // a direção da alça decide o que cresce e se a origem também anda
      const d = act.dir;
      let { l, t, w, h } = act;
      if (d.includes('e')) { w = act.w + dx; }
      if (d.includes('s')) { h = act.h + dy; }
      if (d.includes('w')) { w = act.w - dx; l = act.l + dx; }
      if (d.includes('n')) { h = act.h - dy; t = act.t + dy; }
      w = Math.max(4, Math.round(w / passo) * passo);
      h = Math.max(4, Math.round(h / passo) * passo);
      if (d.includes('w')) { l = act.l + (act.w - w); }
      if (d.includes('n')) { t = act.t + (act.h - h); }
      Object.assign(act.el.style, { width: w + 'px', height: h + 'px',
                                    left: l + 'px', top: t + 'px' });
      hud(`${w} × ${h}`, e.clientX, e.clientY);
    } else if (act.type === 'form') {
      const w = Math.max(40, Math.round((act.w + dx) / passo) * passo);
      const h = Math.max(40, Math.round((act.h + dy) / passo) * passo);
      const forma = act.el.parentElement;
      Object.assign(act.el.style, { width: w + 'px', height: h + 'px' });
      forma.style.width = w + 'px';
      forma.style.height = (h + act.el.offsetTop) + 'px';
      hud(`form ${w} × ${h}`, e.clientX, e.clientY);
    } else if (act.type === 'lasso') {
      const box = $('#lasso');
      const x = Math.min(act.x, e.clientX), y = Math.min(act.y, e.clientY);
      Object.assign(box.style, {
        left: x + 'px', top: y + 'px',
        width: Math.abs(e.clientX - act.x) + 'px', height: Math.abs(e.clientY - act.y) + 'px',
      });
      box.hidden = false;
    } else {
      act.el.classList.add('dragging');
      document.querySelectorAll('.target').forEach(x => x.classList.remove('target'));
      const alvo = irmaoSob(act.el, e.clientX, e.clientY);
      if (alvo) { alvo.classList.add('target'); }
    }
  });

  function irmaoSob(el, x, y) {
    for (const c of document.elementsFromPoint(x, y)) {
      if (c !== el && c.classList?.contains('lay') && c.dataset.path !== el.dataset.path) {
        return c;
      }
    }
    return null;
  }

  document.addEventListener('mouseup', e => {
    if (!act) { return; }
    const a = act; act = null;
    hud('');
    if (a.type === 'lasso') {
      $('#lasso').hidden = true;
      const r = { x1: Math.min(a.x, e.clientX), y1: Math.min(a.y, e.clientY),
                  x2: Math.max(a.x, e.clientX), y2: Math.max(a.y, e.clientY) };
      if (r.x2 - r.x1 > 3 && r.y2 - r.y1 > 3) {
        for (const c of a.host.querySelectorAll(':scope > .c')) {
          const b = c.getBoundingClientRect();
          if (b.left < r.x2 && b.right > r.x1 && b.top < r.y2 && b.bottom > r.y1
              && !state.multi.includes(c)) {
            toggleMulti(c);
          }
        }
      }
      return;
    }
    if (a.type === 'form') {
      const w = a.el.offsetWidth, h = a.el.offsetHeight;
      if (w !== a.w || h !== a.h) { post({ type: 'resizeForm', w: w, h: h }); }
      return;
    }
    a.el.classList.remove('dragging');
    showGuides(a.el, []);
    document.querySelectorAll('.target').forEach(x => x.classList.remove('target'));
    const g = geom(a.el);
    if (a.type === 'move' && (g.l !== a.l || g.t !== a.t)) {
      post({ type: 'move', path: a.el.dataset.path, left: g.l, top: g.t });
    } else if (a.type === 'resize' && (g.w !== a.w || g.h !== a.h)) {
      post({ type: 'resize', path: a.el.dataset.path, w: g.w, h: g.h });
      if (g.l !== a.l || g.t !== a.t) {
        post({ type: 'move', path: a.el.dataset.path, left: g.l, top: g.t });
      }
    } else if (a.type === 'swap') {
      const alvo = irmaoSob(a.el, e.clientX, e.clientY);
      if (alvo) { post({ type: 'reorder', path: a.el.dataset.path, other: alvo.dataset.path }); }
      else { status('solte sobre outro controle do mesmo grupo para trocar a ordem'); }
    }
  });

  // ---- seleção múltipla ----
  function toggleMulti(el) {
    const i = state.multi.indexOf(el);
    if (i >= 0) { state.multi.splice(i, 1); el.classList.remove('multi'); }
    else { state.multi.push(el); el.classList.add('multi'); }
    state.alvos = state.multi.length;
    // I10 — com mais de um selecionado o inspetor mostra o que todos têm
    if (state.multi.length > 1) {
      post({ type: 'propsMulti', paths: state.multi.map(x => x.dataset.path) });
    } else if (state.multi.length === 1) {
      select(state.multi[0]);
    }
    status(`${state.multi.length} selecionados · A alinha à esquerda, T ao topo, D distribui`);
  }
  function clearMulti() {
    state.multi.forEach(el => el.classList.remove('multi'));
    state.multi = [];
    state.alvos = state.sel ? 1 : 0;
  }
  function alignMulti(modo) {
    const sel = state.multi.filter(el => el.dataset.mode === 'free');
    if (sel.length < 2) { status('selecione ao menos 2 componentes móveis (Ctrl+clique)', 'err'); return; }
    const g = sel.map(el => ({ el, ...geom(el) }));
    if (modo === 'left') {
      const x = Math.min(...g.map(o => o.l));
      g.forEach(o => post({ type: 'move', path: o.el.dataset.path, left: x, top: o.t }));
    } else if (modo === 'top') {
      const y = Math.min(...g.map(o => o.t));
      g.forEach(o => post({ type: 'move', path: o.el.dataset.path, left: o.l, top: y }));
    } else {
      g.sort((a, b) => a.t - b.t);
      const passo = (g[g.length - 1].t - g[0].t) / (g.length - 1);
      for (let i = 1; i < g.length - 1; i++) {
        post({ type: 'move', path: g[i].el.dataset.path, left: g[i].l,
               top: Math.round(g[0].t + passo * i) });
      }
    }
  }

  // ---- teclado ----
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') { e.target.blur(); }
      return;
    }
    if (state.multi.length > 1 && !e.ctrlKey) {
      const m = { a: 'left', t: 'top', d: 'dist' }[e.key.toLowerCase()];
      if (m) { alignMulti(m); e.preventDefault(); return; }
    }
    /*
     * F9 dentro do designer.
     *
     * Com o foco na webview, o VS Code não entrega os atalhos da extensão — o iframe fica
     * com a tecla e o Ctrl+F9 simplesmente não acontece. Reenviar daqui é o que faz o
     * atalho valer também com o form aberto, que é justamente quando se quer compilar.
     */
    if (e.key === 'F9' && (e.ctrlKey || e.shiftKey)) {
      post({ type: e.shiftKey ? 'rebuild' : 'build' });
      status(e.shiftKey ? 'recompilando tudo...' : 'compilando...');
      e.preventDefault();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && state.sel) {
      post({ type: 'copiar', path: state.sel.dataset.path });
      e.preventDefault();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
      post({ type: 'colar', path: (state.sel && state.sel.dataset.path) || raizDoForm() });
      e.preventDefault();
      return;
    }
    // D04 — encaixar o form na janela
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') { caber(); e.preventDefault(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { alternarTrava(); e.preventDefault(); return; }
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) { passoZoom(1); e.preventDefault(); return; }
    if (e.ctrlKey && e.key === '-') { passoZoom(-1); e.preventDefault(); return; }
    if (e.ctrlKey && e.key === '0') { aplicarZoom(1); e.preventDefault(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'g') {
      document.body.classList.toggle('grid-on');
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && state.sel) {
      select(state.sel.parentElement.closest('.c'));
      e.preventDefault();
      return;
    }
    if (e.key === 'Insert') {
      if (window.__dfmPaleta) { window.__dfmPaleta.abrir(); }
      e.preventDefault();
      return;
    }
    // Ctrl+Espaço abre a paleta já buscando, como o "procurar componente" da IDE
    if (e.ctrlKey && (e.key === ' ' || e.code === 'Space')) {
      if (window.__dfmPaleta) { window.__dfmPaleta.buscar(); }
      e.preventDefault();
      return;
    }
    if (!state.sel) { return; }
    if (e.key === 'Delete') {
      post({ type: 'delete', path: state.sel.dataset.path });
      e.preventDefault();
      return;
    }
    if (!state.sel.dataset.mode || state.travado) { return; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) { return; }
    const passo = e.shiftKey ? 8 : 1;
    const g = geom(state.sel);
    if (e.altKey || state.sel.dataset.mode === 'layout') {
      post({ type: 'resize', path: state.sel.dataset.path,
             w: Math.max(4, g.w + d[0] * passo), h: Math.max(4, g.h + d[1] * passo) });
    } else {
      post({ type: 'move', path: state.sel.dataset.path,
             left: g.l + d[0] * passo, top: g.t + d[1] * passo });
    }
    e.preventDefault();
  });

  // duplo-clique no componente cria o handler padrão, como no Delphi
  document.addEventListener('dblclick', e => {
    const el = e.target.closest('.c, .tray');
    if (!el || !el.dataset.path) { return; }
    select(el);
    post({ type: 'novoHandler', path: el.dataset.path, key: 'OnClick' });
    e.preventDefault();
  });

  // ---- menu de contexto (D01) ----
  const MENU = [
    { id: 'sep-edit', label: 'Editar', header: true },
    { id: 'copiar', label: 'Copiar', key: 'Ctrl+C', one: true },
    { id: 'colar', label: 'Colar aqui', key: 'Ctrl+V' },
    { id: 'duplicate', label: 'Duplicar', key: 'Ctrl+D', one: true },
    { id: 'delete', label: 'Apagar', key: 'Del', one: true },
    { id: 'sep-pos', label: 'Posição', header: true },
    { id: 'front', label: 'Trazer para a frente', one: true },
    { id: 'back', label: 'Enviar para trás', one: true },
    { id: 'sep-al', label: 'Alinhar', header: true, multi: true },
    { id: 'al-left', label: 'Pela esquerda', multi: true },
    { id: 'al-right', label: 'Pela direita', multi: true },
    { id: 'al-top', label: 'Pelo topo', multi: true },
    { id: 'al-bottom', label: 'Pela base', multi: true },
    { id: 'al-centerH', label: 'Centralizar entre si (horizontal)', multi: true },
    { id: 'al-centerV', label: 'Centralizar entre si (vertical)', multi: true },
    { id: 'al-spaceH', label: 'Espaçar igualmente (horizontal)', multi: true },
    { id: 'al-spaceV', label: 'Espaçar igualmente (vertical)', multi: true },
    { id: 'al-centerInParentH', label: 'Centralizar no container (horizontal)' },
    { id: 'al-centerInParentV', label: 'Centralizar no container (vertical)' },
    { id: 'sep-size', label: 'Tamanho', header: true, multi: true },
    { id: 'size-w', label: 'Igualar largura', multi: true },
    { id: 'size-h', label: 'Igualar altura', multi: true },
    { id: 'sep-inserir', label: 'Inserir', header: true },
    { id: 'paleta', label: 'Componente da paleta...', key: 'Insert' },
    { id: 'frame', label: 'Frame existente...' },
    { id: 'tplIns', label: 'Modelo salvo...' },
    { id: 'tplSave', label: 'Salvar seleção como modelo...', one: true },
    { id: 'sep-outros', label: 'Outros', header: true },
    { id: 'editarMenu', label: 'Editar itens do menu...', one: true, menu: true },
    { id: 'taborder', label: 'Ordem de tabulação...', one: true },
    { id: 'revert', label: 'Reverter para o herdado', one: true, inherited: true },
    { id: 'text', label: 'Ver como texto' },
  ];

  /** Um menu que dá para editar: TMainMenu, TPopupMenu e derivados, com itens dentro. */
  function ehMenu(el) {
    return !!el && /menu$/i.test(el.dataset.cls || '') && !!el.querySelector('b');
  }

  function showMenu(x, y, el) {
    const menu = $('#ctx');
    const multi = state.multi.length > 1;
    const herdado = el && el.dataset.inherited === '1';
    const itens = MENU.filter(m => {
      if (m.multi && !multi) { return false; }
      if (m.one && multi) { return false; }
      if (m.inherited && !herdado) { return false; }
      if (m.menu && !ehMenu(el)) { return false; }
      if (!m.header && !el && m.id !== 'text' && m.id !== 'paleta') { return false; }
      return true;
    });
    // não deixa cabeçalho órfão no fim nem seguido de outro cabeçalho
    const limpo = itens.filter((m, i) =>
      !m.header || (itens[i + 1] && !itens[i + 1].header));
    menu.innerHTML = limpo.map(m => m.header
      ? `<div class="ctx-h">${esc(m.label)}</div>`
      : `<div class="ctx-i" data-cmd="${m.id}">${esc(m.label)}` +
        (m.key ? `<s>${m.key}</s>` : '') + '</div>').join('');
    menu.hidden = false;
    // reposiciona se estourar a janela
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
  }

  function hideMenu() { $('#ctx').hidden = true; }

  document.addEventListener('contextmenu', e => {
    const el = e.target.closest('.c, .nv-i');
    if (el && !state.multi.includes(el)) { select(el); clearMulti(); }
    showMenu(e.clientX, e.clientY, el || state.sel);
    e.preventDefault();
  });
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#ctx')) { hideMenu(); }
  }, true);

  $('#ctx').addEventListener('click', e => {
    const i = e.target.closest('.ctx-i');
    if (!i) { return; }
    hideMenu();
    runCommand(i.dataset.cmd);
  });

  function runCommand(cmd) {
    const sel = state.sel;
    const nv = document.querySelector('.nv-i.sel');
    const paths = state.multi.length > 1
      ? state.multi.map(el => el.dataset.path)
      : sel ? [sel.dataset.path] : nv ? [nv.dataset.path] : [];
    if (cmd === 'text') { post({ type: 'openText' }); return; }
    if (cmd === 'paleta') {
      if (window.__dfmPaleta) { window.__dfmPaleta.abrir(); }
      return;
    }
    if (cmd === 'frame') { post({ type: 'frames' }); return; }
    if (cmd === 'tplIns') { post({ type: 'templates' }); return; }
    if (!paths.length) { status('selecione um componente', 'err'); return; }
    if (cmd === 'copiar') { post({ type: 'copiar', path: paths[0] }); return; }
    if (cmd === 'colar') { post({ type: 'colar', path: paths[0] || raizDoForm() }); return; }
    if (cmd === 'duplicate') { post({ type: 'duplicate', path: paths[0] }); return; }
    if (cmd === 'delete') { post({ type: 'delete', path: paths[0] }); return; }
    if (cmd === 'front' || cmd === 'back') {
      post({ type: 'zorder', path: paths[0], op: cmd });
      return;
    }
    if (cmd === 'revert') { post({ type: 'revert', path: paths[0] }); return; }
    if (cmd === 'tplSave') { post({ type: 'salvarTemplate', path: paths[0] }); return; }
    if (cmd === 'editarMenu') { post({ type: 'menu', path: paths[0] }); return; }
    if (cmd === 'taborder') { post({ type: 'tabOrder', path: paths[0] }); return; }
    if (cmd.startsWith('al-')) { post({ type: 'align', paths, op: cmd.slice(3) }); return; }
    if (cmd.startsWith('size-')) { post({ type: 'sameSize', paths, op: cmd.slice(5) }); return; }
  }

  // ---- diálogo de ordem de tabulação (D09) ----
  function showTabOrder(host, hostName, itens) {
    const dlg = $('#dlg');
    dlg.innerHTML =
      `<div class="dlg-box"><div class="dlg-h">Ordem de tabulação — ${esc(hostName)}</div>` +
      '<div class="dlg-hint">Arraste, ou use as setas. A numeração é refeita ao aplicar.</div>' +
      '<div class="dlg-list" id="to-list">' +
      itens.map(i => `<div class="to-i" draggable="true" data-path="${esc(i.path)}">` +
        `<i>⋮⋮</i><em>${esc(i.name)}</em><s>${i.order}</s></div>`).join('') +
      '</div><div class="dlg-acoes">' +
      '<button id="to-up">↑</button><button id="to-down">↓</button>' +
      '<span class="sp"></span>' +
      '<button id="to-cancel">Cancelar</button>' +
      '<button id="to-ok" class="primario">Aplicar</button></div></div>';
    dlg.hidden = false;
    dlg.dataset.host = host;

    const lista = $('#to-list');
    let arrastando = null;
    lista.addEventListener('dragstart', e => {
      arrastando = e.target.closest('.to-i');
      arrastando.classList.add('arrastando');
    });
    lista.addEventListener('dragend', () => {
      arrastando?.classList.remove('arrastando');
      arrastando = null;
    });
    lista.addEventListener('dragover', e => {
      e.preventDefault();
      const alvo = e.target.closest('.to-i');
      if (!alvo || alvo === arrastando) { return; }
      const r = alvo.getBoundingClientRect();
      lista.insertBefore(arrastando, e.clientY < r.top + r.height / 2 ? alvo : alvo.nextSibling);
    });
    lista.addEventListener('click', e => {
      const i = e.target.closest('.to-i');
      if (!i) { return; }
      lista.querySelectorAll('.to-i.on').forEach(x => x.classList.remove('on'));
      i.classList.add('on');
    });
    const mover = passo => {
      const sel = lista.querySelector('.to-i.on');
      if (!sel) { status('escolha um item da lista', 'err'); return; }
      const irmao = passo < 0 ? sel.previousElementSibling : sel.nextElementSibling;
      if (!irmao) { return; }
      if (passo < 0) { lista.insertBefore(sel, irmao); }
      else { lista.insertBefore(irmao, sel); }
    };
    $('#to-up').onclick = () => mover(-1);
    $('#to-down').onclick = () => mover(1);
    $('#to-cancel').onclick = () => { dlg.hidden = true; };
    $('#to-ok').onclick = () => {
      const ordem = [...lista.querySelectorAll('.to-i')].map(i => i.dataset.path);
      dlg.hidden = true;
      post({ type: 'applyTabOrder', path: dlg.dataset.host, paths: ordem });
    };
  }

  // ---- abas ----
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tab-btn]');
    if (!b) { return; }
    const host = b.closest('[data-pages]');
    host.querySelectorAll(':scope > [data-tab-pane]').forEach(p => {
      p.hidden = p.dataset.tabPane !== b.dataset.tabBtn;
    });
    host.querySelectorAll(':scope > .tabbar > [data-tab-btn]').forEach(x => {
      x.classList.toggle('on', x === b);
    });
    e.stopPropagation();
  });

  // ---- estrutura ----
  function renderStructure(root) {
    const linhas = [];
    (function walk(n, d) {
      linhas.push(`<div class="st-r${n.visual ? '' : ' st-nv'}${n.external ? ' st-ext' : ''}" ` +
        `data-path="${esc(n.path)}" style="padding-left:${8 + d * 11}px" title="${esc(n.cls)}">` +
        `<em>${esc(n.name)}</em><s>${esc(n.cls)}</s></div>`);
      n.kids.forEach(k => walk(k, d + 1));
    })(root, 0);
    $('#struct').innerHTML = linhas.join('');
    $('#st-info').textContent = `${linhas.length} componentes`;
  }

  document.addEventListener('mouseover', e => {
    const r = e.target.closest('.st-r');
    document.querySelectorAll('.c.hl').forEach(x => x.classList.remove('hl'));
    if (!r) { return; }
    const el = document.querySelector(`.c[data-path="${sel(r.dataset.path)}"]`);
    if (el) { el.classList.add('hl'); }
  });

  document.addEventListener('click', e => {
    const r = e.target.closest('.st-r');
    if (!r) { return; }
    const el = document.querySelector(`.c[data-path="${sel(r.dataset.path)}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); }
    irPara(r.dataset.path);
    post({ type: 'reveal', path: r.dataset.path });
    document.querySelectorAll('.st-r.on').forEach(x => x.classList.remove('on'));
    r.classList.add('on');
  });

  // ---- mensagens da extensão ----
  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type === 'props') { pintarProps(m.data); }
    else if (m.type === 'select') {
      const el = document.querySelector(`.c[data-path="${sel(m.path)}"]`);
      if (el && el !== state.sel) {
        el.scrollIntoView({ block: 'nearest' });
        select(el);
      }
    }
    else if (m.type === 'error') { status(m.text, 'err'); }
    else if (m.type === 'info') { status(m.text); }
    else if (m.type === 'paleta') {
      if (window.__dfmPaleta) { window.__dfmPaleta.receber(m.itens); }
    }
    else if (m.type === 'tabOrder') { showTabOrder(m.host, m.hostName, m.data); }
    else if (m.type === 'frames') {
      if (window.__dfmDialogos) { window.__dfmDialogos.frames(m.itens); }
    }
    else if (m.type === 'templates') {
      if (window.__dfmDialogos) { window.__dfmDialogos.templates(m.itens); }
    }
    else if (m.type === 'menu') {
      if (window.__dfmDialogos) { window.__dfmDialogos.menu(m.path, m.nome, m.itens); }
    }
    else if (m.type === 'loaded') {
      if (m.structure) { renderStructure(m.structure); }
      const s = m.stats;
      $('#stats').textContent =
        `${s.visuais} componentes · ${s.editaveis} editáveis · ${s.travados} travados` +
        (s.externos ? ` · ${s.externos} de outros arquivos` : '') +
        (m.binary ? ' · binário (somente leitura)' : '');
      if (state.inspect) { post({ type: 'props', path: state.inspect }); }
    }
  });

  /*
   * O inspetor vive em inspector.js. Se ele não carregou, o painel ficaria mudo e a tela
   * pareceria somente leitura — que foi exatamente o que aconteceu quando o VS Code serviu
   * a mídia nova com o HTML antigo em memória. Melhor dizer o que houve.
   */
  function pintarProps(d) {
    if (window.__dfmInspector) { window.__dfmInspector.render(d); return; }
    const box = $('#oi');
    if (box) {
      box.innerHTML = '<div class="oi-warn">o painel de propriedades não carregou — ' +
        'recarregue a janela (Developer: Reload Window)</div>';
    }
    status('inspector.js não carregou: recarregue a janela', 'err');
  }

  /** Leva a seleção para um caminho da árvore, mesmo quando o componente não está na tela. */
  function irPara(path) {
    const el = document.querySelector(`.c[data-path="${sel(path)}"]`);
    if (el) { select(el); return; }
    state.inspect = path;
    state.alvos = 1;
    post({ type: 'props', path: path });
  }

  // ganchos para os módulos auxiliares (paleta, inspetor)
  window.__dfm = {
    post: post,
    status: status,
    state: state,
    irPara: irPara,
    sel: sel,
    selecionado: () => state.sel,
    focoNoForm: () => { const f = document.querySelector('.client'); if (f) { f.focus(); } },
  };

  // P05 — os não visuais ficam na faixa abaixo do form; clicar inspeciona
  document.addEventListener('click', e => {
    const nv = e.target.closest('.nv-i');
    if (!nv) { return; }
    document.querySelectorAll('.nv-i.sel').forEach(x => x.classList.remove('sel'));
    nv.classList.add('sel');
    if (state.sel) { state.sel.classList.remove('sel'); state.sel = null; }
    clearMulti();
    status(`${nv.dataset.name}: ${nv.dataset.cls} — ${nv.dataset.why}`);
    irPara(nv.dataset.path);
  });

  document.addEventListener('click', e => {
    if (e.target.closest('#build-btn')) { post({ type: 'build' }); status('compilando...'); }
    else if (e.target.closest('#pal-btn')) {
      if (window.__dfmPaleta) { window.__dfmPaleta.abrir(); }
    }
    else if (e.target.closest('#lock')) { alternarTrava(); }
    else if (e.target.closest('#zin')) { passoZoom(1); }
    else if (e.target.closest('#zout')) { passoZoom(-1); }
    else if (e.target.closest('#zlvl')) { aplicarZoom(1); }
    else if (e.target.closest('#zfit')) { caber(); }
  });

  document.addEventListener('wheel', e => {
    if (!e.ctrlKey) { return; }
    passoZoom(e.deltaY < 0 ? 1 : -1);
    e.preventDefault();
  }, { passive: false });

  /** Container sob o ponteiro: o componente mais interno, ou a área cliente do form. */
  function containerSob(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.classList && el.classList.contains('c') && el.dataset.path) { return el; }
      if (el.classList && el.classList.contains('client')) { return el; }
    }
    return null;
  }

  document.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/plain')) { return; }
    const host = containerSob(e.clientX, e.clientY);
    document.querySelectorAll('.drop-alvo').forEach(x => x.classList.remove('drop-alvo'));
    if (!host) { return; }
    host.classList.add('drop-alvo');
    e.dataTransfer.dropEffect = 'copy';
    e.preventDefault();
  });

  document.addEventListener('dragleave', e => {
    if (e.target.classList && e.target.classList.contains('drop-alvo')) {
      e.target.classList.remove('drop-alvo');
    }
  });

  document.addEventListener('drop', e => {
    const dados = e.dataTransfer.getData('text/plain') || '';
    if (dados.indexOf('dfm-cls:') !== 0) { return; }
    e.preventDefault();
    document.querySelectorAll('.drop-alvo').forEach(x => x.classList.remove('drop-alvo'));
    const host = containerSob(e.clientX, e.clientY);
    if (!host) { status('solte dentro do form', 'err'); return; }
    const r = host.getBoundingClientRect();
    // o retângulo já vem escalado pelo zoom; as coordenadas do .dfm não são
    const x = Math.max(0, Math.round((e.clientX - r.left) / state.zoom));
    const y = Math.max(0, Math.round((e.clientY - r.top) / state.zoom));
    const path = host.dataset.path || raizDoForm();
    post({ type: 'add', path: path, cls: dados.slice('dfm-cls:'.length),
           left: x, top: y });
  });

  /** Caminho da raiz: a área cliente não carrega data-path, mas o form sempre tem um. */
  function raizDoForm() {
    const primeiro = document.querySelector('.c[data-path]');
    return primeiro ? primeiro.dataset.path.split('/')[0] : '';
  }

  status('pronto');
}());
