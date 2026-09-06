/**
 * Criação de componentes: dentro de layout control, a partir de modelo, e no menu.
 *
 * Os três escrevem blocos inteiros no .dfm, e nos três o erro é do tipo que só aparece em
 * runtime: componente que existe mas nenhum grupo posiciona, nome repetido que impede o form
 * de carregar, `end` a mais ou a menos numa árvore de menu.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Registry } from '../dfm/registry';
import { DfmDocument } from '../dfm/document';
import { parseDfm } from '../dfm/parser';
import { addNoLayout, destinoNoLayout } from '../dfm/addLayout';
import { criarTemplate, inserirTemplate } from '../dfm/insert';
import { lerMenu, setMenu } from '../dfm/menu';
import { TextChange } from '../dfm/edit';
import { padraoDe } from '../dfm/palette';
const PNG_HEX = '89504E470D0A1A0A0000000D49484452000000040000000208060000004CA0F63A0000000A49444154789C6360000000020001E221BC330000000049454E44AE426082';

const reg = Registry.fromJSON({
  parents: [
    ['tform1', 'tform'], ['tform', 'tcustomform'], ['tcustomform', 'twincontrol'],
    ['tdxlayoutcontrol', 'tdxcustomlayoutcontrol'],
    ['tdxcustomlayoutcontrol', 'twincontrol'],
    ['tdxlayoutitem', 'tdxcustomlayoutitem'], ['tdxcustomlayoutitem', 'tcomponent'],
    ['tdxlayoutimageitem', 'tdxcustomlayoutitem'],
    ['tdxlayoutgroup', 'tdxcustomlayoutgroup'], ['tdxcustomlayoutgroup', 'tcomponent'],
    ['tcxtextedit', 'tcxcustomtextedit'], ['tcxcustomtextedit', 'twincontrol'],
    ['tbutton', 'tcustombutton'], ['tcustombutton', 'twincontrol'],
    ['tpanel', 'tcustompanel'], ['tcustompanel', 'twincontrol'],
    ['tmainmenu', 'tmenu'], ['tmenu', 'tcomponent'], ['tmenuitem', 'tcomponent'],
    ['tmemo', 'tcustommemo'], ['tcustommemo', 'twincontrol'],
    ['twincontrol', 'tcontrol'], ['tcontrol', 'tcomponent'],
  ],
});

const NL = String.fromCharCode(10);

/**
 * Aplica as mudanças como o editor aplica: várias inserções na mesma linha entram na ordem
 * em que foram pedidas — inverter aqui daria um bloco de cabeça para baixo e um teste que
 * falha por culpa do teste.
 */
function aplicar(texto: string, changes: TextChange[]): string {
  const linhas = texto.split(/\r?\n/);
  for (const c of changes.filter(c => c.kind === 'replace')) {
    linhas.splice(c.line, c.count ?? 1, ...c.text!.split(NL));
  }
  const grupos = new Map<number, string[]>();
  for (const c of changes.filter(c => c.kind === 'insert')) {
    if (!grupos.has(c.line)) { grupos.set(c.line, []); }
    grupos.get(c.line)!.push(c.text!);
  }
  const posteriores = [
    ...[...grupos].map(([line, textos]) => ({ line, textos, del: 0 })),
    ...changes.filter(c => c.kind === 'delete')
      .map(c => ({ line: c.line, textos: [] as string[], del: c.count ?? 1 })),
  ].sort((a, b) => b.line - a.line);
  for (const p of posteriores) { linhas.splice(p.line, p.del, ...p.textos); }
  return linhas.join(NL);
}

// ---- P08: dentro de TdxLayoutControl ----

const LAYOUT = [
  'object Form1: TForm1',
  '  ClientWidth = 400',
  '  ClientHeight = 300',
  '  object dxLayout1: TdxLayoutControl',
  '    Left = 0',
  '    Top = 0',
  '    Width = 400',
  '    Height = 300',
  '    object Edit1: TcxTextEdit',
  '      Left = 10',
  '      Top = 10',
  '      Width = 121',
  '    end',
  '    object dxLayout1Group_Root: TdxLayoutGroup',
  '      AlignHorz = ahClient',
  '      Index = -1',
  '    end',
  '    object dxLayout1Item1: TdxLayoutItem',
  '      Parent = dxLayout1Group_Root',
  '      Control = Edit1',
  '      ControlOptions.OriginalHeight = 21',
  '      ControlOptions.OriginalWidth = 121',
  '      Index = 0',
  '    end',
  '  end',
  'end',
  '',
].join('\r\n');

