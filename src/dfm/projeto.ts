/**
 * Bloco E — o que está quebrado no projeto, e o que ele contém.
 *
 * São checagens que a IDE só revela quando alguém tenta compilar ou abrir a tela: unit
 * listada no `.dpr` cujo arquivo sumiu, `.pas` que declara `{$R *.dfm}` sem o `.dfm` ao
 * lado, `.dfm` sem par. Todas saem de leitura de arquivo — nada aqui compila nada.
 */

import * as fs from 'fs';
import * as path from 'path';

export type Gravidade = 'erro' | 'aviso';

export interface Achado {
  gravidade: Gravidade;
  /** Arquivo onde o problema aparece. */
  arquivo: string;
  /** Linha 0-based, quando faz sentido apontar uma. */
  linha?: number;
  mensagem: string;
}

const USES_DPR = /\b([A-Za-z_][\w.]*)\s+in\s+'([^']+)'/g;
const TEM_DFM = /\{\$R\s*\*\.(dfm|fmx)\}/i;
/** Só a primeira declaração do arquivo: é ela que diz o que o form é. */
const RAIZ_DFM = /^(?:object|inherited|inline)\s+[\w.]*\s*:\s*([\w.]+)/i;

/** As units declaradas no `.dpr`, com o caminho relativo que ele aponta. */
export function unitsDoDpr(texto: string): { unit: string; arquivo: string; linha: number }[] {
  const out: { unit: string; arquivo: string; linha: number }[] = [];
  const linhas = texto.split(/\r?\n/);
  linhas.forEach((l, i) => {
    USES_DPR.lastIndex = 0;
    for (const m of l.matchAll(USES_DPR)) {
      out.push({ unit: m[1], arquivo: m[2], linha: i });
    }
  });
  return out;
}

/**
 * E02 — o par `.pas`/`.dfm` e o que o `.dpr` promete.
 *
 * A checagem do `.dfm` órfão só vale dentro das pastas que o projeto realmente usa: um
 * `.dfm` solto numa pasta de vendor não é problema de ninguém.
 */
export function verificarProjeto(dprPath: string): Achado[] {
  const out: Achado[] = [];
  if (!fs.existsSync(dprPath)) {
    return [{ gravidade: 'erro', arquivo: dprPath, mensagem: 'o .dpr não existe' }];
  }
  let texto: string;
  try {
    texto = fs.readFileSync(dprPath, 'latin1');
  } catch (err) {
    return [{ gravidade: 'erro', arquivo: dprPath,
              mensagem: `não consegui ler: ${err instanceof Error ? err.message : err}` }];
  }
  const base = path.dirname(dprPath);
  const vistas = new Map<string, number>();

  for (const u of unitsDoDpr(texto)) {
    const alvo = path.resolve(base, u.arquivo);
    if (!fs.existsSync(alvo)) {
      out.push({
        gravidade: 'erro', arquivo: dprPath, linha: u.linha,
        mensagem: `${u.unit} aponta para ${u.arquivo}, que não existe`,
      });
      continue;
    }
    const anterior = vistas.get(u.unit.toLowerCase());
    if (anterior !== undefined) {
      out.push({
        gravidade: 'erro', arquivo: dprPath, linha: u.linha,
        mensagem: `${u.unit} aparece duas vezes no uses (a outra na linha ${anterior + 1})`,
      });
    }
    vistas.set(u.unit.toLowerCase(), u.linha);

    let pas: string;
    try {
      pas = fs.readFileSync(alvo, 'latin1');
    } catch {
      continue;
    }
    // `{$R *.dfm}` é o que liga o form ao código: sem o arquivo, a tela não carrega
    if (TEM_DFM.test(pas)) {
      const dfm = alvo.replace(/\.pas$/i, '.dfm');
      const fmx = alvo.replace(/\.pas$/i, '.fmx');
      if (!fs.existsSync(dfm) && !fs.existsSync(fmx)) {
        out.push({
          gravidade: 'erro', arquivo: alvo,
          mensagem: `declara {$R *.dfm} mas não há ${path.basename(dfm)} ao lado`,
        });
      }
    }
    const nomeArquivo = path.basename(alvo).replace(/\.pas$/i, '');
    const m = /^\s*unit\s+([\w.]+)/im.exec(pas);
    if (m && m[1].toLowerCase() !== nomeArquivo.toLowerCase()) {
      out.push({
        gravidade: 'erro', arquivo: alvo,
        mensagem: `a unit se declara ${m[1]} mas o arquivo é ${nomeArquivo}.pas`,
      });
    }
  }
  return out;
}

