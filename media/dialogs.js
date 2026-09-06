/**
 * Caixas do designer que não cabem no inspetor: inserir frame, modelos e o editor de menu.
 *
 * Todas seguem a mesma regra do resto do front — montam uma estrutura, mandam para a
 * extensão e esperam o documento voltar. Nenhuma delas escreve no `.dfm` por conta própria.
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function api() { return window.__dfm || {}; }
  function alvoAtual() {
    const sel = api().selecionado && api().selecionado();
    return sel ? sel.dataset.path : (api().state && api().state.inspect) || '';
  }

  function caixa(titulo, dica, corpo, rodape) {
    const dlg = $('#dlg');
    dlg.innerHTML = `<div class="dlg-box"><div class="dlg-h">${esc(titulo)}</div>` +
      (dica ? `<div class="dlg-hint">${esc(dica)}</div>` : '') + corpo +
      `<div class="dlg-acoes">${rodape}</div></div>`;
    dlg.hidden = false;
    const cancelar = $('#d-cancel');
    if (cancelar) { cancelar.onclick = () => { dlg.hidden = true; }; }
    return dlg;
  }

  const RODAPE_FECHAR = '<span class="sp"></span><button id="d-cancel">Fechar</button>';

  // ---- P06: inserir frame existente ----
  function escolherFrame(lista) {
    const path = alvoAtual();
    if (!path) { api().status('selecione o container que vai receber o frame', 'err'); return; }
    if (!lista.length) {
      api().status('nenhum frame com .dfm foi encontrado nas pastas indexadas', 'err');
      return;
    }
    const dlg = caixa('Inserir frame', 'Só aparecem frames que têm .dfm ao lado do .pas.',
      `<div class="dlg-list" id="d-frames">${lista.map(f =>
        `<div class="esc-i" data-cls="${esc(f.cls)}"><em>${esc(f.cls)}</em>` +
        `<s>${f.w}×${f.h}</s><span class="esc-u">${esc(f.unit)}</span></div>`).join('')}</div>`,
      RODAPE_FECHAR);
    $('#d-frames').addEventListener('click', e => {
      const i = e.target.closest('.esc-i');
      if (!i) { return; }
      dlg.hidden = true;
      api().post({ type: 'addFrame', path: path, cls: i.dataset.cls, left: 8, top: 8 });
    });
  }

  // ---- P09: modelos de componente ----
  function escolherTemplate(lista) {
    const path = alvoAtual();
    if (!path) { api().status('selecione o container', 'err'); return; }
    if (!lista.length) {
      api().status('nenhum modelo salvo ainda — use "Salvar como modelo" primeiro', 'err');
      return;
    }
    const dlg = caixa('Inserir modelo', 'Nomes que colidirem são renumerados na inserção.',
      `<div class="dlg-list" id="d-tpl">${lista.map(t =>
        `<div class="esc-i" data-nome="${esc(t.nome)}"><em>${esc(t.nome)}</em>` +
        `<s>${t.linhas.length} linhas</s><span class="esc-u">${esc(t.cls)}</span></div>`
      ).join('')}</div>`, RODAPE_FECHAR);
    $('#d-tpl').addEventListener('click', e => {
      const i = e.target.closest('.esc-i');
      if (!i) { return; }
      dlg.hidden = true;
      api().post({ type: 'inserirTemplate', path: path, nome: i.dataset.nome,
                   left: 8, top: 8 });
    });
  }

  // ---- P10: editor de menu ----
  let arvore = null;
  let caminhoMenu = '';

  function editarMenu(path, nome, itens) {
    arvore = itens;
    caminhoMenu = path;
    const dlg = caixa(`Menu — ${nome}`,
      'Caption de cada item; “-” sozinho é separador. As demais propriedades ' +
      '(ShortCut, OnClick) são preservadas.',
      '<div class="dlg-list" id="d-menu"></div>',
      '<button id="m-add">+ item</button><button id="m-sub">+ subitem</button>' +
      '<button id="m-sep">+ separador</button><button id="m-del">remover</button>' +
      '<button id="m-up">↑</button><button id="m-down">↓</button>' +
      '<span class="sp"></span><button id="d-cancel">Cancelar</button>' +
      '<button id="m-ok" class="primario">Aplicar</button>');

    desenharMenu();
    $('#m-add').onclick = () => comAlvo((pai, lista, i) => {
      lista.splice(i + 1, 0, novoItem('Novo item'));
    });
    $('#m-sub').onclick = () => comAlvo((pai, lista, i) => {
      lista[i].kids.push(novoItem('Novo subitem'));
    });
    $('#m-sep').onclick = () => comAlvo((pai, lista, i) => {
      lista.splice(i + 1, 0, novoItem('-'));
    });
    $('#m-del').onclick = () => comAlvo((pai, lista, i) => { lista.splice(i, 1); });
    $('#m-up').onclick = () => comAlvo((pai, lista, i) => {
      if (i > 0) { lista.splice(i - 1, 0, lista.splice(i, 1)[0]); }
    });
    $('#m-down').onclick = () => comAlvo((pai, lista, i) => {
      if (i < lista.length - 1) { lista.splice(i + 1, 0, lista.splice(i, 1)[0]); }
    });
    $('#m-ok').onclick = () => {
      dlg.hidden = true;
      api().post({ type: 'setMenu', path: caminhoMenu, itens: arvore });
    };
  }

  function novoItem(caption) {
    return { path: '', name: '', caption: caption, separador: caption === '-', kids: [] };
  }

  /** Aplica a operação na lista que contém o item marcado, e redesenha. */
  function comAlvo(op) {
    const marcado = document.querySelector('#d-menu .mn-i.on');
    if (!marcado) { api().status('escolha um item do menu primeiro', 'err'); return; }
    const chave = marcado.dataset.k;
    const achar = (lista, prefixo) => {
      for (let i = 0; i < lista.length; i++) {
        const k = prefixo + '.' + i;
        if (k === chave) { return [lista, i]; }
        const dentro = achar(lista[i].kids, k);
        if (dentro) { return dentro; }
      }
      return null;
    };
    const achado = achar(arvore, '');
    if (!achado) { return; }
    op(null, achado[0], achado[1]);
    desenharMenu(chave);
  }

  function desenharMenu(marcar) {
    const linhas = [];
    (function anda(lista, prefixo, nivel) {
      lista.forEach((item, i) => {
        const k = prefixo + '.' + i;
        const sep = item.caption === '-';
        linhas.push(
          `<div class="mn-i${k === marcar ? ' on' : ''}" data-k="${esc(k)}" ` +
          `style="padding-left:${6 + nivel * 16}px">` +
          (sep ? '<em class="mn-sep">──────</em>'
               : `<input value="${esc(item.caption)}" data-k="${esc(k)}">`) +
          `<s>${esc(item.name || 'novo')}</s></div>`);
        anda(item.kids, k, nivel + 1);
      });
    })(arvore, '', 0);
    const lista = $('#d-menu');
    lista.innerHTML = linhas.join('') || '<div class="pal-vazio">menu vazio</div>';
  }

  document.addEventListener('click', e => {
    const i = e.target.closest('#d-menu .mn-i');
    if (!i) { return; }
    document.querySelectorAll('#d-menu .mn-i.on').forEach(x => x.classList.remove('on'));
    i.classList.add('on');
  });

  document.addEventListener('input', e => {
    const campo = e.target.closest('#d-menu input');
    if (!campo || !arvore) { return; }
    const partes = campo.dataset.k.split('.').filter(Boolean).map(Number);
    let lista = arvore;
    let item = null;
    for (const p of partes) {
      item = lista[p];
      if (!item) { return; }
      lista = item.kids;
    }
    item.caption = campo.value;
    item.separador = campo.value === '-';
  });

  window.__dfmDialogos = {
    frames: escolherFrame,
    templates: escolherTemplate,
    menu: editarMenu,
  };
}());