function docLayout(): DfmDocument {
  return new DfmDocument('/x/Form1.dfm', LAYOUT, reg);
}

test('o destino sai do controle já posicionado no layout', () => {
  const d = docLayout();
  const dest = destinoNoLayout(d, reg, d.byName.get('Edit1')!);
  assert.ok(dest);
  assert.equal(dest!.host.name, 'dxLayout1');
  assert.equal(dest!.grupo, 'dxLayout1Group_Root');
  assert.equal(dest!.clsItem, 'TdxLayoutItem', 'copia a classe do item irmão');
  assert.equal(dest!.index, 1, 'entra depois do que já está lá');
});

test('selecionar o próprio layout control leva ao grupo raiz', () => {
  const d = docLayout();
  const dest = destinoNoLayout(d, reg, d.byName.get('dxLayout1')!);
  assert.equal(dest?.grupo, 'dxLayout1Group_Root');
});

test('container comum não é destino de layout', () => {
  const d = docLayout();
  assert.equal(destinoNoLayout(d, reg, d.root), null);
});

test('criar sob layout gera o controle E o item que o posiciona', () => {
  const d = docLayout();
  const dest = destinoNoLayout(d, reg, d.byName.get('Edit1')!)!;
  const r = addNoLayout(d, dest, 'TcxTextEdit', reg);
  const novo = aplicar(LAYOUT, r.changes);

  const raiz = parseDfm(novo, '/x/Form1.dfm');
  assert.ok(raiz, 'o resultado ainda é um .dfm válido');
  const d2 = new DfmDocument('/x/Form1.dfm', novo, reg);
  const criado = d2.byName.get(r.name);
  assert.ok(criado, `${r.name} não entrou na árvore`);
  // e o item o encontrou: sem isso o componente existe mas não aparece
  const item = d2.byControl.get(criado!);
  assert.ok(item, 'o controle novo ficou sem TdxLayoutItem');
  assert.equal(item!.props.get('parent')?.raw.trim(), 'dxLayout1Group_Root');
  assert.equal(item!.props.get('index')?.raw.trim(), '1');
});

test('o tamanho inicial vem da classe, não só da família', () => {
  assert.equal(padraoDe('edit', 'TcxMemo').h, 89, 'memo nasce alto');
  assert.equal(padraoDe('edit', 'TcxTextEdit').h, 21, 'edit nasce baixo');
  assert.equal(padraoDe('btn').w, 75, 'sem classe, vale a família');
});

// ---- P09: modelos ----

const COMTPL = [
  'object Form1: TForm1',
  '  ClientWidth = 400',
  '  ClientHeight = 300',
  '  object Panel1: TPanel',
  '    Left = 0',
  '    Top = 0',
  '    Width = 200',
  '    Height = 80',
  '    object Botao1: TButton',
  '      Left = 8',
  '      Top = 8',
  "      Caption = 'OK'",
  '      OnClick = Botao1Click',
  '    end',
  '  end',
  '  object Alvo: TPanel',
  '    Left = 0',
  '    Top = 100',
  '    Width = 200',
  '    Height = 80',
  '  end',
  'end',
  '',
].join('\r\n');

test('modelo guarda o bloco inteiro sem o recuo do lugar de origem', () => {
  const d = new DfmDocument('/x/Form1.dfm', COMTPL, reg);
  const t = criarTemplate(COMTPL, d.byName.get('Panel1')!, 'CabeçalhoPadrão');
  assert.equal(t.cls, 'TPanel');
  assert.equal(t.linhas[0], 'object Panel1: TPanel');
  assert.ok(t.linhas.some(l => l.includes('Botao1')), 'o filho vai junto');
  assert.equal(t.linhas[t.linhas.length - 1], 'end');
});

test('inserir o modelo renomeia o que colide e mantém o form legível', () => {
  const d = new DfmDocument('/x/Form1.dfm', COMTPL, reg);
  const t = criarTemplate(COMTPL, d.byName.get('Panel1')!, 'Cabeçalho');
  const r = inserirTemplate(d, d.byName.get('Alvo')!, t, 12, 20);
  const novo = aplicar(COMTPL, r.changes);

  const d2 = new DfmDocument('/x/Form1.dfm', novo, reg);
  assert.notEqual(r.name, 'Panel1', 'o nome antigo já estava em uso');
  assert.ok(d2.byName.get(r.name), `${r.name} não entrou na árvore`);
  // dois componentes de mesmo nome impedem o form de carregar
  const nomes = [...d2.index.values()].map(n => n.name).filter(Boolean);
  assert.equal(new Set(nomes).size, nomes.length, nomes.join(','));
  // o handler continua apontando para o método que existe no .pas
  assert.ok(novo.includes('OnClick = Botao1Click'), novo);
});

