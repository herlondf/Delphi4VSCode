import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';
import { renderForm, isDataModule, trayItems } from '../dfm/render';
import { walk } from '../dfm/model';

const reg = Registry.fromJSON({
  parents: [
    ['tdmcadastroclient', 'tdatamodule'], ['tdatamodule', 'tcomponent'],
    ['tquerydataset', 'twheredataset'], ['twheredataset', 'tclientdataset'],
    ['tclientdataset', 'tdataset'], ['tdataset', 'tcomponent'],
    ['twidestringfield', 'tstringfield'], ['tstringfield', 'tfield'], ['tfield', 'tcomponent'],
    ['tdatasource', 'tcomponent'],
  ],
});

const DM = `object DmX: TDmCadastroClient
  Height = 240
  Width = 327
  object cdsRegistro: TQueryDataSet
    ProviderName = 'dspRegistro'
    Left = 208
    Top = 16
    object cdsRegistroID: TWideStringField
      FieldName = 'REGISTRO_ID'
    end
  end
  object dsRegistro: TDataSource
    DataSet = cdsRegistro
    Left = 96
    Top = 80
  end
end
`;

function render() {
  const doc = new DfmDocument('/tmp/DmX.dfm', DM, reg);
  return renderForm(doc, reg, { flexLayout: false, nonce: 'N', cssUri: 'c', jsUri: 'j', paletaUri: 'p', inspetorUri: 'i', dialogosUri: 'd' });
}

test('data module é reconhecido pela herança', () => {
  const doc = new DfmDocument('/tmp/DmX.dfm', DM, reg);
  assert.ok(isDataModule(doc.root, reg));
  // um form comum não pode cair nesse caminho
  const form = new DfmDocument('/tmp/F.dfm',
    'object F: TForm\n  ClientWidth = 100\n  ClientHeight = 100\nend\n', reg);
  assert.equal(isDataModule(form.root, reg), false);
});

test('só componentes de primeiro nível com posição viram ícone', () => {
  const doc = new DfmDocument('/tmp/DmX.dfm', DM, reg);
  const itens = trayItems(doc.root, reg);
  assert.deepEqual(itens.map(n => n.name), ['cdsRegistro', 'dsRegistro']);
  // os campos são filhos do dataset: não aparecem na superfície
  assert.ok(![...walk(doc.root)].filter(n => n.cls === 'TWideStringField')
    .some(f => itens.includes(f)));
});

test('a superfície usa Width/Height e os ícones ficam em Left/Top', () => {
  const { html, stats } = render();
  assert.match(html, /class="form dm" style="width:327px;height:266px"/);
  assert.match(html, /class="tray drag" style="left:208px;top:16px"/);
  assert.match(html, /class="tray drag" style="left:96px;top:80px"/);
  assert.match(html, />cdsRegistro</);
  assert.equal(stats.visuais, 2);
  assert.equal(stats.editaveis, 2, 'a posição do ícone é gravada: dá para mover');
});

test('o ícone traz o que o front precisa e o contador de filhos', () => {
  const { html } = render();
  const icones = [...html.matchAll(/<div class="tray[^>]*>/g)].map(m => m[0]);
  assert.equal(icones.length, 2);
  for (const i of icones) {
    assert.match(i, /data-path="/);
    assert.match(i, /data-mode="/);
  }
  assert.match(html, /<b>1<\/b>/, 'o dataset mostra que tem 1 campo dentro');
});

test('o data module real do projeto renderiza', () => {
  const arq = 'D:/Projetos/projeto de teste/app-desktop/modulos/Registro/CadastroDataClient.dfm';
  if (!fs.existsSync(arq)) { return; }
  const real = new Registry();
  real.scan(['D:/Projetos/projeto de teste/app-desktop/modulos/Registro'], 20000);
  const doc = DfmDocument.fromFile(arq, real);
  assert.ok(isDataModule(doc.root, real), 'CadastroDataClient precisa ser data module');
  const { html, stats } = renderForm(doc, real,
    { flexLayout: false, nonce: 'N', cssUri: 'c', jsUri: 'j', paletaUri: 'p', inspetorUri: 'i', dialogosUri: 'd' });
  assert.ok(stats.visuais >= 3, `esperava ícones, achei ${stats.visuais}`);
  assert.match(html, /class="tray/);
});

/**
 * TextMate usa Oniguruma, não a regex do JavaScript: `(?i)` no início é o modificador de
 * caixa e precisa virar a flag `i` para o teste conseguir compilar a expressão.
 */
function comoJs(pattern: string): RegExp {
  return pattern.startsWith('(?i)')
    ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern);
}

test('gramáticas são JSON válido com os escopos declarados', () => {
  const dir = path.join(__dirname, '..', '..', 'syntaxes');
  for (const [arq, escopo] of [['dfm.tmLanguage.json', 'source.dfm'],
                               ['pascal.tmLanguage.json', 'source.pascal']]) {
    const g = JSON.parse(fs.readFileSync(path.join(dir, arq), 'utf8'));
    assert.equal(g.scopeName, escopo);
    assert.ok(Array.isArray(g.patterns) && g.patterns.length);
    // toda referência #x precisa existir no repository
    const refs = [...JSON.stringify(g).matchAll(/"include":\s*"#(\w+)"/g)].map(m => m[1]);
    for (const r of refs) {
      assert.ok(g.repository[r], `${arq}: #${r} não existe no repository`);
    }
    // e toda regex precisa compilar — uma gramática com regex inválida falha em silêncio
    const visitar = (o: unknown): void => {
      if (Array.isArray(o)) { o.forEach(visitar); return; }
      if (!o || typeof o !== 'object') { return; }
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === 'string' && ['match', 'begin', 'end'].includes(k)) {
          assert.doesNotThrow(() => comoJs(v), `${arq}: regex inválida em ${k}: ${v}`);
        } else { visitar(v); }
      }
    };
    visitar(g);
  }
});

test('a gramática do dfm marca objeto, propriedade e string', () => {
  const dir = path.join(__dirname, '..', '..', 'syntaxes');
  const g = JSON.parse(fs.readFileSync(path.join(dir, 'dfm.tmLanguage.json'), 'utf8'));
  const obj = comoJs(g.repository.objeto.match);
  const m = obj.exec('  inherited FormItemMan: TFormItemMan');
  assert.ok(m && m[1] === 'inherited' && m[2] === 'FormItemMan' && m[4] === 'TFormItemMan', String(m));
  const prop = comoJs(g.repository.propriedade.match);
  const p = prop.exec('    ControlOptions.OriginalWidth = 654');
  assert.ok(p && p[1] === 'ControlOptions' && p[2] === '.OriginalWidth', String(p));
});

test('a gramática do pascal marca declaração de método e classe', () => {
  const dir = path.join(__dirname, '..', '..', 'syntaxes');
  const g = JSON.parse(fs.readFileSync(path.join(dir, 'pascal.tmLanguage.json'), 'utf8'));
  const decl = g.repository.declaracoes.patterns;
  const metodo = comoJs(decl[0].match);
  const m = metodo.exec('procedure TFormItemMan.BotaoClick(Sender: TObject);');
  assert.ok(m && m[2] === 'TFormItemMan' && m[4] === 'BotaoClick', String(m));
  const classe = comoJs(decl[1].match);
  const c = classe.exec('  TFormBase = class(TdxForm, IDocumentModule)');
  assert.ok(c && c[1] === 'TFormBase' && c[5] === 'TdxForm', String(c));
});
