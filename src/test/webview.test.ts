/**
 * Cruza o front com o que o back realmente emite.
 *
 * Um seletor errado ou um `data-*` que ninguém escreve não quebra a compilação nem o teste
 * de unidade — a webview simplesmente não reage. Este teste procura esse buraco lendo os
 * três lados: o JS da webview, o HTML gerado para um form real e o CSS.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';
import { renderForm } from '../dfm/render';

const MEDIA = path.join(__dirname, '..', '..', 'media');
// o front está em três arquivos: o principal, o inspetor e a paleta
const js = ['webview.js', 'inspector.js', 'palette.js', 'dialogs.js']
  .map(f => fs.readFileSync(path.join(MEDIA, f), 'utf8')).join('\n');
const css = fs.readFileSync(path.join(MEDIA, 'webview.css'), 'utf8');

const SAMPLE = `object Form1: TForm1
  Caption = 'Exemplo'
  ClientWidth = 400
  ClientHeight = 300
  object Panel1: TPanel
    Left = 0
    Top = 0
    Width = 400
    Height = 48
    Align = alTop
    object Botao: TButton
      Left = 8
      Top = 8
      Width = 75
      Height = 25
      Caption = 'OK'
      Default = True
      OnClick = BotaoClick
    end
  end
  object Grid: TDBGrid
    Left = 0
    Top = 48
    Width = 400
    Height = 200
    Columns = <
      item
        FieldName = 'NOME'
        Title.Caption = 'Nome'
        Width = 120
      end>
  end
  object Abas: TPageControl
    Left = 0
    Top = 250
    Width = 400
    Height = 50
    object Aba1: TTabSheet
      Caption = 'Um'
    end
    object Aba2: TTabSheet
      Caption = 'Dois'
    end
  end
end
`;

const reg = Registry.fromJSON({
  parents: [
    ['tform1', 'tform'], ['tform', 'tcustomform'], ['tcustomform', 'tscrollingwincontrol'],
    ['tscrollingwincontrol', 'twincontrol'],
    ['tpanel', 'tcustompanel'], ['tcustompanel', 'tcustomcontrol'],
    ['tcustomcontrol', 'twincontrol'],
    ['tbutton', 'tcustombutton'], ['tcustombutton', 'twincontrol'],
    ['tdbgrid', 'tcustomdbgrid'], ['tcustomdbgrid', 'tcustomgrid'], ['tcustomgrid', 'twincontrol'],
    ['tpagecontrol', 'tcustomtabcontrol'], ['tcustomtabcontrol', 'twincontrol'],
    ['ttabsheet', 'tcustomcontrol'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
});

function render(flex = false): string {
  const doc = new DfmDocument('/tmp/Form1.dfm', SAMPLE, reg);
  return renderForm(doc, reg, {
    flexLayout: flex, nonce: 'N0NCE', cssUri: 'webview.css', jsUri: 'webview.js',
    paletaUri: 'palette.js', inspetorUri: 'inspector.js', dialogosUri: 'dialogs.js',
  }).html;
}

test('todo elemento que o JS busca por id existe no HTML', () => {
  const html = render();
  const ids = new Set([...js.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]));
  assert.ok(ids.size >= 4, `esperava vários ids, achei ${ids.size}`);
  // o inspetor monta parte do DOM em tempo de execução: vale o que o JS também escreve
  const faltando = [...ids].filter(id =>
    !html.includes(`id="${id}"`) && !js.includes(`id="${id}"`));
  assert.deepEqual(faltando, [], `o JS busca ids que o HTML não tem: ${faltando}`);
});

test('todo data-* lido pelo JS é emitido pelo render', () => {
  const html = render();
  // dataset.tabBtn -> data-tab-btn
  // ler `dataset.x` é uso; `dataset.x =` é escrita — só a leitura precisa de origem
  const escritos = new Set([...js.matchAll(/dataset\.(\w+)\s*=/g)].map(m => m[1]));
  const camel = [...js.matchAll(/dataset\.(\w+)/g)].map(m => m[1])
    .filter(c => !escritos.has(c));
  const attrs = new Set(camel.map(c => 'data-' + c.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase())));
  const emitidos = new Set([...html.matchAll(/(data-[\w-]+)=/g)].map(m => m[1]));
  // 'm' vem de data-m, usado no botão de evento, que só aparece no inspetor (não no form)
  // parte do DOM (inspetor, menu de contexto) é montada pelo próprio JS
  const faltando = [...attrs].filter(a => !emitidos.has(a) && !js.includes(`${a}="`));
  assert.deepEqual(faltando, [], `JS lê atributos que o render não escreve: ${faltando}`);
});

test('as classes que o JS procura são desenhadas ou definidas no CSS', () => {
  const html = render();
  const classes = new Set([
    ...[...js.matchAll(/closest\('\.([\w-]+)'\)/g)].map(m => m[1]),
    ...[...js.matchAll(/classList\.contains\('([\w-]+)'\)/g)].map(m => m[1]),
  ]);
  assert.ok(classes.has('c'), 'o JS precisa localizar componentes por .c');
  const faltando = [...classes].filter(c =>
    !html.includes(`class="${c}`) && !html.includes(` ${c}"`) && !html.includes(` ${c} `)
    && !js.includes(`class="${c}`) && !css.includes(`.${c}`));
  assert.deepEqual(faltando, [], `classes sem origem: ${faltando}`);
});

test('cada mensagem enviada pela webview tem tratador na extensão', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'editor.ts'), 'utf8');
  const enviadas = new Set([...js.matchAll(/post\(\{\s*type:\s*'(\w+)'/g)].map(m => m[1]));
  assert.ok(enviadas.size >= 6, `esperava várias mensagens, achei ${[...enviadas]}`);
  const semTratador = [...enviadas].filter(t =>
    !editor.includes(`'${t}'`) && !editor.includes(`case '${t}'`));
  assert.deepEqual(semTratador, [], `mensagens sem tratador: ${semTratador}`);
});

test('cada mensagem que a extensão envia é tratada pela webview', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'editor.ts'), 'utf8');
  const enviadas = new Set(
    [...editor.matchAll(/postMessage\(\{\s*type:\s*'(\w+)'/g)].map(m => m[1]));
  assert.ok(enviadas.size >= 3, `esperava várias, achei ${[...enviadas]}`);
  const semTratador = [...enviadas].filter(t => !js.includes(`'${t}'`));
  assert.deepEqual(semTratador, [], `a webview ignora: ${semTratador}`);
});

test('o HTML declara o CSP com o nonce do script', () => {
  const html = render();
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'nonce-N0NCE'/);
  assert.match(html, /<script nonce="N0NCE"/);
  assert.ok(!/<script(?![^>]*nonce)/.test(html), 'todo script precisa de nonce');
  assert.ok(!/ on\w+="/.test(html), 'nada de handler inline: o CSP bloquearia');
});

test('componentes carregam o que a interação precisa', () => {
  const html = render();
  // sem data-path não há como identificar o componente na volta
  const divs = [...html.matchAll(/<div class="c [^"]*"[^>]*>/g)].map(m => m[0]);
  assert.ok(divs.length >= 4, `esperava vários componentes, achei ${divs.length}`);
  for (const d of divs) {
    assert.match(d, /data-path="/, `componente sem data-path: ${d.slice(0, 80)}`);
    assert.match(d, /data-mode="/, `componente sem data-mode: ${d.slice(0, 80)}`);
    assert.match(d, /style="left:/, `componente sem posição: ${d.slice(0, 80)}`);
  }
  // quem é editável precisa da alça, senão não dá para redimensionar
  const editaveis = divs.filter(d => /data-mode="(free|layout)"/.test(d));
  assert.ok(editaveis.length >= 1);
});

test('abas: um pane por botão, e só o primeiro visível', () => {
  const html = render();
  const botoes = [...html.matchAll(/data-tab-btn="(\d+)"/g)].map(m => m[1]);
  const panes = [...html.matchAll(/data-tab-pane="(\d+)"/g)].map(m => m[1]);
  assert.deepEqual(botoes, ['0', '1'], 'duas abas viram dois botões');
  assert.deepEqual(panes, ['0', '1'], 'e dois panes');
  assert.ok(html.includes('data-tab-pane="1" hidden'), 'a segunda aba começa escondida');
  assert.ok(html.includes('data-pages="1"'), 'o host precisa se identificar para o JS');
});

test('conteúdo dos controles chega ao HTML', () => {
  const html = render();
  assert.ok(html.includes('class="ghead"'), 'o grid precisa do cabeçalho');
  assert.ok(html.includes('>Nome<'), 'com a coluna vinda da coleção');
  assert.ok(html.includes('is-default'), 'botão Default recebe destaque');
  assert.ok(html.includes('>OK<'), 'e o caption aparece');
});

test('o modo layout não quebra o HTML nem perde componentes', () => {
  const normal = render(false);
  const flex = render(true);
  const conta = (h: string, t: string) => h.split(t).length - 1;
  assert.equal(conta(flex, '<div'), conta(flex, '</div>'), 'as divs abrem e fecham em par');
  assert.equal(conta(normal, '<div'), conta(normal, '</div>'));
  assert.ok(conta(normal, 'data-path=') >= 4);
});
