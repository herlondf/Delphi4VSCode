/**
 * Ícone e informações de versão do executável — a página "Application"/"Version Info" das
 * opções do projeto.
 *
 * Não passa pelo `brcc32`/`cgrc`. Esses dois só entram quando existe um `.rc` escrito à mão;
 * no caminho normal o MSBuild já compila o recurso a partir do que está no `.dproj`, e o que
 * falta fora da IDE é EDITAR esses valores. São propriedades comuns:
 *
 *   VerInfo_Keys           lista `Chave=valor;` com CompanyName, FileVersion e companhia
 *   VerInfo_MajorVer …     os quatro números que viram o `FILEVERSION` do recurso
 *   VerInfo_IncludeVerInfo se o recurso é gerado
 *   Icon_MainIcon          o `.ico` do executável
 *
 * O `.dproj` repete cada uma por configuração (Base, Win32, Release…). Escrever em todas
 * seria o mais simples e o mais errado: quem separa a versão de Debug e Release faz isso de
 * propósito. Aqui o valor vai para onde já está, e o `Base` é o destino quando não está em
 * lugar nenhum — que é de onde as outras herdam.
 */

export type Chaves = Map<string, string>;

/** `A=1;B=2;` — valor pode ser vazio, e a ordem importa porque a IDE preserva. */
export function lerChaves(bruto: string): Chaves {
  const fora: Chaves = new Map();
  for (const parte of bruto.split(';')) {
    if (!parte) { continue; }
    const i = parte.indexOf('=');
    if (i < 0) { fora.set(parte, ''); } else { fora.set(parte.slice(0, i), parte.slice(i + 1)); }
  }
  return fora;
}

export function escreverChaves(c: Chaves): string {
  return [...c].map(([k, v]) => `${k}=${v}`).join(';');
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Valor de uma propriedade MSBuild, o primeiro que aparecer. */
export function ler(xml: string, prop: string): string | undefined {
  const m = new RegExp(`<${esc(prop)}>([^<]*)</${esc(prop)}>`).exec(xml);
  return m ? m[1] : undefined;
}

/**
 * Troca o valor de uma propriedade em todas as ocorrências, ou cria no grupo `Base`.
 *
 * Todas, e não a primeira: a IDE repete o mesmo valor por configuração, e mudar só a primeira
 * deixaria o Release com a versão antiga — que é justamente o build que vai para o cliente.
 * Vale para propriedade de valor único; `VerInfo_Keys` difere entre configurações e tem que
 * ser tratada uma a uma, por `mapear`.
 */
export function gravar(xml: string, prop: string, valor: string): string {
  const re = new RegExp(`(<${esc(prop)}>)[^<]*(</${esc(prop)}>)`, 'g');
  if (re.test(xml)) { return xml.replace(re, `$1${valor}$2`); }
  // a condição real do grupo Base é `'$(Config)'=='Base' or '$(Base)'!=''`
  const base = /<PropertyGroup Condition="[^"]*\$\(Base\)[^"]*">/.exec(xml);
  if (!base) { return xml; }
  return xml.replace(base[0], `${base[0]}
        <${prop}>${valor}</${prop}>`);
}

/**
 * Reescreve cada ocorrência a partir do valor DELA, não do valor da primeira.
 *
 * É o que impede a perda de dado em `VerInfo_Keys`: num `.dproj` real as configurações têm
 * chaves diferentes — uma traz `FileDescription=$(MSBuildProjectName)`, as outras não — e
 * copiar a primeira por cima das demais apaga a diferença em silêncio. Custou 216 bytes de
 * um projeto de teste para aparecer.
 */
export function mapear(xml: string, prop: string, fn: (atual: string) => string): string {
  const re = new RegExp(`(<${esc(prop)}>)([^<]*)(</${esc(prop)}>)`, 'g');
  return xml.replace(re, (_todo, abre: string, atual: string, fecha: string) =>
    `${abre}${fn(atual)}${fecha}`);
}

export interface Versao {
  major: number;
  minor: number;
  release: number;
  build: number;
}

const CAMPOS: [keyof Versao, string][] = [
  ['major', 'VerInfo_MajorVer'], ['minor', 'VerInfo_MinorVer'],
  ['release', 'VerInfo_Release'], ['build', 'VerInfo_Build'],
];

export function lerVersao(xml: string): Versao {
  const v = { major: 1, minor: 0, release: 0, build: 0 } as Versao;
  for (const [campo, prop] of CAMPOS) {
    const n = Number(ler(xml, prop));
    if (Number.isFinite(n)) { v[campo] = n; }
  }
  return v;
}

export function textoVersao(v: Versao): string {
  return `${v.major}.${v.minor}.${v.release}.${v.build}`;
}

/**
 * Grava os quatro números e mantém `FileVersion`/`ProductVersion` das chaves em sincronia.
 *
 * São dois lugares para a mesma informação, e o Windows mostra os dois: os números viram o
 * `FILEVERSION` binário, que o instalador compara, e as chaves viram o texto da aba Detalhes
 * do Explorer. Deixar os dois divergirem é o defeito clássico de quem edita à mão.
 */
export function gravarVersao(xml: string, v: Versao): string {
  let fora = xml;
  for (const [campo, prop] of CAMPOS) { fora = gravar(fora, prop, String(v[campo])); }
  const texto = textoVersao(v);
  return mapear(fora, 'VerInfo_Keys', atual => {
    const c = lerChaves(atual);
    for (const k of ['FileVersion', 'ProductVersion']) {
      if (c.has(k)) { c.set(k, texto); }
    }
    return escreverChaves(c);
  });
}

export function incrementarBuild(v: Versao): Versao {
  return { ...v, build: v.build + 1 };
}

/** `1.2.3.4` — aceita menos de quatro partes e completa com zero. */
export function analisarVersao(texto: string): Versao | undefined {
  const partes = texto.trim().split('.');
  if (partes.length > 4 || partes.some(p => !/^\d+$/.test(p))) { return undefined; }
  const n = partes.map(Number);
  return { major: n[0] ?? 0, minor: n[1] ?? 0, release: n[2] ?? 0, build: n[3] ?? 0 };
}
