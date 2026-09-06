/**
 * Tokeniza com o mesmo motor do VS Code (vscode-textmate + Oniguruma).
 *
 * Validar a gramática só com o `RegExp` do JavaScript não prova nada: o VS Code usa
 * Oniguruma, cuja sintaxe é diferente, e uma gramática rejeitada por ele simplesmente não
 * pinta nada — sem erro visível. Este teste carrega a gramática de verdade e confere os
 * escopos que saem, token a token.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';

const RAIZ = path.join(__dirname, '..', '..');

let registro: textmate.Registry | undefined;

async function carregar(): Promise<textmate.Registry> {
  if (registro) { return registro; }
  const wasm = fs.readFileSync(
    path.join(RAIZ, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer as ArrayBuffer);
  registro = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (fontes: string[]) => new oniguruma.OnigScanner(fontes),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scope: string) => {
      const arquivo = scope === 'source.pascal'
        ? 'syntaxes/pascal.tmLanguage.json'
        : scope === 'source.dfm' ? 'syntaxes/dfm.tmLanguage.json' : null;
      if (!arquivo) { return null; }
      const bruto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
      return textmate.parseRawGrammar(bruto, arquivo);
    },
  });
  return registro;
}

/** Escopos aplicados a cada trecho de uma linha. */
async function tokens(scope: string, linha: string): Promise<{ texto: string; escopos: string[] }[]> {
  const reg = await carregar();
  const g = await reg.loadGrammar(scope);
  assert.ok(g, `a gramática ${scope} não carregou — o VS Code também a rejeitaria`);
  const r = g!.tokenizeLine(linha, textmate.INITIAL);
  return r.tokens.map(t => ({
    texto: linha.slice(t.startIndex, t.endIndex),
    escopos: t.scopes,
  }));
}

/** O trecho recebeu algum escopo além do escopo raiz? */
function escopoDe(lista: { texto: string; escopos: string[] }[], trecho: string): string[] {
  const t = lista.find(x => x.texto.trim() === trecho);
  assert.ok(t, `não achei o token ${JSON.stringify(trecho)} em ` +
    JSON.stringify(lista.map(x => x.texto)));
  return t!.escopos.filter(s => !s.startsWith('source.'));
}

test('a gramática do Pascal carrega no motor do VS Code', async () => {
  const reg = await carregar();
  const g = await reg.loadGrammar('source.pascal');
  assert.ok(g, 'gramática rejeitada pelo Oniguruma');
});

test('Pascal: palavras-chave, tipos e strings recebem escopo', async () => {
  const t = await tokens('source.pascal',
    "  if Assigned(Foo) then Bar := 'texto''com aspas';");
  assert.ok(escopoDe(t, 'if').some(s => s.startsWith('keyword.control')), String(escopoDe(t, 'if')));
  assert.ok(escopoDe(t, 'then').some(s => s.startsWith('keyword.control')));
  assert.ok(escopoDe(t, ':=').some(s => s.startsWith('keyword.operator')));
  const str = t.find(x => x.texto.includes('texto'));
  assert.ok(str && str.escopos.some(s => s.startsWith('string.quoted')), String(str?.escopos));
});

test('Pascal: declaração de método marca classe e nome', async () => {
  const t = await tokens('source.pascal',
    'procedure TFormItemMan.BotaoClick(Sender: TObject);');
  assert.ok(escopoDe(t, 'procedure').some(s => s.startsWith('keyword')));
  assert.ok(escopoDe(t, 'TFormItemMan').some(s => s.startsWith('entity.name.type')),
    String(escopoDe(t, 'TFormItemMan')));
  assert.ok(escopoDe(t, 'BotaoClick').some(s => s.startsWith('entity.name.function')),
    String(escopoDe(t, 'BotaoClick')));
});

test('Pascal: chave é comentário, mas {$IFDEF} é diretiva', async () => {
  const c = await tokens('source.pascal', '{ isto é comentário }');
  assert.ok(c[0].escopos.some(s => s.startsWith('comment')), String(c[0].escopos));
  const d = await tokens('source.pascal', '{$IFDEF DEBUG}');
  assert.ok(d.some(x => x.escopos.some(s => s.startsWith('keyword.control.directive'))),
    'a diretiva não pode virar comentário: ' + JSON.stringify(d.map(x => x.escopos)));
});

test('Pascal: modificadores de visibilidade e tipos básicos', async () => {
  const t = await tokens('source.pascal', '  published property Nome: string read FNome;');
  assert.ok(escopoDe(t, 'published').some(s => s.startsWith('storage.modifier')));
  assert.ok(escopoDe(t, 'string').some(s => s.startsWith('support.type')));
});

test('a gramática do .dfm carrega e marca objeto, propriedade e valor', async () => {
  const t = await tokens('source.dfm', '  object BotaoOk: TcxButton');
  assert.ok(escopoDe(t, 'object').some(s => s.startsWith('keyword.control')));
  assert.ok(escopoDe(t, 'BotaoOk').some(s => s.startsWith('entity.name.tag')),
    String(escopoDe(t, 'BotaoOk')));
  assert.ok(escopoDe(t, 'TcxButton').some(s => s.startsWith('entity.name.type')));

  const p = await tokens('source.dfm', "    Caption = 'Gravar'");
  assert.ok(escopoDe(p, 'Caption').some(s => s.startsWith('variable.other.property')),
    String(escopoDe(p, 'Caption')));
  assert.ok(p.some(x => x.escopos.some(s => s.startsWith('string.quoted'))),
    'a string precisa de escopo: ' + JSON.stringify(p.map(x => x.escopos)));
});

test('.dfm: inherited, sub-propriedade e número', async () => {
  const h = await tokens('source.dfm', '  inherited cxButton2: TcxButton');
  assert.ok(escopoDe(h, 'inherited').some(s => s.startsWith('keyword.control')));

  const s = await tokens('source.dfm', '    ControlOptions.OriginalWidth = 654');
  assert.ok(escopoDe(s, 'ControlOptions').some(s2 => s2.startsWith('variable.other.property')));
  assert.ok(s.some(x => x.texto.includes('654')
    && x.escopos.some(e => e.startsWith('constant.numeric'))),
    'número sem escopo: ' + JSON.stringify(s.map(x => [x.texto, x.escopos])));
});

test('.dfm: True/False e conjuntos', async () => {
  const b = await tokens('source.dfm', '    Visible = False');
  assert.ok(b.some(x => x.texto.includes('False')
    && x.escopos.some(e => e.startsWith('constant.language'))),
    JSON.stringify(b.map(x => [x.texto, x.escopos])));

  const c = await tokens('source.dfm', '    Anchors = [akLeft, akTop]');
  assert.ok(c.some(x => x.escopos.some(e => e.startsWith('constant.other.enum'))),
    'itens do conjunto sem escopo: ' + JSON.stringify(c.map(x => [x.texto, x.escopos])));
});
