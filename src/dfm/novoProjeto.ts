/**
 * Criar um projeto Delphi do zero: o `.dpr` e o `.dproj`.
 *
 * O `.dpr` é o programa; o `.dproj` é o que o MSBuild e a IDE leem, e é ele que faz o projeto
 * abrir e compilar. Não dá para gerar só o `.dpr`: sem o `.dproj` não há configuração de
 * Debug/Release, plataforma nem search path, e nada do que a extensão já faz funciona.
 *
 * O XML abaixo é o mínimo que o `msbuild` aceita e que a IDE abre sem reclamar — mesma
 * espinha que a IDE gera, sem as dezenas de opções que ela grava com o valor padrão.
 */

import { Arquivo } from './scaffold';

export type TipoProjeto = 'vcl' | 'console' | 'dll' | 'package';

export interface OpcoesProjeto {
  nome: string;
  tipo: TipoProjeto;
  /** Versão do produto no `.dproj` (22.0 = Delphi 11). */
  versaoBds?: string;
  plataformas?: string[];
  /** Form inicial, quando é VCL. */
  form?: { unit: string; classe: string; variavel: string };
}

const CRLF = String.fromCharCode(13, 10);

/**
 * GUID determinístico a partir do nome.
 *
 * A IDE sorteia um; aqui ele sai do nome de propósito, para que gerar o mesmo projeto duas
 * vezes dê o mesmo arquivo e um `git diff` só mostre o que mudou de verdade.
 */
export function guidDe(nome: string): string {
  let h = 0x811c9dc5;
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    for (const c of `${nome}#${i}`) {
      h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    }
    bytes.push(h & 0xff);
  }
  const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
}

function dpr(op: OpcoesProjeto): string {
  const { nome, tipo, form } = op;
  if (tipo === 'package') {
    return [
      `package ${nome};`, '',
      '{$R *.res}', '{$IMPLICITBUILD ON}', '',
      'requires', '  rtl;', '', 'end.', '',
    ].join(CRLF);
  }
  if (tipo === 'console') {
    return [
      `program ${nome};`, '', '{$APPTYPE CONSOLE}', '', '{$R *.res}', '',
      'uses', '  System.SysUtils;', '',
      'begin', '  try', "    WriteLn('Olá, Delphi.');", '  except',
      '    on E: Exception do',
      "      WriteLn(E.ClassName, ': ', E.Message);",
      '  end;', 'end.', '',
    ].join(CRLF);
  }
  if (tipo === 'dll') {
    return [
      `library ${nome};`, '', 'uses', '  System.SysUtils,', '  System.Classes;', '',
      '{$R *.res}', '', 'exports', '  ;', '', 'begin', 'end.', '',
    ].join(CRLF);
  }
  const linhas = [
    `program ${nome};`, '', 'uses', '  Vcl.Forms,',
  ];
  if (form) {
    linhas.push(`  ${form.unit} in '${form.unit}.pas' {${form.variavel}};`);
  } else {
    linhas[linhas.length - 1] = '  Vcl.Forms;';
  }
  linhas.push('', '{$R *.res}', '', 'begin', '  Application.Initialize;',
    '  Application.MainFormOnTaskbar := True;');
  if (form) { linhas.push(`  Application.CreateForm(T${form.classe.slice(1)}, ${form.variavel});`); }
  linhas.push('  Application.Run;', 'end.', '');
  return linhas.join(CRLF);
}

const APP_TYPE: Record<TipoProjeto, string> = {
  vcl: 'Application', console: 'Application', dll: 'Library', package: 'Package',
};
const EXT: Record<TipoProjeto, string> = {
  vcl: '.exe', console: '.exe', dll: '.dll', package: '.bpl',
};

