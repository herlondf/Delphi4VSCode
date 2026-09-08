/**
 * A parte de build que não depende do VS Code: ler o .dproj e achar a instalação do Delphi.
 *
 * Fica separada para poder ser testada fora do editor — `import 'vscode'` só resolve dentro
 * dele, e um módulo que o importa não roda em `node --test`.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ProjetoInfo {
  fsPath: string;
  nome: string;
  /** Configurações e plataformas encontradas no .dproj. */
  configs: string[];
  plataformas: string[];
}

/** Lê do .dproj as configurações e plataformas que ele realmente declara. */
export function lerProjeto(fsPath: string): ProjetoInfo {
  const nome = path.basename(fsPath);
  let xml = '';
  try {
    xml = fs.readFileSync(fsPath, 'utf8');
  } catch {
    return { fsPath, nome, configs: ['Debug', 'Release'], plataformas: ['Win32'] };
  }
  const configs = new Set<string>();
  for (const m of xml.matchAll(/<PropertyGroup Condition="[^"]*'\$\(Config\)'=='(\w+)'/g)) {
    configs.add(m[1]);
  }
  for (const m of xml.matchAll(/<Config Condition="[^"]*">(\w+)<\/Config>/g)) {
    configs.add(m[1]);
  }
  const plataformas = new Set<string>();
  for (const m of xml.matchAll(
    /<Platform[^>]*>(Win32|Win64|Linux64|Android|Android64|OSX64|OSXARM64|iOSDevice64)</g)) {
    plataformas.add(m[1]);
  }
  for (const m of xml.matchAll(/'\$\(Platform\)'=='(\w+)'/g)) {
    plataformas.add(m[1]);
  }
  return {
    fsPath, nome,
    configs: configs.size ? [...configs] : ['Debug', 'Release'],
    plataformas: plataformas.size ? [...plataformas] : ['Win32'],
  };
}

/**
 * Onde está o rsvars.bat.
 *
 * O Delphi compila por MSBuild, mas o msbuild sozinho não sabe achar as units da biblioteca:
 * é o rsvars.bat que exporta BDS, DELPHIVERSION e o caminho de busca. Chamar o msbuild sem
 * ele falha com "unit não encontrada" em units da própria VCL.
 */
export interface InstalacaoBds {
  versao: string;
  rsvars: string;
}

/**
 * Todas as instalações do RAD Studio, da mais nova para a mais antiga.
 *
 * Devolver a lista, e não só a primeira, é deliberado: numa máquina com várias versões
 * instaladas, escolher a maior é chute — e chutar errado compila o projeto com outro
 * compilador, o que aparece como erro de unit incompatível e manda o usuário caçar o
 * problema no lugar errado. Quem escolhe é ele, uma vez, e a escolha fica gravada.
 */
export function instalacoesBds(): InstalacaoBds[] {
  const out: InstalacaoBds[] = [];
  for (const raiz of ['C:/Program Files (x86)/Embarcadero/Studio',
                      'C:/Program Files/Embarcadero/Studio']) {
    let versoes: string[];
    try {
      versoes = fs.readdirSync(raiz).filter(v => /^\d+\.\d+$/.test(v));
    } catch { continue; }
    for (const v of versoes) {
      const alvo = path.join(raiz, v, 'bin', 'rsvars.bat');
      if (fs.existsSync(alvo)) { out.push({ versao: v, rsvars: alvo }); }
    }
  }
  return out.sort((a, b) => parseFloat(b.versao) - parseFloat(a.versao));
}

export function acharRsvars(configurado: string): string | undefined {
  if (configurado) {
    const alvo = configurado.toLowerCase().endsWith('rsvars.bat')
      ? configurado : path.join(configurado, 'rsvars.bat');
    return fs.existsSync(alvo) ? alvo : undefined;
  }
  return instalacoesBds()[0]?.rsvars;
}

/**
 * Conteúdo do .bat que executa o build.
 *
 * Passar `"rsvars.bat" && msbuild "projeto.dproj"` direto para `cmd /c` é frágil: com mais de
 * duas aspas na linha, o cmd remove a primeira e a última antes de executar, e o caminho com
 * espaço vira `C:\Program` — o erro "não é reconhecido como um comando interno". Quem monta a
 * linha final é o VS Code, então não temos controle do quoting.
 *
 * Escrever um .bat e chamá-lo com uma aspa de cada lado cai na regra simples do cmd e não
 * depende de nada disso. De quebra, o `errorlevel` do rsvars deixa de ser engolido pelo `&&`.
 */
