/**
 * De onde sai a lista de pastas a indexar.
 *
 * Pedir isso ao usuário em `delphi4vscode.sourcePaths` funciona, mas é a pergunta errada: a
 * informação já existe em dois lugares que o Delphi mantém sozinho —
 *
 *   1. o `.dproj` do projeto ativo, em `DCC_UnitSearchPath`, com os vendors e os módulos;
 *   2. o `EnvOptions.proj` do usuário (`%APPDATA%\Embarcadero\BDS\<versão>`), que o IDE
 *      regrava a cada mudança de Library/Browsing Path;
 *
 * mais o `source` da própria instalação, que traz VCL, RTL e FMX.
 *
 * Aqui elas são juntadas, com as variáveis do MSBuild resolvidas, e filtradas pelo que
 * existe em disco e tem `.pas` — indexar uma pasta só de `.dcu` custa tempo e não acrescenta
 * nada, porque o índice se alimenta de declaração de classe.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Fonte {
  dir: string;
  /** De onde veio — aparece no relatório do comando de reindexar. */
  origem: 'projeto' | 'library' | 'browsing' | 'instalacao' | 'workspace' | 'configurado';
}

/** Variáveis que o Delphi usa nos caminhos, resolvidas para esta instalação. */
export interface Ambiente {
  BDS: string;
  BDSLIB: string;
  BDSCOMMONDIR: string;
  BDSUSERDIR: string;
  Platform: string;
  Config: string;
}

const VAR = /\$\(([A-Za-z_][\w]*)\)/g;

export function expandirVars(texto: string, amb: Partial<Ambiente>): string {
  let anterior = '';
  let atual = texto;
  // uma variável pode expandir para outra ($(BDSLIB) contém $(BDS)); para quando estabiliza
  for (let i = 0; i < 4 && atual !== anterior; i++) {
    anterior = atual;
    atual = atual.replace(VAR, (todo, nome) => {
      // o Delphi escreve $(Platform) e $(PLATFORM) na mesma lista: casar sem ligar para caixa
      const chave = Object.keys(amb).find(k => k.toLowerCase() === nome.toLowerCase());
      const v = chave ? (amb as Record<string, string | undefined>)[chave] : undefined;
      return v ?? todo;
    });
  }
  return atual;
}

export function ambienteDe(bdsBin: string, plataforma = 'Win32'): Ambiente {
  const bds = bdsBin ? path.dirname(bdsBin.replace(/[\\/]rsvars\.bat$/i, '')) : '';
  const docs = path.join(process.env.USERPROFILE ?? '', 'Documents', 'Embarcadero', 'Studio');
  return {
    BDS: bds,
    BDSLIB: bds ? path.join(bds, 'lib') : '',
    BDSCOMMONDIR: path.join(process.env.PUBLIC ?? 'C:\\Users\\Public',
                            'Documents', 'Embarcadero', 'Studio'),
    BDSUSERDIR: docs,
    Platform: plataforma,
    Config: 'release',
  };
}

/** Caminhos declarados numa tag do EnvOptions.proj ou de um .dproj. */
function lerLista(xml: string, tag: string): string[] {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) { return []; }
  return m[1].split(';').map(s => s.trim()).filter(Boolean);
}

/** O `EnvOptions.proj` do usuário: é o que o IDE grava quando se mexe no Library Path. */
export function envOptions(versao: string): string | undefined {
  const alvo = path.join(process.env.APPDATA ?? '', 'Embarcadero', 'BDS', versao,
                         'EnvOptions.proj');
  return fs.existsSync(alvo) ? alvo : undefined;
}

/** Uma pasta só interessa se existir e tiver `.pas` — direto ou num nível abaixo. */
export function temFontes(dir: string, profundidade = 2): boolean {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  const subs: string[] = [];
  for (const e of entradas) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.pas')) { return true; }
    if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('__')) {
      subs.push(path.join(dir, e.name));
    }
  }
  if (profundidade <= 0) { return false; }
  return subs.slice(0, 40).some(s => temFontes(s, profundidade - 1));
}

