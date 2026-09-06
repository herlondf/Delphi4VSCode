/**
 * Gera o `<projeto>.delphilsp.json` que o `DelphiLSP.exe` exige.
 *
 * Esse arquivo é normalmente escrito pela IDE ao abrir o projeto, e é a única coisa entre nós
 * e o Code Insight do compilador. Tudo o que ele pede sai de onde já sabemos ler: o `.dproj`
 * (search path, namespaces, defines, saída), o `.dpr` (a lista de units) e o `EnvOptions.proj`
 * da instalação (Library e Browsing Path). Nenhuma passagem pela IDE.
 *
 * O formato foi conferido em duas fontes que batem entre si: o RTTI do próprio
 * `DelphiLSP.exe` (record `TDelphiLSPConfiguration`) e arquivos gerados pela IDE publicados
 * em repositórios públicos. Chaves em minúscula, caminhos como URI `file://`, e o
 * `dccOptions` numa string só — a linha de comando do `dcc`, não uma lista.
 */

import * as fs from 'fs';
import * as path from 'path';
import { expandirVars, ambienteDe, envOptions } from '../dfm/sources';

export interface ConfigLsp {
  settings: {
    project: string;
    dllname: string;
    dccOptions: string;
    projectFiles: { name: string; file: string }[];
    browsingPaths: string[];
    includeDCUsInUsesCompletion: boolean;
    enableKeyWordCompletion: boolean;
    CommonAppData: string;
    Templates: string;
  };
}

export interface OpcoesLsp {
  dproj: string;
  bdsBin: string;
  versaoBds: string;
  plataforma?: string;
  config?: string;
}

/** Caminho para URI `file://`, com cada segmento escapado como a IDE escreve. */
export function paraUri(p: string): string {
  const abs = path.resolve(p).split(path.sep).join('/');
  return 'file:///' + abs.split('/').map(encodeURIComponent).join('/');
}

/**
 * Nome da DLL do compilador para a plataforma.
 *
 * O sufixo é a versão do produto sem o ponto: Delphi 11 (22.0) usa `280`, 12 (23.0) usa `290`.
 * Errar aqui não dá erro visível — o servidor sobe, não compila nada e devolve `null` em tudo.
 */
export function dllDoCompilador(bdsBin: string, plataforma: string): string {
  const base = /64/.test(plataforma) ? 'dcc64' : 'dcc32';
  let sufixo = '';
  try {
    const achado = fs.readdirSync(bdsBin)
      .map(n => new RegExp(`^${base}(\\d+)\\.dll$`, 'i').exec(n))
      .find(Boolean);
    if (achado) { sufixo = achado[1]; }
  } catch { /* sem a pasta, cai no nome sem sufixo e o servidor reclama */ }
  return `${base}${sufixo}.dll`;
}

function lerTag(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) { out.push(...m[1].split(';')); }
  return out;
}

/** Expande as variáveis, resolve contra `raiz` e descarta o que não é pasta existente. */
function pastas(brutos: string[], raiz: string, amb: Record<string, string>): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const bruto of brutos) {
    const expandido = expandirVars(String(bruto).trim(), amb);
    if (!expandido || /\$\(/.test(expandido)) { continue; }
    const dir = path.resolve(raiz, expandido);
    const chave = dir.toLowerCase();
    if (vistos.has(chave)) { continue; }
    vistos.add(chave);
    try {
      if (fs.statSync(dir).isDirectory()) { out.push(dir); }
    } catch { /* caminho morto no .dproj é comum e não é erro nosso */ }
  }
  return out;
}

const citar = (p: string): string => (/\s/.test(p) ? `"${p}"` : p);
const juntar = (ps: string[]): string => ps.map(citar).join(';');

/** As units listadas no `uses` do `.dpr`, que é o que o LSP chama de `projectFiles`. */
export function unitsDoDpr(dpr: string, base: string): { name: string; file: string }[] {
  let src = '';
  try { src = fs.readFileSync(dpr, 'latin1'); } catch { return []; }
  const re = /^\s*([\w.]+)\s+in\s+'([^']+)'/gm;
  const out: { name: string; file: string }[] = [];
  const vistos = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const arquivo = path.resolve(base, m[2]);
    const chave = arquivo.toLowerCase();
    if (vistos.has(chave) || !fs.existsSync(arquivo)) { continue; }
    vistos.add(chave);
    out.push({ name: m[1], file: paraUri(arquivo) });
  }
  return out;
}

