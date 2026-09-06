/**
 * Ler classes de um pacote compilado, e inferir a família pelo que a classe publica.
 *
 * Os dois andam juntos: o RTTI de um `.bpl` entrega nome, ancestral e propriedades
 * publicadas, e é com essa lista que a inferência decide se um componente desconhecido é
 * grade, botão ou rótulo. Sem eles, componente sem `.pas` fica invisível para o índice.
 *
 * O `.bpl` de teste é montado byte a byte: um PE mínimo com um `TTypeInfo` de classe. Assim
 * o teste não depende de ter Delphi instalado, e falha se o layout que eu li do binário
 * deixar de bater.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lerBpl, lerPacotes } from '../dfm/bpl';
import { inferirKind, REGRAS } from '../dfm/inferir';

// ---- um PE de mentira, com RTTI de verdade ----

interface ClasseFalsa {
  nome: string;
  unidade: string;
  props: string[];
  /** Índice, na mesma lista, da classe ancestral. -1 para nenhuma. */
  pai: number;
}

const BASE = 0x400000;
const SECAO_VA = 0x1000;
const SECAO_RAW = 0x400;

function curta(s: string): Buffer {
  return Buffer.concat([Buffer.from([s.length]), Buffer.from(s, 'latin1')]);
}

/**
 * Monta o PE. O corpo tem, para cada classe, o TTypeInfo e — logo depois de todos — um
 * ponteiro por classe apontando para o TypeInfo do ancestral, que é o que `ParentInfo`
 * (PPTypeInfo) endereça.
 */