export interface Descoberta {
  fontes: Fonte[];
  /** O que foi visto mas descartado, e por quê — o comando de reindexar mostra. */
  ignorados: { dir: string; motivo: string }[];
}

/**
 * Junta tudo, na ordem em que o compilador olharia: o projeto primeiro (é o que manda), a
 * instalação depois, e o Library/Browsing por último.
 */
export function descobrirFontes(opcoes: {
  dproj?: string;
  bdsBin?: string;
  versaoBds?: string;
  plataforma?: string;
  workspace?: string[];
  configurados?: string[];
}): Descoberta {
  const fontes: Fonte[] = [];
  const ignorados: { dir: string; motivo: string }[] = [];
  const vistos = new Set<string>();
  const amb = ambienteDe(opcoes.bdsBin ?? '', opcoes.plataforma);

  const juntar = (bruto: string, origem: Fonte['origem'], base: string): void => {
    const expandido = expandirVars(bruto, amb);
    if (VAR.test(expandido)) {
      VAR.lastIndex = 0;
      ignorados.push({ dir: bruto, motivo: 'variável não resolvida' });
      return;
    }
    const dir = path.resolve(base, expandido);
    const chave = dir.toLowerCase();
    if (vistos.has(chave)) { return; }
    vistos.add(chave);
    if (!fs.existsSync(dir)) { ignorados.push({ dir, motivo: 'não existe' }); return; }
    if (!temFontes(dir)) { ignorados.push({ dir, motivo: 'sem .pas' }); return; }
    fontes.push({ dir, origem });
  };

  // configuração manual, quando existe, vem antes de tudo — é decisão explícita do usuário
  for (const c of opcoes.configurados ?? []) {
    juntar(c, 'configurado', opcoes.workspace?.[0] ?? process.cwd());
  }

  if (opcoes.dproj && fs.existsSync(opcoes.dproj)) {
    let xml = '';
    try { xml = fs.readFileSync(opcoes.dproj, 'utf8'); } catch { /* segue sem */ }
    const base = path.dirname(opcoes.dproj);
    for (const p of lerLista(xml, 'DCC_UnitSearchPath')) { juntar(p, 'projeto', base); }
    juntar('.', 'projeto', base);
  }

  if (amb.BDS) {
    for (const sub of ['source', 'source\\rtl', 'source\\vcl', 'source\\fmx']) {
      juntar(path.join(amb.BDS, sub), 'instalacao', amb.BDS);
    }
  }

  const env = opcoes.versaoBds ? envOptions(opcoes.versaoBds) : undefined;
  if (env) {
    let xml = '';
    try { xml = fs.readFileSync(env, 'utf8'); } catch { /* segue sem */ }
    // o Browsing Path é onde o IDE procura FONTE; o Library, onde procura .dcu
    for (const p of lerLista(xml, 'DelphiBrowsingPath')) { juntar(p, 'browsing', amb.BDS); }
    for (const p of lerLista(xml, 'DelphiLibraryPath')) { juntar(p, 'library', amb.BDS); }
  }

  for (const w of opcoes.workspace ?? []) { juntar(w, 'workspace', w); }
  return { fontes: semSubpastas(fontes, ignorados), ignorados };
}

/**
 * Tira as pastas contidas em outras já listadas.
 *
 * A varredura é recursiva: manter `vendor\jcl\product` e `vendor\jcl\product\common` na
 * mesma lista lê a segunda duas vezes. Num projeto grande isso foi metade do tempo de
 * indexação.
 */
export function semSubpastas(
  fontes: Fonte[], ignorados?: { dir: string; motivo: string }[],
): Fonte[] {
  const ordenadas = [...fontes].sort((a, b) => a.dir.length - b.dir.length);
  const mantidas: Fonte[] = [];
  for (const f of ordenadas) {
    const baixo = f.dir.toLowerCase();
    const pai = mantidas.find(m => baixo.startsWith(m.dir.toLowerCase() + path.sep));
    if (pai) {
      ignorados?.push({ dir: f.dir, motivo: `já coberta por ${pai.dir}` });
      continue;
    }
    mantidas.push(f);
  }
  // devolve na ordem original, que é a de prioridade
  return fontes.filter(f => mantidas.includes(f));
}
