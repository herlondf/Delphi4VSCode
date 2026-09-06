/**
 * A paleta de componentes.
 *
 * Era uma caixa modal, e uma caixa modal cobre justamente a tela onde o componente vai cair.
 * Virou uma faixa acoplada abaixo da barra: dá para arrastar dela para dentro do form (P02),
 * e as famílias viram abas (P04). A lista continua vindo do uso real do projeto, não de uma
 * ordem escrita à mão.
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let itens = null;
  let cat = 'usados';
  let filtro = '';
  const TETO = 300;   // quantos desenhar de uma vez: 2 mil elementos travam a rolagem

  const CATEGORIAS = [
    ['usados', 'no projeto'],
    ['*', 'todos'],
    ['btn', 'botões'],
    ['edit', 'entrada'],
    ['lbl', 'rótulos'],
    ['chk', 'marcação'],
    ['panel', 'containers'],
    ['tab', 'abas'],
    ['grid', 'grades'],
    ['image', 'imagens'],
    ['nv', 'não visuais'],
    ['misc', 'outros'],
  ];

  function api() { return window.__dfm || {}; }

  function categoriaDe(i) {
    if (!i.visual) { return 'nv'; }
    return CATEGORIAS.some(c => c[0] === i.kind) ? i.kind : 'misc';
  }

  /**
   * Quantos entram em cada aba.
   *
   * `no projeto` é a aba inicial de propósito: com todos os componentes instalados, a lista
   * passa de dois mil, e quem abre a paleta quase sempre quer um dos que o time já usa.
   */
  function daCategoria(id) {
    if (id === 'usados') { return itens.filter(i => i.uso > 0); }
    if (id === '*') { return itens; }
    return itens.filter(i => categoriaDe(i) === id);
  }

  /**
   * Alterna a faixa. Na primeira abertura pede a lista à extensão.
   *
   * `focar` põe o cursor direto no campo de busca: com quase quatro mil componentes, digitar
   * o nome é o caminho normal, e não achar onde digitar foi a primeira coisa que travou quem
   * abriu a paleta.
   */
  function abrir(focar) {
    const pal = $('#pal');
    if (!pal) { return; }
    if (!pal.hidden && !focar) { pal.hidden = true; return; }
    pal.hidden = false;
    if (itens) { desenhar(); foco(); return; }
    api().status('carregando a paleta...');
    api().post({ type: 'paleta' });
  }

  function foco() {
    const q = $('#pl-q');
    if (q) { q.focus(); q.select(); }
  }

  /** Abre já em modo de busca, com o que estiver selecionado como ponto de partida. */
  function buscar() {
    filtro = '';
    cat = '*';
    abrir(true);
  }

  function receber(lista) {
    itens = lista || [];
    const pal = $('#pal');
    if (pal) { pal.hidden = false; }
    desenhar();
    foco();
    const usados = itens.filter(i => i.uso > 0).length;
    api().status(`${itens.length} componentes instalados (${usados} usados neste projeto) ` +
      '— arraste para dentro do form');
  }

  function desenhar() {
    const pal = $('#pal');
    if (!pal || !itens) { return; }
    const q = filtro.toLowerCase();
    // com filtro, procura na paleta inteira: quem digita um nome quer achá-lo onde estiver
    const base = q ? itens : daCategoria(cat);
    const casaram = base.filter(i =>
      !q || i.cls.toLowerCase().indexOf(q) >= 0 ||
      (i.unit || '').toLowerCase().indexOf(q) >= 0);
    const visiveis = casaram.slice(0, TETO);

    pal.innerHTML =
      '<div class="pal-cats">' + CATEGORIAS.map(([id, rotulo]) => {
        const n = daCategoria(id).length;
        if (!n) { return ''; }
        return `<button data-cat="${id}" class="${cat === id ? 'on' : ''}">` +
          `${esc(rotulo)}<b>${n}</b></button>`;
      }).join('') +
      '<span class="sp"></span>' +
      `<span class="pal-conta">${casaram.length}` +
      (casaram.length > TETO ? ` (mostrando ${TETO})` : '') + '</span>' +
      `<input id="pl-q" placeholder="filtrar por nome ou unit" autocomplete="off" ` +
      `spellcheck="false" value="${esc(filtro)}">` +
      '<button id="pl-close" title="fechar (Insert)">✕</button></div>' +
      '<div class="pal-list">' + (visiveis.length
        ? visiveis.map(i =>
          `<div class="pl-i" draggable="true" data-cls="${esc(i.cls)}" ` +
          `title="${esc(i.cls)}${i.unit ? '  (' + esc(i.unit) + ')' : ''}` +
          `${i.uso ? '  — ' + i.uso + ' usos no projeto' : '  — ainda não usado aqui'}">` +
          `<span class="pl-k k-${esc(i.kind)}"></span><em>${esc(i.cls)}</em>` +
          (i.visual ? '' : '<span class="pl-nv">nv</span>') +
          (i.uso ? `<s>${i.uso}</s>` : '') + '</div>').join('')
        : '<div class="pal-vazio">nada encontrado — experimente a aba "todos"</div>') +
      '</div>';

    const campo = $('#pl-q');
    campo.addEventListener('input', () => {
      filtro = campo.value;
      desenhar();
      const novo = $('#pl-q');
      novo.focus();
      novo.setSelectionRange(novo.value.length, novo.value.length);
    });
    campo.addEventListener('keydown', e => {
      if (e.key === 'Escape') { pal.hidden = true; api().focoNoForm(); }
      if (e.key === 'Enter') {
        const alvo = pal.querySelector('.pl-i.on') || pal.querySelector('.pl-i');
        if (alvo) { criarNoSelecionado(alvo.dataset.cls); }
      }
      // setas percorrem o resultado sem tirar a mão do teclado
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        mover(e.key === 'ArrowDown' ? 1 : -1);
        e.preventDefault();
      }
      e.stopPropagation();
    });
  }

  /** Marca o próximo resultado e o traz para a vista. */
  function mover(passo) {
    const lista = [...document.querySelectorAll('#pal .pl-i')];
    if (!lista.length) { return; }
    const atual = lista.findIndex(x => x.classList.contains('on'));
    const alvo = Math.max(0, Math.min(lista.length - 1, (atual < 0 ? -1 : atual) + passo));
    lista.forEach(x => x.classList.remove('on'));
    lista[alvo].classList.add('on');
    lista[alvo].scrollIntoView({ block: 'nearest' });
  }

  /** Clique cria dentro do que estiver selecionado — o caminho sem arrastar. */
  function criarNoSelecionado(cls) {
    const sel = api().selecionado && api().selecionado();
    if (!sel) {
      api().status('selecione o container, ou arraste o componente até ele', 'err');
      return;
    }
    api().post({ type: 'add', path: sel.dataset.path, cls: cls });
  }

  document.addEventListener('click', e => {
    const c = e.target.closest('#pal [data-cat]');
    if (c) { cat = c.dataset.cat; desenhar(); return; }
    if (e.target.closest('#pl-close')) { $('#pal').hidden = true; return; }
    const i = e.target.closest('#pal .pl-i');
    if (i) { criarNoSelecionado(i.dataset.cls); }
  });

  // P02 — arrastar da paleta para dentro do form
  document.addEventListener('dragstart', e => {
    const i = e.target.closest && e.target.closest('#pal .pl-i');
    if (!i) { return; }
    e.dataTransfer.setData('text/plain', 'dfm-cls:' + i.dataset.cls);
    e.dataTransfer.effectAllowed = 'copy';
    api().status(`solte ${i.dataset.cls} sobre o container que vai recebê-lo`);
  });

  window.__dfmPaleta = { abrir: abrir, buscar: buscar, receber: receber };
}());
