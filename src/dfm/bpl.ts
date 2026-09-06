/**
 * A02 — ler classes de um `.bpl` quando não existe o `.pas`.
 *
 * Componente comercial costuma vir só compilado. O `.dcu` não ajuda: formato proprietário
 * que muda a cada versão do Delphi. O VMT também não — o ponteiro do ancestral só é
 * resolvido quando o pacote é carregado, e no arquivo em disco ele aponta para a tabela de
 * import.
 *
 * O que resolve é o RTTI. Todo `published` gera um `TTypeInfo` dentro do binário, e para uma
 * classe ele traz nome, ancestral, unit e a lista de propriedades publicadas — exatamente o
 * que o índice precisa. Layout, em 32 bits:
 *
 *   Kind: Byte (7 = tkClass) | Name: ShortString
 *   ClassType: Pointer | ParentInfo: PPTypeInfo | PropCount: SmallInt
 *   UnitName: ShortString | NumProps: Word | TPropInfo[]
 *
 *   TPropInfo: 4 ponteiros + Index + Default + NameIndex, e então Name: ShortString
 *
 * Em 64 bits os ponteiros passam a 8 bytes; o resto é igual.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ClasseBpl {
  nome: string;
  ancestral?: string;
  unidade: string;
  props: string[];
  /** A05 — valores possíveis das propriedades de enumeração, por nome de propriedade. */
  enums?: Record<string, string[]>;
  arquivo: string;
}

const TK_CLASS = 7;
const TK_ENUMERATION = 3;
const IDENT = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const NOME_CLASSE = /^T[A-Za-z0-9_]+$/;

interface Imagem {
  buf: Buffer;
  imageBase: number;
  ponteiro: number;
  secoes: { va: number; tam: number; raw: number }[];
}

/** Abre o PE e guarda o que é preciso para converter endereço virtual em posição no arquivo. */
function abrir(arquivo: string): Imagem | null {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(arquivo);
  } catch {
    return null;
  }
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) { return null; }
  const peOff = buf.readUInt32LE(0x3c);
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) { return null; }

  const optOff = peOff + 24;
  const magic = buf.readUInt16LE(optOff);
  const pe64 = magic === 0x20b;
  const imageBase = pe64 ? Number(buf.readBigUInt64LE(optOff + 24)) : buf.readUInt32LE(optOff + 28);
  const nSec = buf.readUInt16LE(peOff + 6);
  const secOff = optOff + buf.readUInt16LE(peOff + 20);
  const secoes = [];
  for (let i = 0; i < nSec; i++) {
    const s = secOff + i * 40;
    if (s + 40 > buf.length) { break; }
    secoes.push({
      va: buf.readUInt32LE(s + 12),
      tam: buf.readUInt32LE(s + 16),
      raw: buf.readUInt32LE(s + 20),
    });
  }
  return { buf, imageBase, ponteiro: pe64 ? 8 : 4, secoes };
}

function posicao(img: Imagem, va: number): number {
  const rel = va - img.imageBase;
  const s = img.secoes.find(x => rel >= x.va && rel < x.va + x.tam);
  if (!s) { return -1; }
  const off = rel - s.va + s.raw;
  return off >= 0 && off < img.buf.length ? off : -1;
}

function endereco(img: Imagem, off: number): number {
  const s = img.secoes.find(x => off >= x.raw && off < x.raw + x.tam);
  return s ? img.imageBase + s.va + (off - s.raw) : -1;
}

function lerPonteiro(img: Imagem, off: number): number {
  if (off < 0 || off + img.ponteiro > img.buf.length) { return -1; }
  return img.ponteiro === 8
    ? Number(img.buf.readBigUInt64LE(off)) : img.buf.readUInt32LE(off);
}

/** ShortString: 1 byte de tamanho e os caracteres. */
function curta(img: Imagem, off: number): string {
  if (off < 0 || off >= img.buf.length) { return ''; }
  const n = img.buf[off];
  if (n === 0 || n > 63 || off + 1 + n > img.buf.length) { return ''; }
  return img.buf.toString('latin1', off + 1, off + 1 + n);
}

interface Cru {
  nome: string;
  unidade: string;
  paiPP: number;
  props: string[];
  /** Endereço do TypeInfo do tipo de cada propriedade, para resolver enumerações depois. */
  tipos: number[];
  va: number;
}