function montarBpl(classes: ClasseFalsa[], arquivo: string): string {
  const corpo: Buffer[] = [];
  const posInfo: number[] = [];
  let cursor = 0;

  // reserva, no fim, um slot de ponteiro por classe (o alvo de ParentInfo)
  const tamanhoInfo = classes.map(c => {
    const props = c.props.reduce((a, p) => a + 26 + 1 + p.length, 0);
    return 1 + 1 + c.nome.length + 4 + 4 + 2 + 1 + c.unidade.length + 2 + props;
  });
  const totalInfos = tamanhoInfo.reduce((a, b) => a + b, 0);
  const slotsEm = totalInfos;

  classes.forEach((c, i) => {
    posInfo[i] = cursor;
    cursor += tamanhoInfo[i];
  });

  classes.forEach((c, i) => {
    const partes: Buffer[] = [Buffer.from([7]), curta(c.nome)];
    const classType = Buffer.alloc(4);
    const parentInfo = Buffer.alloc(4);
    // ParentInfo aponta para o slot DESTA classe; o slot guarda o endereço do TypeInfo do pai
    parentInfo.writeUInt32LE(c.pai >= 0 ? BASE + SECAO_VA + slotsEm + i * 4 : 0);
    const propCount = Buffer.alloc(2);
    propCount.writeUInt16LE(c.props.length);
    const numProps = Buffer.alloc(2);
    numProps.writeUInt16LE(c.props.length);
    partes.push(classType, parentInfo, propCount, curta(c.unidade), numProps);
    for (const p of c.props) { partes.push(Buffer.alloc(26), curta(p)); }
    corpo.push(Buffer.concat(partes));
  });

  const slots = Buffer.alloc(classes.length * 4);
  classes.forEach((c, i) => {
    slots.writeUInt32LE(c.pai >= 0 ? BASE + SECAO_VA + posInfo[c.pai] : 0, i * 4);
  });
  const dados = Buffer.concat([...corpo, slots]);

  const cab = Buffer.alloc(SECAO_RAW);
  cab.write('MZ', 0, 'latin1');
  cab.writeUInt32LE(0x80, 0x3c);
  const pe = 0x80;
  cab.write('PE\0\0', pe, 'latin1');
  cab.writeUInt16LE(0x14c, pe + 4);            // i386
  cab.writeUInt16LE(1, pe + 6);                // uma seção
  cab.writeUInt16LE(224, pe + 20);             // tamanho do optional header
  const opt = pe + 24;
  cab.writeUInt16LE(0x10b, opt);               // PE32
  cab.writeUInt32LE(BASE, opt + 28);
  const sec = opt + 224;
  cab.write('.text\0\0\0', sec, 'latin1');
  cab.writeUInt32LE(dados.length, sec + 8);
  cab.writeUInt32LE(SECAO_VA, sec + 12);
  cab.writeUInt32LE(dados.length, sec + 16);
  cab.writeUInt32LE(SECAO_RAW, sec + 20);

  fs.writeFileSync(arquivo, Buffer.concat([cab, dados]));
  return arquivo;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi4vscode-bpl-'));

const UM = montarBpl([
  { nome: 'TZeusBase', unidade: 'Zeus.Core', pai: -1, props: ['Align', 'Visible'] },
  { nome: 'TZeusGrid', unidade: 'Zeus.Grid', pai: 0, props: ['Columns', 'DataSource'] },
], path.join(TMP, 'zeus.bpl'));

const OUTRO = montarBpl([
  { nome: 'TZeusFilho', unidade: 'Zeus.Extra', pai: -1, props: ['ModalResult'] },
], path.join(TMP, 'extra.bpl'));

test('lê nome, unit, ancestral e propriedades publicadas de um pacote', () => {
  const cs = lerBpl(UM);
  assert.equal(cs.length, 2, JSON.stringify(cs));
  const grid = cs.find(c => c.nome === 'TZeusGrid')!;
  assert.equal(grid.unidade, 'Zeus.Grid');
  assert.equal(grid.ancestral, 'TZeusBase');
  assert.deepEqual(grid.props, ['Columns', 'DataSource']);
  assert.equal(grid.arquivo, 'zeus.bpl');
});

test('classe sem ancestral no arquivo não inventa um', () => {
  const base = lerBpl(UM).find(c => c.nome === 'TZeusBase')!;
  assert.equal(base.ancestral, undefined);
});

test('vários pacotes lidos juntos: nomes de todos, sem duplicar', () => {
  const r = lerPacotes([UM, OUTRO]);
  assert.equal(r.arquivosLidos, 2);
  const nomes = r.classes.map(c => c.nome).sort();
  assert.deepEqual(nomes, ['TZeusBase', 'TZeusFilho', 'TZeusGrid']);
});

test('arquivo que não é PE devolve lista vazia, sem lançar', () => {
  const lixo = path.join(TMP, 'lixo.bpl');
  fs.writeFileSync(lixo, 'isto nao e um executavel');
  assert.deepEqual(lerBpl(lixo), []);
  assert.equal(lerPacotes([lixo]).classes.length, 0);
});

// ---- inferência ----

test('a família sai do que a classe publica, não do nome', () => {
  assert.equal(inferirKind(new Set(['columns', 'datasource']))?.kind, 'grid');
  assert.equal(inferirKind(new Set(['modalresult', 'caption']))?.kind, 'btn');
  assert.equal(inferirKind(new Set(['lines', 'scrollbars']))?.kind, 'edit');
  assert.equal(inferirKind(new Set(['picture', 'stretch']))?.kind, 'image');
  assert.equal(inferirKind(new Set(['checked', 'caption']))?.kind, 'chk');
});

test('container só vira painel quando nada mais específico casa', () => {
  // a mesma classe, com e sem as propriedades que a tornam uma grade
  assert.equal(inferirKind(new Set(['bevelouter', 'align']))?.kind, 'panel');
  assert.equal(inferirKind(new Set(['bevelouter', 'align', 'columns', 'datasource']))?.kind,
    'grid', 'a regra de painel não pode engolir a de grade');
  assert.equal(inferirKind(new Set(['bevelouter', 'align', 'lines']))?.kind, 'edit');
});

test('rótulo é o que mostra texto e não recebe foco', () => {
  assert.equal(inferirKind(new Set(['caption', 'transparent']))?.kind, 'lbl');
  assert.equal(inferirKind(new Set(['caption', 'transparent', 'taborder']))?.kind, undefined,
    'com TabOrder não é rótulo: é controle de janela');
});

test('sem propriedade nenhuma não há palpite — e isso é a resposta certa', () => {
  assert.equal(inferirKind(new Set()), undefined);
  assert.equal(inferirKind(new Set(['tag', 'name'])), undefined);
});

test('toda regra declara motivo: o palpite tem de ser explicável', () => {
  for (const r of REGRAS) {
    assert.ok(r.motivo && r.motivo.length > 5, JSON.stringify(r));
    assert.ok(r.exige.length, JSON.stringify(r));
    assert.ok(r.exige.every(p => p === p.toLowerCase()), `${r.motivo}: exige em minúsculas`);
    assert.ok((r.proibe ?? []).every(p => p === p.toLowerCase()), r.motivo);
  }
});

test('o pacote alimenta a inferência: classe sem .pas ganha família', async () => {
  const { Registry } = await import('../dfm/registry');
  // nome propositalmente neutro: se o nome denunciasse a família, o teste não provaria nada
  const neutro = montarBpl([
    { nome: 'TZeusBase', unidade: 'Zeus.Core', pai: -1, props: ['Align'] },
    { nome: 'TAcmeQuadro', unidade: 'Acme.Q', pai: 0, props: ['Columns', 'DataSource'] },
  ], path.join(TMP, 'acme.bpl'));

  const reg = Registry.fromJSON({ parents: [] });
  assert.equal(reg.kind('TAcmeQuadro'), 'misc', 'antes de absorver, nada se sabe');

  reg.absorverBpl(lerBpl(neutro));
  const [kind, fonte] = reg.kindSource('TAcmeQuadro');
  assert.equal(kind, 'grid', 'as propriedades dizem que é uma grade');
  assert.equal(fonte, 'propriedades');
  assert.deepEqual([...reg.publicadasDe('TAcmeQuadro')].sort(),
    ['align', 'columns', 'datasource'], 'herda as publicadas do ancestral');
});