export function montarConfig(op: OpcoesLsp): ConfigLsp {
  const plataforma = op.plataforma ?? 'Win32';
  const config = op.config ?? 'Debug';
  const amb = ambienteDe(op.bdsBin, plataforma) as unknown as Record<string, string>;
  const bds = amb.BDS ?? path.dirname(op.bdsBin);
  const base = path.dirname(op.dproj);

  let dproj = '';
  try { dproj = fs.readFileSync(op.dproj, 'utf8'); } catch { /* segue com o que der */ }
  let env = '';
  const arqEnv = envOptions(op.versaoBds);
  if (arqEnv) {
    try { env = fs.readFileSync(arqEnv, 'utf8'); } catch { /* idem */ }
  }

  /*
   * A ordem importa e é a mesma que o `dcc` usa: as DCUs da instalação primeiro (é contra
   * elas que o compilador resolve a RTL), depois o projeto, depois o Library Path.
   */
  const libs = pastas([
    path.join(bds, 'lib', plataforma.toLowerCase(), config.toLowerCase()),
    path.join(bds, 'lib', plataforma.toLowerCase(), 'release'),
  ], bds, amb);
  const unitPaths = [
    ...libs,
    ...pastas(lerTag(dproj, 'DCC_UnitSearchPath'), base, amb),
    ...pastas(lerTag(env, 'DelphiLibraryPath'), bds, amb),
    base,
  ];
  const browsing = pastas(lerTag(env, 'DelphiBrowsingPath'), bds, amb);
  const includes = pastas(lerTag(dproj, 'DCC_IncludePath'), base, amb);
  const ns = lerTag(dproj, 'DCC_Namespace').map(s => s.trim())
    .filter(s => s && !/\$\(/.test(s));
  const defines = lerTag(dproj, 'DCC_Define').map(s => s.trim())
    .filter(s => s && !/\$\(/.test(s));

  const dcuOut = pastas(lerTag(dproj, 'DCC_DcuOutput'), base, amb)[0]
    ?? path.join(base, plataforma, config);
  const exeOut = pastas(lerTag(dproj, 'DCC_ExeOutput'), base, amb)[0] ?? dcuOut;
  // Bpl e Dcp públicos: sem eles o compilador não acha o .dcp dos pacotes de terceiros
  const publico = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public',
    'Documents', 'Embarcadero', 'Studio', op.versaoBds);
  const bpl = path.join(publico, 'Bpl', plataforma);
  const dcp = path.join(publico, 'Dcp', plataforma);

  const dcc = [
    '--no-config', '-Q', '-TX.exe',
    `-E${exeOut}`, `-NU${dcuOut}`, `-NO${dcuOut}`,
    `-LE${bpl}`, `-LN${dcp}`, `-NB${dcp}`,
    `-D${[...defines, config.toUpperCase(), 'FRAMEWORK_VCL'].join(';')}`,
    `-I${juntar([...includes, ...unitPaths])}`,
    `-NS${ns.join(';')};`,
    `-O${juntar(unitPaths)}`,
    `-R${juntar(unitPaths)}`,
    `-U${juntar([...unitPaths, dcp])}`,
    '-V', '-VN', '-VR', '-LU',
  ].join(' ');

  const dpr = op.dproj.replace(/\.dproj$/i, '.dpr');
  return { settings: {
    project: paraUri(dpr),
    dllname: dllDoCompilador(op.bdsBin, plataforma),
    dccOptions: dcc,
    projectFiles: unitsDoDpr(dpr, base),
    browsingPaths: browsing.map(paraUri),
    includeDCUsInUsesCompletion: true,
    enableKeyWordCompletion: true,
    CommonAppData: paraUri(path.join(
      process.env.APPDATA ?? '', 'Embarcadero', 'BDS', op.versaoBds)) + '/',
    Templates: paraUri(path.join(bds, 'ObjRepos')) + '/',
  } };
}

/**
 * Grava o arquivo ao lado do `.dproj` e devolve o caminho.
 *
 * Fica ao lado por exigência do servidor, não por escolha — é onde o cliente oficial procura
 * (`**\/*.delphilsp.json`). Só reescreve quando o conteúdo muda: o `didChangeConfiguration`
 * faz o servidor recompilar o projeto inteiro, e regravar igual a cada ativação custaria isso
 * à toa.
 */
export function gravarConfig(op: OpcoesLsp): { arquivo: string; mudou: boolean } {
  const arquivo = op.dproj.replace(/\.dproj$/i, '.delphilsp.json');
  const texto = JSON.stringify(montarConfig(op), null, 2);
  let antes = '';
  try { antes = fs.readFileSync(arquivo, 'utf8'); } catch { /* primeiro uso */ }
  if (antes === texto) { return { arquivo, mudou: false }; }
  fs.writeFileSync(arquivo, texto, 'utf8');
  return { arquivo, mudou: true };
}