/**
 * A05 — nomes de um `tkEnumeration`.
 *
 * `Kind` + `Name` + OrdType(1) + MinValue(4) + MaxValue(4) + BaseType(ptr), e então os nomes
 * concatenados como short strings, um por valor. É de onde sai a lista real de um `Align` ou
 * de um `BorderStyle`, em vez da tabela que eu mantinha à mão.
 */
function lerEnum(img: Imagem, va: number): string[] | undefined {
  const off = posicao(img, va);
  if (off < 0 || img.buf[off] !== TK_ENUMERATION) { return undefined; }
  const nome = curta(img, off + 1);
  if (!nome) { return undefined; }
  let cursor = off + 2 + nome.length;
  const min = img.buf.readInt32LE(cursor + 1);
  const max = img.buf.readInt32LE(cursor + 5);
  if (min !== 0 || max < 0 || max > 512) { return undefined; }
  cursor += 1 + 4 + 4 + img.ponteiro;
  const out: string[] = [];
  for (let i = 0; i <= max; i++) {
    const v = curta(img, cursor);
    if (!v || !IDENT.test(v)) { return undefined; }
    out.push(v);
    cursor += 1 + v.length;
  }
  return out;
}

/**
 * Varre o binário atrás de `TTypeInfo` de classe.
 *
 * O reconhecimento é por forma, não por tabela: byte 7, nome que parece classe Delphi e —
 * o que separa acerto de coincidência — um `UnitName` logo depois que é um identificador
 * Pascal válido. Sem essa checagem, qualquer byte 7 seguido de texto viraria uma classe.
 */
function varrer(img: Imagem, arquivo: string): Map<number, Cru> {
  const achados = new Map<number, Cru>();
  const b = img.buf;
  const p = img.ponteiro;

  /*
   * O laço vai até o fim do buffer, não até `length - 96`: um pacote pequeno pode ter o
   * RTTI nos últimos bytes, e a margem fixa o perderia inteiro. Quem cuida dos limites são
   * `curta` e `lerPonteiro`, que já devolvem vazio quando o campo não cabe.
   */
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== TK_CLASS) { continue; }
    const nome = curta(img, i + 1);
    if (!nome || !NOME_CLASSE.test(nome)) { continue; }

    const td = i + 2 + nome.length;
    const paiPP = lerPonteiro(img, td + p);
    const uOff = td + p * 2 + 2;
    const unidade = curta(img, uOff);
    if (!unidade || !IDENT.test(unidade)) { continue; }

    const nOff = uOff + 1 + unidade.length;
    if (nOff + 2 > b.length) { continue; }
    const quantas = b.readUInt16LE(nOff);
    if (quantas > 4096) { continue; }

    const props: string[] = [];
    const tipos: number[] = [];
    let cursor = nOff + 2;
    const fixo = p * 4 + 4 + 4 + 2;
    for (let k = 0; k < quantas; k++) {
      const nm = curta(img, cursor + fixo);
      if (!nm || !IDENT.test(nm)) { break; }
      props.push(nm);
      // PropType é o primeiro campo do TPropInfo, e também é PPTypeInfo
      tipos.push(lerPonteiro(img, cursor));
      cursor += fixo + 1 + nm.length;
    }
    // lista truncada quer dizer que o layout não bateu: melhor sem propriedades que com lixo
    const va = endereco(img, i);
    if (va < 0) { continue; }
    const ok = props.length === quantas;
    achados.set(va, {
      nome, unidade, paiPP, va,
      props: ok ? props : [], tipos: ok ? tipos : [],
    });
  }
  return achados;
}

/**
 * Lê um `.bpl` (ou qualquer PE com RTTI do Delphi).
 *
 * `externos` recebe os ancestrais cujo `TTypeInfo` mora em outro pacote — é o caso normal,
 * já que quase toda classe herda de algo da RTL. Quem chama resolve isso lendo o conjunto
 * inteiro de pacotes de uma vez.
 */
