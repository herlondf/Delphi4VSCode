/**
 * Object Inspector da webview.
 *
 * Saiu do webview.js quando cada tipo de propriedade passou a ter editor próprio: cor,
 * conjunto, lista de strings, coleção e referência a outro componente. Nada aqui escreve no
 * documento — tudo vira mensagem, e quem aplica é a extensão.
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const api = () => window.__dfm;
  const st = { alpha: false, aba: 'props', abertos: {}, dados: null };
  const VARIOS = '(vários)';

  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function post(msg) { api().post(msg); }
  function status(t, c) { api().status(t, c); }

  /** Alvo das edições: um caminho só, ou vários quando a seleção é múltipla. */
  function alvo(extra) {
    const s = api().state;
    const base = s.alvos > 1 ? { paths: s.multi.map(el => el.dataset.path) }
                             : { path: s.inspect };
    return Object.assign(base, extra);
  }

  // ---- editores por tipo ----
  function editor(r, ro) {
    if (r.event) {
      return r.value
        ? `<button class="oi-ev" data-m="${esc(r.value)}">${esc(r.value)} ↗</button>`
        : `<button class="oi-ev oi-novo" data-novo="${esc(r.label)}">criar handler</button>`;
    }
    const dis = ro ? ' disabled' : '';
    if (r.type === 'bool') {
      return `<select${dis}>` +
        (r.value === VARIOS ? '<option selected>(vários)</option>' : '') +
        ['True', 'False'].map(v =>
          `<option${v.toLowerCase() === String(r.value).toLowerCase() ? ' selected' : ''}>` +
          `${v}</option>`).join('') + '</select>';
    }
    if (r.type === 'color') {
      const hex = r.color || '#000000';
      return '<span class="oi-cor">' +
        `<input type="color" class="oi-swatch" value="${esc(hex)}"${dis}>` +
        `<input type="text" class="oi-cortxt" value="${esc(r.value)}"${dis}></span>`;
    }
    if (r.type === 'ref') {
      const opcoes = ['', ...(r.refs || [])];
      if (r.value && !opcoes.includes(r.value)) { opcoes.push(r.value); }
      return `<select${dis}>` + opcoes.map(v =>
        `<option value="${esc(v)}"${v === r.value ? ' selected' : ''}>` +
        `${v ? esc(v) : '(nenhum)'}</option>`).join('') + '</select>';
    }
    if (r.type === 'set') {
      return `<button class="oi-blk" data-blk="set"${dis}>${esc(r.value || '[]')}</button>`;
    }
    if (r.type === 'strings') {
      return `<button class="oi-blk" data-blk="strings"${dis}>${esc(r.value)} ✎</button>`;
    }
    if (r.type === 'collection') {
      return `<button class="oi-blk" data-blk="col"${dis}>${esc(r.value)} ✎</button>`;
    }
    if (r.enum) {
      return `<select${dis}>` +
        (r.enum.includes(r.value) ? '' : `<option>${esc(r.value)}</option>`) +
        r.enum.map(v => `<option${v === r.value ? ' selected' : ''}>${v}</option>`).join('') +
        '</select>';
    }
    const tipoNum = r.type === 'int' && r.value !== VARIOS ? 'type="number" ' : '';
    return `<input ${tipoNum}value="${esc(r.value)}"${dis}` +
      (r.type === 'block' ? ' title="bloco: edite no Delphi"' : '') + '>';
  }

  function linha(r, ro, sub) {
    const herd = !r.own && !r.absent;
    const cls = ['oi-row'];
    if (r.absent) { cls.push('oi-abs'); }
    if (herd) { cls.push('oi-inh'); }
    if (r.own && !r.absent) { cls.push('oi-own'); }   // I09 — o que está gravado aqui
    if (sub) { cls.push('oi-subrow'); }
    const rotulo = sub ? r.sub : r.label;
    return `<div class="${cls.join(' ')}" data-key="${esc(r.key)}" ` +
      `data-scope="${r.scope}" data-type="${r.type}" ` +
      `data-name="${esc(r.label.toLowerCase())}">` +
      `<label title="${esc(r.label)}${herd ? ' — herdado de ' + esc(r.from) : ''}">` +
      `${esc(rotulo)}</label>${editor(r, ro)}</div>`;
  }

  /** I07 — `Font.Name` e `Font.Style` viram um grupo `Font` que abre e fecha. */
  function bloco(rows, ro, chave) {
    const soltas = rows.filter(r => !r.group);
    const grupos = new Map();
    for (const r of rows) {
      if (!r.group) { continue; }
      if (!grupos.has(r.group)) { grupos.set(r.group, []); }
      grupos.get(r.group).push(r);
    }
    let h = soltas.map(r => linha(r, ro)).join('');
    for (const [nome, filhas] of grupos) {
      const id = chave + '/' + nome;
      const aberto = !!st.abertos[id];
      h += `<div class="oi-subh${aberto ? ' aberto' : ''}" data-sub="${esc(id)}">` +
        `<i>${aberto ? '▾' : '▸'}</i>${esc(nome)}<b>${filhas.length}</b></div>` +
        `<div class="oi-subg" data-subg="${esc(id)}"${aberto ? '' : ' hidden'}>` +
        filhas.map(r => linha(r, ro, true)).join('') + '</div>';
    }
    return h;
  }

  function painelProps(rows, ro) {
    if (!rows.length) { return '<div class="oi-empty">nada aqui</div>'; }
    if (st.alpha) {                                    // I12
      const ord = rows.slice().sort((a, b) => a.label.localeCompare(b.label));
      return `<div class="oi-grp">${ord.map(r => linha(r, ro)).join('')}</div>`;
    }
    const cats = new Map();
    for (const r of rows) {
      const k = (r.scope === 'item' ? 'Layout item · ' : '') + r.cat;
      if (!cats.has(k)) { cats.set(k, []); }
      cats.get(k).push(r);
    }
    let h = '';
    for (const [cat, linhas] of cats) {
      h += `<div class="oi-sec"><i>▾</i>${esc(cat)}<b>${linhas.length}</b></div>` +
        `<div class="oi-grp">${bloco(linhas, ro, cat)}</div>`;
    }
    return h;
  }

  function render(d) {
    const box = $('#oi');
    st.dados = d;
    if (!d) { box.innerHTML = '<div class="oi-empty">selecione um componente</div>'; return; }
    const ro = !d.editable;

    let h = `<div class="oi-head">${esc(d.name)}<span>${esc(d.cls)}</span></div>`;
    if (d.alvos > 1) {
      h += `<div class="oi-via">${d.alvos} componentes — só o que todos têm</div>`;
    } else if (!d.editable) {
      h += `<div class="oi-warn">vem de ${esc(d.file)} — somente leitura</div>`;
    } else if (d.via) { h += `<div class="oi-via">grava no ${esc(d.via)}</div>`; }

    if (d.crumbs && d.crumbs.length > 1) {
      h += '<div class="oi-crumbs">' + d.crumbs.map(c =>
        `<span data-path="${esc(c.path)}">${esc(c.name)}</span>`).join('<i>›</i>') + '</div>';
    }
    if (d.groups && d.groups.length) {
      h += '<div class="oi-sec">grupos de layout</div>';
      for (const g of d.groups) {
        h += `<div class="oi-lgrp" data-path="${esc(g.path)}">${esc(g.name)}` +
          (g.caption ? `<span>${esc(g.caption)}</span>` : '') + '</div>';
      }
    }

    const eventos = d.rows.filter(r => r.event);
    const props = d.rows.filter(r => !r.event);
    // I01 — eventos numa aba própria, como no inspetor do Delphi
    h += '<div class="oi-tabs">' +
      `<button data-oitab="props" class="${st.aba === 'props' ? 'on' : ''}">` +
      `Propriedades<b>${props.length}</b></button>` +
      `<button data-oitab="events" class="${st.aba === 'events' ? 'on' : ''}">` +
      `Eventos<b>${eventos.length}</b></button>` +
      `<button id="oi-alpha" class="${st.alpha ? 'on' : ''}" ` +
      'title="alternar entre categorias e ordem alfabética">A↓</button></div>';
    h += '<div class="oi-filter"><input id="oi-q" placeholder="Filtrar propriedade" ' +
      `value="${esc(api().state.filtro)}"></div>`;
    h += `<div data-oipane="props"${st.aba === 'props' ? '' : ' hidden'}>` +
      painelProps(props, ro) + '</div>';
    h += `<div data-oipane="events"${st.aba === 'events' ? '' : ' hidden'}>` +
      painelProps(eventos, ro) + '</div>';

    box.innerHTML = h;
    const q = $('#oi-q');
    q.addEventListener('input', () => { api().state.filtro = q.value; filtrar(); });
    if (api().state.filtro) { filtrar(); }
  }

  function filtrar() {
    const q = api().state.filtro.toLowerCase();
    document.querySelectorAll('#oi .oi-row').forEach(r => {
      r.hidden = q ? !r.dataset.name.includes(q) : false;
    });
    document.querySelectorAll('#oi .oi-grp, #oi .oi-subg').forEach(g => {
      const vis = [...g.children].some(c => !c.hidden);
      if (g.classList.contains('oi-subg') && !q) { return; }
      g.hidden = !vis;
      if (g.previousElementSibling) { g.previousElementSibling.hidden = !vis; }
    });
  }

  function acharLinha(el) {
    const row = el.closest('.oi-row');
    if (!row || !st.dados) { return null; }
    return st.dados.rows.find(r =>
      r.key === row.dataset.key && r.scope === row.dataset.scope) || null;
  }

  // ---- diálogos dos tipos compostos ----
  function abrirDlg(titulo, corpo, aoConfirmar) {
    const dlg = $('#dlg');
    dlg.innerHTML = `<div class="dlg-box"><div class="dlg-h">${esc(titulo)}</div>${corpo}` +
      '<div class="dlg-acoes"><span class="sp"></span>' +
      '<button id="d-cancel">Cancelar</button>' +
      '<button id="d-ok" class="primario">Aplicar</button></div></div>';
    dlg.hidden = false;
    $('#d-cancel').onclick = () => { dlg.hidden = true; };
    $('#d-ok').onclick = () => { dlg.hidden = true; aoConfirmar(); };
  }

  /** I05 — lista de strings: uma linha por item, do jeito que se lê. */
  function dlgStrings(r) {
    abrirDlg(`${r.label}`,
      '<div class="dlg-hint">Uma linha do componente por linha aqui.</div>' +
      `<textarea id="d-txt" rows="12">${esc((r.lines || []).join('\n'))}</textarea>`,
      () => {
        const v = $('#d-txt').value.replace(/\r/g, '');
        post(alvo({ type: 'setStrings', key: r.key, scope: r.scope,
                    lines: v === '' ? [] : v.split('\n') }));
      });
    $('#d-txt').focus();
  }

  /** I04 — conjuntos (Font.Style, Anchors, BorderIcons) por caixinha. */
  function dlgSet(r) {
    const itens = r.setItems || [];
    abrirDlg(r.label,
      '<div class="dlg-set">' + itens.map((i, n) =>
        `<label><input type="checkbox" data-si="${n}"${i.on ? ' checked' : ''}>` +
        `${esc(i.nome)}</label>`).join('') + '</div>',
      () => {
        const on = [...document.querySelectorAll('[data-si]')]
          .filter(c => c.checked).map(c => itens[+c.dataset.si].nome);
        post(alvo({ type: 'prop', key: r.key, scope: r.scope, value: `[${on.join(', ')}]` }));
      });
  }

  /**
   * I06 — editor de coleção.
   *
   * Reordenar, duplicar e remover cobrem o que se faz numa lista de colunas de grid. Editar
   * o conteúdo de um item continua no texto: um item pode ter objetos aninhados, e um editor
   * genérico de campo a campo aqui daria a impressão de cobrir o que não cobre.
   */
  function dlgColecao(r) {
    const itens = (r.items || []).map((desc, i) => ({ desc, i }));
    abrirDlg(`${r.label} — ${itens.length} itens`,
      '<div class="dlg-hint">Ordem, cópia e remoção. O conteúdo de cada item ' +
      'continua no editor de texto.</div>' +
      `<div class="dlg-list" id="d-col">${itens.map(it =>
        `<div class="col-i" data-i="${it.i}"><em>${esc(it.desc)}</em>` +
        '<s data-op="up">↑</s><s data-op="down">↓</s>' +
        '<s data-op="dup">⧉</s><s data-op="del">✕</s></div>').join('')}</div>`,
      () => {
        const ordem = [...document.querySelectorAll('#d-col .col-i')]
          .map(el => +el.dataset.i);
        post(alvo({ type: 'setCollection', key: r.key, scope: r.scope, ordem: ordem }));
      });

    $('#d-col').addEventListener('click', e => {
      const s = e.target.closest('s');
      if (!s) { return; }
      const item = s.closest('.col-i');
      const lista = item.parentElement;
      const op = s.dataset.op;
      if (op === 'del') { item.remove(); }
      else if (op === 'dup') { lista.insertBefore(item.cloneNode(true), item.nextSibling); }
      else if (op === 'up' && item.previousElementSibling) {
        lista.insertBefore(item, item.previousElementSibling);
      } else if (op === 'down' && item.nextElementSibling) {
        lista.insertBefore(item.nextElementSibling, item);
      }
    });
  }

  // ---- eventos do painel ----
  document.addEventListener('change', e => {
    const row = e.target.closest('.oi-row');
    if (!row || !st.dados) { return; }
    if (e.target.classList.contains('oi-swatch')) {
      // o seletor devolve #rrggbb; a extensão converte para $00BBGGRR
      post(alvo({ type: 'prop', key: row.dataset.key, scope: row.dataset.scope,
                  value: e.target.value }));
      return;
    }
    if (row.dataset.type === 'block') { return; }
    post(alvo({ type: 'prop', key: row.dataset.key, scope: row.dataset.scope,
                value: e.target.value }));
  });

  document.addEventListener('click', e => {
    const aba = e.target.closest('[data-oitab]');
    if (aba) {
      st.aba = aba.dataset.oitab;
      render(st.dados);
      return;
    }
    if (e.target.closest('#oi-alpha')) {
      st.alpha = !st.alpha;
      render(st.dados);
      return;
    }
    const sub = e.target.closest('.oi-subh');
    if (sub) {
      const id = sub.dataset.sub;
      st.abertos[id] = !st.abertos[id];
      const g = document.querySelector(`[data-subg="${api().sel(id)}"]`);
      if (g) { g.hidden = !st.abertos[id]; }
      sub.classList.toggle('aberto', st.abertos[id]);
      sub.querySelector('i').textContent = st.abertos[id] ? '▾' : '▸';
      return;
    }
    const blk = e.target.closest('.oi-blk');
    if (blk) {
      const r = acharLinha(blk);
      if (!r) { return; }
      if (r.type === 'strings') { dlgStrings(r); }
      else if (r.type === 'collection') { dlgColecao(r); }
      else if (r.type === 'set') { dlgSet(r); }
      return;
    }
    const novo = e.target.closest('.oi-novo');
    if (novo) {
      post({ type: 'novoHandler', path: api().state.inspect, key: novo.dataset.novo });
      return;
    }
    const ev = e.target.closest('.oi-ev');
    if (ev) { post({ type: 'gotoCode', value: ev.dataset.m }); return; }

    const crumb = e.target.closest('.oi-crumbs span');
    const grp = e.target.closest('.oi-lgrp');
    const destino = crumb || grp;
    if (destino) { api().irPara(destino.dataset.path); return; }

    const sec = e.target.closest('.oi-sec');
    if (sec && sec.nextElementSibling &&
        sec.nextElementSibling.classList.contains('oi-grp')) {
      const g = sec.nextElementSibling;
      g.hidden = !g.hidden;
      sec.classList.toggle('closed', g.hidden);
    }
  });

  // I11 — trocar Name é renomear: a extensão confirma antes de mexer no .pas
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') { return; }
    const row = e.target.closest && e.target.closest('.oi-row');
    if (row && row.dataset.key === 'name') { status('confirme a renomeação na caixa do VS Code'); }
  });

  window.__dfmInspector = { render: render };
}());