test('modelo sem nome é recusado', () => {
  const d = new DfmDocument('/x/Form1.dfm', COMTPL, reg);
  assert.throws(() => criarTemplate(COMTPL, d.byName.get('Panel1')!, '   '),
    /precisa de um nome/);
});

// ---- P10: editor de menu ----

const COMMENU = [
  'object Form1: TForm1',
  '  ClientWidth = 400',
  '  ClientHeight = 300',
  '  object MainMenu1: TMainMenu',
  '    Left = 24',
  '    Top = 8',
  '    object Arquivo1: TMenuItem',
  "      Caption = '&Arquivo'",
  '      object Salvar1: TMenuItem',
  "        Caption = '&Salvar'",
  '        ShortCut = 16467',
  '        OnClick = Salvar1Click',
  '      end',
  '    end',
  '    object Ajuda1: TMenuItem',
  "      Caption = 'A&juda'",
  '    end',
  '  end',
  'end',
  '',
].join('\r\n');

function docMenu(): DfmDocument {
  return new DfmDocument('/x/Form1.dfm', COMMENU, reg);
}

test('o menu é lido como árvore', () => {
  const d = docMenu();
  const itens = lerMenu(d.byName.get('MainMenu1')!);
  assert.equal(itens.length, 2);
  assert.equal(itens[0].caption, '&Arquivo');
  assert.equal(itens[0].kids[0].caption, '&Salvar');
  assert.equal(itens[1].caption, 'A&juda');
});

test('renomear o caption preserva ShortCut e OnClick', () => {
  const d = docMenu();
  const node = d.byName.get('MainMenu1')!;
  const itens = lerMenu(node);
  itens[0].kids[0].caption = '&Gravar';
  const novo = aplicar(COMMENU, setMenu(d, COMMENU, node, itens));

  assert.ok(novo.includes("Caption = '&Gravar'"), novo);
  assert.ok(novo.includes('ShortCut = 16467'), 'o atalho não pode sumir');
  assert.ok(novo.includes('OnClick = Salvar1Click'), 'nem o handler');
  // e o Left/Top do próprio menu continuam lá
  assert.ok(novo.includes('Left = 24') && novo.includes('Top = 8'), novo);
});

test('item novo entra com nome livre e o .dfm continua parseável', () => {
  const d = docMenu();
  const node = d.byName.get('MainMenu1')!;
  const itens = lerMenu(node);
  itens[0].kids.push({ path: '', name: '', caption: '-', separador: true, kids: [] });
  itens[0].kids.push({ path: '', name: '', caption: 'Sai&r', separador: false, kids: [] });
  const novo = aplicar(COMMENU, setMenu(d, COMMENU, node, itens));

  const d2 = new DfmDocument('/x/Form1.dfm', novo, reg);
  const menu = d2.byName.get('MainMenu1')!;
  const arv = lerMenu(menu);
  assert.deepEqual(arv[0].kids.map(k => k.caption), ['&Salvar', '-', 'Sai&r'], novo);
  const nomes = arv[0].kids.map(k => k.name);
  assert.equal(new Set(nomes).size, 3, 'nomes repetidos: ' + nomes.join(','));
});

test('remover item tira o bloco inteiro, com os filhos', () => {
  const d = docMenu();
  const node = d.byName.get('MainMenu1')!;
  const itens = lerMenu(node);
  itens.splice(0, 1);
  const novo = aplicar(COMMENU, setMenu(d, COMMENU, node, itens));
  assert.ok(!novo.includes('Arquivo1'), novo);
  assert.ok(!novo.includes('Salvar1'), 'o filho tinha de ir junto: ' + novo);
  assert.ok(novo.includes('Ajuda1'));
  assert.ok(new DfmDocument('/x/Form1.dfm', novo, reg).byName.get('MainMenu1'));
});