/** `.dfm` sem `.pas` ao lado, dentro das pastas do próprio projeto. */
export function dfmOrfaos(pastas: string[]): Achado[] {
  const out: Achado[] = [];
  const anda = (dir: string, nivel: number): void => {
    if (nivel > 6) { return; }
    let e: fs.Dirent[];
    try {
      e = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const x of e) {
      const f = path.join(dir, x.name);
      if (x.isDirectory()) {
        if (!/^(\.|__)/.test(x.name) && !/^(bin|dcu|vendor|node_modules)$/i.test(x.name)) {
          anda(f, nivel + 1);
        }
        continue;
      }
      if (!/\.(dfm|fmx)$/i.test(x.name)) { continue; }
      const pas = f.replace(/\.(dfm|fmx)$/i, '.pas');
      if (!fs.existsSync(pas)) {
        out.push({
          gravidade: 'aviso', arquivo: f,
          mensagem: 'form sem .pas ao lado: não é carregado por nenhuma unit',
        });
      }
    }
  };
  for (const p of pastas) { anda(p, 0); }
  return out;
}

/**
 * Onde o executável foi parar.
 *
 * O `.dproj` diz em `DCC_ExeOutput`, e o caminho é relativo a ele. Sem a tag, o Delphi grava
 * ao lado do `.dpr`.
 */
export function exeDoProjeto(dprojPath: string): string | undefined {
  let xml = '';
  try {
    xml = fs.readFileSync(dprojPath, 'utf8');
  } catch {
    return undefined;
  }
  const base = path.dirname(dprojPath);
  const nome = path.basename(dprojPath).replace(/\.dproj$/i, '');
  const m = /<DCC_ExeOutput[^>]*>([^<]*)<\/DCC_ExeOutput>/.exec(xml);
  const saida = m ? path.resolve(base, m[1].trim()) : base;
  const alvo = path.join(saida, `${nome}.exe`);
  return fs.existsSync(alvo) ? alvo : undefined;
}

export interface Resumo {
  projeto: string;
  units: number;
  forms: number;
  dataModules: number;
  frames: number;
  /** Componentes por classe, do mais usado para o menos. */
  componentes: [string, number][];
  totalComponentes: number;
}

/** E03 — o que o projeto tem, contado a partir do `.dpr` e dos `.dfm` das units dele. */
export function resumoDoProjeto(
  dprPath: string, ehDataModule: (cls: string) => boolean,
  ehFrame: (cls: string) => boolean,
): Resumo | undefined {
  if (!fs.existsSync(dprPath)) { return undefined; }
  let texto: string;
  try {
    texto = fs.readFileSync(dprPath, 'latin1');
  } catch {
    return undefined;
  }
  const base = path.dirname(dprPath);
  const contagem = new Map<string, number>();
  let forms = 0;
  let dms = 0;
  let frames = 0;
  let total = 0;
  const units = unitsDoDpr(texto);
  // unit listada duas vezes no .dpr é erro (a verificação aponta), mas contar o form dela
  // duas vezes no resumo seria só ruído
  const jaVistos = new Set<string>();

  for (const u of units) {
    const dfm = path.resolve(base, u.arquivo).replace(/\.pas$/i, '.dfm');
    if (!fs.existsSync(dfm)) { continue; }
    if (jaVistos.has(dfm.toLowerCase())) { continue; }
    jaVistos.add(dfm.toLowerCase());
    let conteudo: string;
    try {
      conteudo = fs.readFileSync(dfm, 'latin1');
    } catch {
      continue;
    }
    /*
     * A raiz é a primeira declaração do arquivo, e só ela.
     *
     * Um regex multilinha aqui pegava o primeiro `object` que casasse — e como o `.dfm`
     * começa com BOM, a linha 1 não casava e o resultado vinha de um filho indentado. Daí
     * o resumo contar `TdxLayoutControl` como classe de form.
     */
    // tira BOM em qualquer codificação: o arquivo pode chegar como UTF-8 ou relido em latin1
    const raiz = RAIZ_DFM.exec(conteudo.replace(/^[^A-Za-z]+/, ''));
    if (raiz) {
      if (ehDataModule(raiz[1])) { dms++; }
      else if (ehFrame(raiz[1])) { frames++; }
      else { forms++; }
    }
    for (const m of conteudo.matchAll(/^\s*(?:object|inherited|inline)\s+[\w.]*\s*:\s*([\w.]+)/gm)) {
      contagem.set(m[1], (contagem.get(m[1]) ?? 0) + 1);
      total++;
    }
  }
  return {
    projeto: path.basename(dprPath),
    units: units.length, forms, dataModules: dms, frames,
    componentes: [...contagem].sort((a, b) => b[1] - a[1]),
    totalComponentes: total,
  };
}
