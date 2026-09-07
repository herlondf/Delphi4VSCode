import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { expandir, lerProjeto, scriptBuild, scriptProprio } from '../dfm/project';

test('lê configurações e plataformas declaradas no .dproj', () => {
  const tmp = path.join(process.env.TEMP || '/tmp', 'Teste.dproj');
  fs.writeFileSync(tmp, `<?xml version="1.0" encoding="utf-8"?>
<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <Config Condition="'$(Config)'==''">Debug</Config>
    <Platform Condition="'$(Platform)'==''">Win32</Platform>
  </PropertyGroup>
  <PropertyGroup Condition="'$(Config)'=='Release'">
    <DCC_Optimize>true</DCC_Optimize>
  </PropertyGroup>
  <PropertyGroup Condition="'$(Platform)'=='Win64'">
    <DCC_Namespace>Winapi</DCC_Namespace>
  </PropertyGroup>
</Project>`, 'utf8');
  const p = lerProjeto(tmp);
  assert.equal(p.nome, 'Teste.dproj');
  assert.ok(p.configs.includes('Debug') && p.configs.includes('Release'), String(p.configs));
  assert.ok(p.plataformas.includes('Win32') && p.plataformas.includes('Win64'),
    String(p.plataformas));
  fs.unlinkSync(tmp);
});

test('arquivo ilegível ainda devolve padrões utilizáveis', () => {
  const p = lerProjeto('/caminho/que/nao/existe/X.dproj');
  assert.deepEqual(p.configs, ['Debug', 'Release']);
  assert.deepEqual(p.plataformas, ['Win32']);
});

/*
 * Este teste passava enquanto a producao nao funcionava, e a licao vale registrar: os casos
 * dele foram INVENTADOS a partir do formato do dcc32, e o build real vai por MSBuild, que
 * embrulha a linha de outro jeito. Saida capturada de verdade esta em problemmatcher.test.ts.
 */
test('o matcher do dcc32 entende a saida do compilador chamado direto', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const pm = pkg.contributes.problemMatchers.find(
    (m: { name: string }) => m.name === 'delphi4vscode-dcc');
  assert.ok(pm, 'o matcher do dcc precisa continuar existindo');
  const re = new RegExp(pm.pattern[0].regexp);
  const casos: [string, string, string, string, string][] = [
    ['VendaMan.pas(412) Error: E2003 Undeclared identifier: Foo',
     'VendaMan.pas', '412', 'Error', 'Undeclared identifier: Foo'],
    ['Unit1.pas(10) Fatal Error: F1026 File not found: Bar.dcu',
     'Unit1.pas', '10', 'Fatal Error', 'File not found: Bar.dcu'],
    ['Base.pas(88) Warning: W1002 Symbol is deprecated',
     'Base.pas', '88', 'Warning', 'Symbol is deprecated'],
  ];
  for (const [linha, arq, num, sev, msg] of casos) {
    const m = re.exec(linha);
    assert.ok(m, `não casou: ${linha}`);
    assert.equal(m[pm.pattern[0].file], arq);
    assert.equal(m[pm.pattern[0].line], num);
    assert.equal(m[pm.pattern[0].severity], sev);
    assert.equal(m[pm.pattern[0].message], msg);
  }
  // linha comum de progresso não pode virar erro
  assert.equal(re.exec('Build succeeded.'), null);
});

test('os comandos declarados têm implementação registrada', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  // procura em todo o src: o registro pode estar em qualquer módulo
  const dir = path.join(__dirname, '..', '..', 'src');
  const ler = (d: string): string => fs.readdirSync(d, { withFileTypes: true })
    .map(e => e.isDirectory() ? ler(path.join(d, e.name))
      : e.name.endsWith('.ts') ? fs.readFileSync(path.join(d, e.name), 'utf8') : '')
    .join('\n');
  const src = ler(dir);
  const semImpl = pkg.contributes.commands
    .map((c: { command: string }) => c.command)
    .filter((c: string) => !src.includes(`'${c}'`));
  assert.deepEqual(semImpl, [], `comandos sem registerCommand: ${semImpl}`);
});

test('os atalhos apontam para comandos que existem', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const cmds = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
  for (const k of pkg.contributes.keybindings) {
    assert.ok(cmds.has(k.command), `atalho ${k.key} aponta para ${k.command}, que não existe`);
  }
});


/*
 * O Ctrl+F9 do Delphi é "Compile", não "Build". Chamar /t:Build ali passa `-B` ao dcc32 e
 * recompila toda unit que tenha fonte no search path — o que num projeto com cópia própria
 * de unit da VCL quebra com F2051, enquanto o Compile do IDE passa. Foi um bug real; este
 * teste existe para ele não voltar.
 */
test('Ctrl+F9 chama Make e Shift+F9 chama Build', () => {
  const build = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'build.ts'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  const atalho = (k: string): string =>
    pkg.contributes.keybindings.find((x: { key: string }) => x.key === k).command;
  assert.equal(atalho('ctrl+f9'), 'delphi4vscode.build');
  assert.equal(atalho('shift+f9'), 'delphi4vscode.rebuild');

  assert.match(build, /'delphi4vscode\.build',\s*\(\) => mgr\.executar\('Make'\)/,
    'o comando de Ctrl+F9 tem de usar o alvo Make');
  assert.match(build, /'delphi4vscode\.rebuild',\s*\(\) => mgr\.executar\('Build'\)/);
});

test('o script chama o alvo pedido, sem inventar Rebuild', () => {
  for (const alvo of ['Make', 'Build', 'Clean']) {
    const s = scriptBuild('C:\rs.bat', 'C:\p.dproj', alvo, 'Debug', 'Win32');
    assert.ok(s.includes('/t:' + alvo + ' '), s);
  }
});

/*
 * Projeto que carrega a própria toolchain no repositório (compilador, lib da VCL
 * recompilada e EnvOptions versionados) não compila com o rsvars da instalação: os .dcu da
 * VCL oficial não batem com as units que o projeto substitui, e o build morre em F2051.
 * Nesses casos o único build correto é o script que o time mantém.
 */
test('o script do projeto expande os marcadores', () => {
  const linha = expandir('"${projectPath}" ${project} ${target} ${config}/${platform}', {
    target: 'Make', project: 'App',
    projectPath: 'D:\r\app\App.dproj',
    config: 'Debug', platform: 'Win32', workspaceFolder: 'D:\r',
  });
  assert.equal(linha, '"D:\r\app\App.dproj" App Make Debug/Win32');
});

test('o .bat entra no diretório antes de chamar o script', () => {
  const s = scriptProprio('ci\build_debug.bat App', 'D:\Projetos\projeto de teste');
  const linhas = s.split(String.fromCharCode(13, 10));
  assert.equal(linhas[2], 'cd /d "D:\Projetos\projeto de teste"');
  assert.ok(linhas.indexOf('ci\build_debug.bat App') > 2, s);
  assert.ok(s.includes('exit /b %errorlevel%'), 'o erro do script tem de chegar na task');
});

test('marcador desconhecido fica como está, sem virar vazio', () => {
  assert.equal(expandir('a ${naoexiste} b', {
    target: 't', project: 'p', projectPath: 'pp',
    config: 'c', platform: 'x', workspaceFolder: 'w',
  }), 'a ${naoexiste} b');
});