test('caption com apóstrofo é escapado na volta', () => {
  const d = docMenu();
  const node = d.byName.get('MainMenu1')!;
  const itens = lerMenu(node);
  itens[1].caption = "D'água";
  const novo = aplicar(COMMENU, setMenu(d, COMMENU, node, itens));
  assert.ok(novo.includes("Caption = 'D''água'"), novo);
  const d2 = new DfmDocument('/x/Form1.dfm', novo, reg);
  assert.equal(lerMenu(d2.byName.get('MainMenu1')!)[1].caption, "D'água");
});

// ---- layout control: Align do controle não vale, e a imagem mora no item ----

const COM_LAYOUT = [
  'object Form1: TForm1',
  '  ClientWidth = 266',
  '  ClientHeight = 342',
  '  object LayoutControl: TdxLayoutControl',
  '    Left = 0',
  '    Top = 0',
  '    Width = 266',
  '    Height = 342',
  '    object cbLembrar: TcxTextEdit',
  '      Left = 10',
  '      Top = 217',
  '      Align = alLeft',
  '      Width = 246',
  '      Height = 21',
  '    end',
  '    object LayoutGrupo: TdxLayoutGroup',
  '      Index = -1',
  '    end',
  '    object LayoutItemCb: TdxLayoutItem',
  '      Parent = LayoutGrupo',
  '      Control = cbLembrar',
  '      Index = 1',
  '    end',
  '    object LayoutItemLogo: TdxLayoutImageItem',
  '      Parent = LayoutGrupo',
  '      Index = 0',
  '      Image.Data = {' + PNG_HEX + '}',
  '    end',
  '  end',
  'end',
  '',
].join('\r\n');

test('Align do controle é ignorado dentro de um TdxLayoutControl', async () => {
  const { place, visualKids } = await import('../dfm/layout');
  const d = new DfmDocument('/x/Form1.dfm', COM_LAYOUT, reg);
  const host = d.byName.get('LayoutControl')!;
  const r = place(visualKids(host, reg), 266, 342, reg, 12, host);
  const cb = r.get(d.byName.get('cbLembrar')!)!;
  // com o Align aplicado viraria 0,0 246x342 e cobriria os irmãos
  assert.deepEqual([cb.x, cb.y, cb.w, cb.h], [10, 217, 246, 21]);
});

test('fora de um layout control o Align continua valendo', async () => {
  const { place } = await import("../dfm/layout");
  const d = new DfmDocument('/x/Form1.dfm', COM_LAYOUT, reg);
  const host = d.byName.get('LayoutControl')!;
  // o mesmo controle, avaliado como se o pai fosse o form
  const r = place([d.byName.get('cbLembrar')!], 266, 342, reg, 12, d.root);
  const cb = r.get(d.byName.get('cbLembrar')!)!;
  assert.deepEqual([cb.x, cb.y, cb.w, cb.h], [0, 0, 246, 342], 'alLeft ocupa a coluna inteira');
  assert.ok(host, 'o host segue na árvore');
});

test('a imagem de um TdxLayoutImageItem é desenhada, com o tamanho do PNG', async () => {
  const { embeddedImage, dimensaoImagem, renderForm } = await import('../dfm/render');
  const d = new DfmDocument('/x/Form1.dfm', COM_LAYOUT, reg);
  const item = d.byName.get('LayoutItemLogo')!;
  const uri = embeddedImage(item);
  assert.ok(uri && uri.startsWith('data:image/png;base64,'), String(uri).slice(0, 40));
  assert.deepEqual(dimensaoImagem(item, uri!), [4, 2], 'largura e altura vêm do IHDR');

  const { html } = renderForm(d, reg, {
    flexLayout: true, nonce: 'N', cssUri: 'c', jsUri: 'j',
    paletaUri: 'p', inspetorUri: 'i', dialogosUri: 'd',
  });
  assert.ok(html.includes('<img class="limg"'), 'a imagem do item não foi desenhada');
  assert.ok(html.includes('width="4"'), html.slice(html.indexOf('limg') - 40, html.indexOf('limg') + 120));
});

test('form com layout control já abre no layout recalculado', () => {
  const d = new DfmDocument('/x/Form1.dfm', COM_LAYOUT, reg);
  assert.equal(d.temLayoutControl, true);
  const semLayout = new DfmDocument('/x/F2.dfm',
    ['object F2: TForm1', '  ClientWidth = 100', '  ClientHeight = 100', 'end', ''].join('\r\n'),
    reg);
  assert.equal(semLayout.temLayoutControl, false);
});