export function lerBpl(arquivo: string): ClasseBpl[] {
  const img = abrir(arquivo);
  if (!img) { return []; }
  const crus = varrer(img, arquivo);
  const out: ClasseBpl[] = [];

  for (const c of crus.values()) {
    let ancestral: string | undefined;
    // ParentInfo é PPTypeInfo: um ponteiro para o ponteiro do TypeInfo do ancestral
    const passo1 = posicao(img, c.paiPP);
    if (passo1 >= 0) {
      const paiVa = lerPonteiro(img, passo1);
      ancestral = crus.get(paiVa)?.nome;
    }
    out.push({
      nome: c.nome, ancestral, unidade: c.unidade, props: c.props,
      enums: enumsDe(img, c), arquivo: path.basename(arquivo),
    });
  }
  return out;
}

/** Resolve, para cada propriedade, se o tipo dela é uma enumeração — e quais os valores. */
function enumsDe(img: Imagem, c: Cru): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  c.props.forEach((nome, i) => {
    const pp = c.tipos[i];
    if (pp === undefined || pp <= 0) { return; }
    const passo1 = posicao(img, pp);
    if (passo1 < 0) { return; }
    const valores = lerEnum(img, lerPonteiro(img, passo1));
    if (valores && valores.length > 1) { out[nome] = valores; }
  });
  return Object.keys(out).length ? out : undefined;
}

export interface ResumoBpl {
  classes: ClasseBpl[];
  arquivosLidos: number;
  semAncestral: number;
}

/**
 * Lê vários pacotes como um conjunto só.
 *
 * Ler um a um deixa metade das classes sem ancestral: `TUIButton` herda de algo que está no
 * `rtl` ou no `vcl`. Juntando os `TTypeInfo` de todos antes de resolver, a cadeia fecha.
 */
export function lerPacotes(arquivos: string[]): ResumoBpl {
  const porNome = new Map<string, ClasseBpl>();
  const paiPendente = new Map<string, { arquivo: string; paiPP: number }>();
  const imagens: { img: Imagem; crus: Map<number, Cru>; arquivo: string }[] = [];
  let lidos = 0;

  for (const a of arquivos) {
    const img = abrir(a);
    if (!img) { continue; }
    lidos++;
    const crus = varrer(img, a);
    imagens.push({ img, crus, arquivo: a });
  }

  // primeiro todos os nomes, depois os ancestrais: é o que permite cruzar pacotes
  const porVa = new Map<string, Cru>();
  for (const { img, crus, arquivo } of imagens) {
    for (const c of crus.values()) {
      porVa.set(`${arquivo}#${c.va}`, c);
      if (!porNome.has(c.nome.toLowerCase())) {
        porNome.set(c.nome.toLowerCase(), {
          nome: c.nome, unidade: c.unidade, props: c.props,
          arquivo: path.basename(arquivo),
        });
        paiPendente.set(c.nome.toLowerCase(), { arquivo, paiPP: c.paiPP });
      }
      void img;
    }
  }

  for (const [chave, { arquivo, paiPP }] of paiPendente) {
    const dono = imagens.find(x => x.arquivo === arquivo);
    if (!dono) { continue; }
    const passo1 = posicao(dono.img, paiPP);
    if (passo1 < 0) { continue; }
    const paiVa = lerPonteiro(dono.img, passo1);
    const pai = dono.crus.get(paiVa);
    if (pai) { porNome.get(chave)!.ancestral = pai.nome; }
  }

  const classes = [...porNome.values()];
  return {
    classes, arquivosLidos: lidos,
    semAncestral: classes.filter(c => !c.ancestral).length,
  };
}

/**
 * Pacotes que valem ler: os de terceiros e os do próprio Delphi.
 *
 * As duas pastas importam, por motivos diferentes. A `Bpl` pública tem o que foi instalado —
 * componentes comerciais e os pacotes do projeto. A `bin` da instalação tem `rtl` e `vcl`, e
 * sem eles metade das classes fica sem ancestral, porque quase tudo herda de lá.
 */
export function pacotesConhecidos(versaoBds: string, bdsBin?: string): string[] {
  const out: string[] = [];
  const pastas = [
    path.join(process.env.PUBLIC ?? 'C:\\Users\\Public',
              'Documents', 'Embarcadero', 'Studio', versaoBds, 'Bpl'),
    ...(bdsBin ? [bdsBin] : []),
  ];
  for (const pasta of pastas) {
    try {
      for (const f of fs.readdirSync(pasta)) {
        if (f.toLowerCase().endsWith('.bpl')) { out.push(path.join(pasta, f)); }
      }
    } catch { /* pasta ausente: segue com as outras */ }
  }
  return out;
}