function dproj(op: OpcoesProjeto): string {
  const versao = op.versaoBds ?? '22.0';
  const plataformas = op.plataformas ?? ['Win32', 'Win64'];
  const fonte = op.tipo === 'package' ? `${op.nome}.dpk` : `${op.nome}.dpr`;
  const l: string[] = [];
  const p = (s: string): number => l.push(s);

  p('<?xml version="1.0" encoding="utf-8"?>');
  p('<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">');
  p('  <PropertyGroup>');
  p(`    <ProjectGuid>${guidDe(op.nome)}</ProjectGuid>`);
  p(`    <MainSource>${fonte}</MainSource>`);
  p('    <Base>True</Base>');
  p('    <Config Condition="\'$(Config)\'==\'\'">Debug</Config>');
  p(`    <Platform Condition="'$(Platform)'==''">${plataformas[0]}</Platform>`);
  p(`    <TargetedPlatforms>${plataformas.includes('Win64') ? 3 : 1}</TargetedPlatforms>`);
  p(`    <AppType>${APP_TYPE[op.tipo]}</AppType>`);
  p(`    <ProjectVersion>${versao === '22.0' ? '19.5' : '20.1'}</ProjectVersion>`);
  p('    <FrameworkType>VCL</FrameworkType>');
  p('  </PropertyGroup>');

  // um grupo por config × plataforma é o que faz Debug/Release aparecerem na extensão
  p('  <PropertyGroup Condition="\'$(Base)\'!=\'\'">');
  p('    <DCC_DcuOutput>.\\$(Platform)\\$(Config)</DCC_DcuOutput>');
  p('    <DCC_ExeOutput>.\\$(Platform)\\$(Config)</DCC_ExeOutput>');
  p(`    <DCC_E>false</DCC_E>`);
  p(`    <SanitizedProjectName>${op.nome}</SanitizedProjectName>`);
  if (op.tipo === 'console') { p('    <DCC_ConsoleTarget>true</DCC_ConsoleTarget>'); }
  p('  </PropertyGroup>');
  for (const plat of plataformas) {
    p(`  <PropertyGroup Condition="'$(Base)'!='' and '$(Platform)'=='${plat}'">`);
    p(`    <DCC_Namespace>${plat === 'Win64' ? 'System.Win;Data.Win;Datasnap.Win;Web.Win;' +
      'Soap.Win;Xml.Win;Bde;' : 'System.Win;Data.Win;Datasnap.Win;Web.Win;Soap.Win;Xml.Win;' +
      'Bde;'}Winapi;System;Xml;Data;Datasnap;Web;Soap;Vcl;Vcl.Imaging;Vcl.Touch;` +
      'Vcl.Samples;Vcl.Shell;$(DCC_Namespace)</DCC_Namespace>');
    p(`    <DCC_ExeOutput>.\\${plat}\\$(Config)</DCC_ExeOutput>`);
    p('  </PropertyGroup>');
  }
  p('  <PropertyGroup Condition="\'$(Cfg_1)\'!=\'\'">');
  p('    <DCC_Define>DEBUG;$(DCC_Define)</DCC_Define>');
  p('    <DCC_Optimize>false</DCC_Optimize>');
  p('    <DCC_DebugDCUs>true</DCC_DebugDCUs>');
  p('    <DCC_GenerateStackFrames>true</DCC_GenerateStackFrames>');
  p('  </PropertyGroup>');
  p('  <PropertyGroup Condition="\'$(Cfg_2)\'!=\'\'">');
  p('    <DCC_Define>RELEASE;$(DCC_Define)</DCC_Define>');
  p('    <DCC_DebugInformation>0</DCC_DebugInformation>');
  p('    <DCC_LocalDebugSymbols>false</DCC_LocalDebugSymbols>');
  p('  </PropertyGroup>');
  p('  <PropertyGroup Condition="\'$(Config)\'==\'Debug\'">');
  p('    <Base>true</Base>');
  p('    <Cfg_1>true</Cfg_1>');
  p('  </PropertyGroup>');
  p('  <PropertyGroup Condition="\'$(Config)\'==\'Release\'">');
  p('    <Base>true</Base>');
  p('    <Cfg_2>true</Cfg_2>');
  p('  </PropertyGroup>');

  p('  <ItemGroup>');
  p(`    <DelphiCompile Include="$(MainSource)"><MainSource>MainSource</MainSource></DelphiCompile>`);
  if (op.form) {
    p(`    <DCCReference Include="${op.form.unit}.pas">`);
    p(`      <Form>${op.form.variavel}</Form>`);
    p(`      <FormType>dfm</FormType>`);
    p('    </DCCReference>');
  }
  p('    <BuildConfiguration Include="Debug"><Key>Cfg_1</Key></BuildConfiguration>');
  p('    <BuildConfiguration Include="Release"><Key>Cfg_2</Key></BuildConfiguration>');
  p('  </ItemGroup>');

  p('  <ProjectExtensions>');
  p('    <Borland.Personality>Delphi.Personality.12</Borland.Personality>');
  p('    <Borland.ProjectType>' +
    (op.tipo === 'package' ? 'Package' : 'Application') + '</Borland.ProjectType>');
  p('    <BorlandProject><Delphi.Personality /></BorlandProject>');
  p(`    <ProjectFileVersion>12</ProjectFileVersion>`);
  p('  </ProjectExtensions>');
  p('  <Import Project="$(BDS)\\Bin\\CodeGear.Delphi.Targets" ' +
    'Condition="Exists(\'$(BDS)\\Bin\\CodeGear.Delphi.Targets\')"/>');
  p('  <Import Project="$(APPDATA)\\Embarcadero\\BDS\\' + versao +
    '\\UserTools.proj" Condition="Exists(\'$(APPDATA)\\Embarcadero\\BDS\\' + versao +
    '\\UserTools.proj\')"/>');
  p('</Project>');
  p('');
  return l.join(CRLF);
}

/** Unit sem form: só o esqueleto que o compilador exige. */
export function unitSimples(nome: string): string {
  if (!/^[A-Za-z_]\w*$/.test(nome)) {
    throw new Error('o nome da unit só aceita letras, números e sublinhado, começando por letra');
  }
  return [
    `unit ${nome};`, '', 'interface', '', 'uses', '  System.SysUtils,',
    '  System.Classes;', '', 'type', '', 'implementation', '', 'end.', '',
  ].join(CRLF);
}

/** Os arquivos do projeto, prontos para gravar no diretório escolhido. */
export function novoProjeto(op: OpcoesProjeto): { arquivos: Arquivo[]; alvo: string } {
  if (!/^[A-Za-z_]\w*$/.test(op.nome)) {
    throw new Error('o nome do projeto só aceita letras, números e sublinhado, ' +
      'começando por letra');
  }
  const fonte = op.tipo === 'package' ? `${op.nome}.dpk` : `${op.nome}.dpr`;
  return {
    alvo: `${op.nome}${EXT[op.tipo]}`,
    arquivos: [
      { nome: fonte, conteudo: dpr(op) },
      { nome: `${op.nome}.dproj`, conteudo: dproj(op) },
    ],
  };
}