const JOIN = String.fromCharCode(13, 10);

/**
 * `alvo` pode ser composto: `Clean;Build` faz o MSBuild limpar e reconstruir numa invocação
 * só, na ordem, que é o "Clean + Build" da IDE. Separar em duas tasks não daria a mesma
 * garantia de ordem.
 */
export function scriptBuild(
  rsvars: string, dproj: string, alvo: string, config: string, plataforma: string,
  verbosidade = 'minimal', extras: Record<string, string> = {},
): string {
  const mais = Object.entries(extras).map(([k, v]) => ` /p:${k}=${v}`).join('');
  return [
    '@echo off',
    'setlocal',
    `call "${rsvars}"`,
    'if errorlevel 1 (echo Falha ao carregar o ambiente do Delphi ^(rsvars.bat^) & exit /b 1)',
    `msbuild "${dproj}" /t:${alvo} /p:Config=${config} /p:Platform=${plataforma}` +
      `${mais} /nologo /v:${verbosidade}`,
    'exit /b %errorlevel%',
  ].join(JOIN) + JOIN;
}

/**
 * `Base` não é uma configuração que se compila: é o bloco de propriedades comuns de onde
 * Debug e Release herdam. Oferecê-la no menu só produz build estranho.
 */
export function configsUteis(configs: string[]): string[] {
  const uteis = configs.filter(c => c.toLowerCase() !== 'base');
  return uteis.length ? uteis : configs;
}

/**
 * Script de build do próprio projeto, quando existe um.
 *
 * Nem todo projeto Delphi compila com o `rsvars.bat` da instalação. Há projeto que carrega
 * a própria toolchain dentro do repositório — compilador, lib da VCL recompilada e
 * `EnvOptions.proj` versionados — e compilar com a instalação da máquina falha com
 * `F2051`, porque os `.dcu` da VCL oficial não batem com as units que o projeto substitui.
 * Nesses casos o único build correto é o script que o time mantém.
 *
 * Os marcadores são expandidos antes de escrever o `.bat`.
 */
export const MARCADORES = ['${target}', '${project}', '${projectPath}', '${config}',
  '${platform}', '${workspaceFolder}'] as const;

export function expandir(
  texto: string,
  v: { target: string; project: string; projectPath: string;
       config: string; platform: string; workspaceFolder: string },
): string {
  return texto
    .replace(/\$\{target\}/g, v.target)
    .replace(/\$\{project\}/g, v.project)
    .replace(/\$\{projectPath\}/g, v.projectPath)
    .replace(/\$\{config\}/g, v.config)
    .replace(/\$\{platform\}/g, v.platform)
    .replace(/\$\{workspaceFolder\}/g, v.workspaceFolder);
}

/**
 * `.bat` que roda o script do projeto. O `cd /d` vem antes porque esses scripts quase sempre
 * dependem do diretório corrente — o do projeto de teste monta `%cd%\app-desktop` para achar a
 * própria toolchain.
 */
export function scriptProprio(linha: string, cwd: string): string {
  return [
    '@echo off',
    'setlocal',
    `cd /d "${cwd}"`,
    'if errorlevel 1 (echo Nao consegui entrar em %cd% & exit /b 1)',
    linha,
    'exit /b %errorlevel%',
  ].join(JOIN) + JOIN;
}

/** Scripts de build que valem oferecer quando o projeto tem um. */
export const CANDIDATOS = [
  'ci/build_debug.bat', 'ci/build.bat', 'build.bat', 'build.cmd', 'ci/build.cmd',
];

/**
 * O caminho do .bat, sem aspas.
 *
 * Quem executa é que faz o quoting: o VS Code com `ShellQuoting.Strong`, o Node ao montar a
 * linha do processo. Adicionar aspas aqui faz o argumento chegar escapado como `\"caminho\"`,
 * com barras invertidas literais, e o cmd não encontra o arquivo.
 */
export function comandoBuild(batPath: string): string {
  return batPath;
}
