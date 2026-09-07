# Delphi4VSCode — roadmap

Objetivo: escrever, desenhar, compilar e rodar Delphi sem abrir a IDE.

O nome muda porque o escopo mudou. `dfmview` nasceu para ver `.dfm`; hoje já compila, indexa
componentes, lê BPLs, edita forms e navega código. O que falta é a parte de *codificar*.

---

## 1. A descoberta que reorganiza o plano

A instalação do Delphi traz três executáveis de linha de comando que rodam **sem a IDE**, e
os três estavam fora do radar. Todos foram testados nesta máquina (Delphi 11 / 22.0):

| Executável | O que é | Estado |
|---|---|---|
| `bin\DelphiLSP.exe` | O servidor de Code Insight da Embarcadero. Fala LSP puro por stdio. | Testado — ver abaixo |
| `bin\Formatter.exe` | O formatador da IDE, com o `Formatter.config` do próprio usuário. | Testado, funciona |
| `bin\convert.exe` | Conversor `.dfm` binário ↔ texto. | Não testado (já temos o nosso) |

### 1.1 DelphiLSP — o que foi verificado

O servidor anuncia estas capacidades no `initialize`:

```
definitionProvider  declarationProvider  implementationProvider
documentSymbolProvider  hoverProvider
completionProvider (trigger ".", resolveProvider)
signatureHelpProvider (trigger "(", ",", "<")
publishDiagnostics
```

Ele exige um arquivo `<projeto>.delphilsp.json`, que **a IDE normalmente gera**. O contrato
foi recuperado de duas fontes independentes e bate:

- o RTTI do próprio `DelphiLSP.exe` (record `TDelphiLSPConfiguration`);
- arquivos reais publicados em repositórios públicos.

Formato:

```json
{ "settings": {
    "project": "file:///.../Projeto.dpr",
    "dllname": "dcc32280.dll",
    "dccOptions": "--no-config -Q -TX.exe -D... -I... -NS... -U... -LE... -LN...",
    "projectFiles": [ { "name": "UnitX", "file": "file:///.../UnitX.pas" } ],
    "browsingPaths": [ "file:///..." ],
    "includeDCUsInUsesCompletion": true,
    "enableKeyWordCompletion": true,
    "CommonAppData": "file:///.../AppData/Roaming/Embarcadero/BDS/22.0/",
    "Templates": "file:///.../ObjRepos/"
} }
```

Tudo aí sai do `.dproj` (`DCC_UnitSearchPath`, `DCC_Namespace`, `DCC_Define`,
`DCC_DcuOutput`), do `.dpr` (a lista de units) e do `EnvOptions.proj` (Library e Browsing
Path) — que é exatamente o que `src/dfm/sources.ts` já lê hoje. **Nenhuma passagem pela IDE.**

Gerando esse arquivo e falando o protocolo do cliente oficial
(`-LogModes N -LSPLogging <pasta>`, `initializationOptions: {serverType, agentCount}`,
`workspace/didChangeConfiguration` com `{settings:{settingsFile:<uri>}}`), foi confirmado no
`CadastroView.pas` do projeto de teste:

- ✅ **Error Insight real** — diagnósticos com código do compilador (`E2003`, `E2029`) e
  posição exata. Com o arquivo íntegro: **0 erros**. Com o texto corrompido de propósito
  (BOM lido como Latin-1): **71 erros**, todos verdadeiros.
- ✅ **Ctrl+clique em unit do `uses`** — `Winapi.Windows` → `Winapi.Windows.pas:37`.
  É literalmente o pedido, resolvido pelo compilador e não por busca de nome.
- ✅ **`documentSymbol`** — outline completo da unit com os membros da classe.
- ✅ **`completion` e `hover`** funcionam. Numa unit com `uses System.SysUtils, System.Classes`,
  completar depois de um `TStringList` devolve **108 membros reais** (`Add`, `AddObject`,
  `AddStrings`…) e o hover mostra
  `function TStringList.Add(const S: string): Integer` com link para
  `System.Classes.pas:7483`.
- ✅ **O compilador resolve símbolos de verdade.** Plantando um identificador inexistente num
  método, o servidor devolve exatamente 1 diagnóstico. Não é só análise sintática.
- ✅ **Completion no código real do projeto de teste.** Em `CadastroView.pas`, `Dados.`
  devolve os 7 campos de `TDadosCadastro` (`ItemID`, `RegistroID`, `Valor`, `Emissao`,
  `Descricao`, `Centro`, `GerarLancamento`) — um record declarado em **outra** unit do
  projeto — e o hover leva a `BaseDadosClient.pas:121`.

### 1.2 O detalhe que custou a investigação inteira: `-LU`

Com `-LU` sem lista de pacotes — ou sem `-LU` —, o servidor sobe, o compilador **roda**, o
Error Insight funciona e o Ctrl+clique funciona. Só o completar devolve `null`, e só em
arquivo que use uma unit `Vcl.*`, com `Kibitz result: kkError` no log.

Como foi achado, por bissecção sobre as 41 units do `uses` de um form real:

| Caso | Itens completados |
|---|---|
| 5 units de `System`/`Winapi` | 108 |
| \+ `Vcl.Graphics` | 0 |
| `Vcl.Controls` sozinha, `Vcl.Forms` sozinha | 0 |
| `System.UITypes`, `Winapi.Windows`, `System.SysUtils` sozinhas | 108 |
| `Vcl.Graphics` com `-LUrtl;vcl` | **108** |

Hipóteses testadas e descartadas antes de chegar lá: defines contraditórios (`RELEASE` e
`DEBUG` juntos, que o `.dproj` do projeto de teste de fato define), `-O`/`-R`, o Browsing Path dentro do
`-U`, os caminhos de saída e de pacotes (`-NU`, `-E`, `-LE`, `-LN`, `-NB`), só a pasta de
DCUs debug, só a de release, `--no-config`, `-Q`, `-TX.exe` e `-V -VN -VR`.

A lista sai do `DCC_UsePackage` do `.dproj` (199 pacotes no App), com `rtl` e `vcl`
somados sempre: projeto que não usa pacotes em runtime não declara nenhum, e o kibitz ainda
assim precisa saber de onde vêm os símbolos da VCL.

> Erro meu que atrasou isto: a primeira bissecção calculou a linha do alvo no *array* antes de
> juntar o bloco `uses` multi-linha, e acusou `Winapi.Messages`. O índice no array só coincide
> com a linha real quando há uma unit só.

> Detalhe que custou uma hora e vale registrar: o arquivo precisa ir para o servidor **sem
> BOM**. Lido como Latin-1, o `EF BB BF` vira três caracteres e o compilador não reconhece
> mais a palavra `unit` — o resultado é uma cascata de 71 erros que parecem de configuração.

### 1.2 O que o DelphiLSP **não** dá

Não estão na lista de capacidades, e portanto continuam sendo nossos:

- `references` (achar usos) — o índice atual já resolve por nome;
- `rename` (refactor) — precisa de parser de verdade;
- `workspaceSymbol` (Ctrl+T no projeto inteiro) — o índice resolve;
- `formatting` — resolvido pelo `Formatter.exe`.

---

## 2. Onde estamos hoje (v0.17.0)

Medido, não estimado:

- **~15.300 linhas** de TypeScript, **290 testes** passando, sob git desde este trabalho.
- Índice de **29.177 classes** varrendo 6 raízes em 3,7 s; descoberta de fontes automática
  (Library Path + Browsing Path + `.dproj` + workspace).
- Leitura de **312 BPLs** por RTTI → 17.979 classes, 1.879 com propriedades. É o que
  alimenta a paleta com componentes que só existem como `.dcu`.
- Designer de `.dfm`/`.fmx`: arrastar, redimensionar, inspetor, paleta com busca,
  copiar/colar entre forms, binário ↔ texto.
- Layout do `TdxLayoutControl` calculado em números (`src/dfm/medir.ts`): dos 342 forms do
  projeto de teste, **0,42%** dos containers aninhados transbordam — e a maioria disso é o dropdown do
  `TcxLookupComboBox`, não o layout.
- Build via MSBuild com Debug/Release, Clean+Build, script do projeto, log próprio.
- Navegação Pascal **heurística** (`src/pascalNav.ts`): definição, hover, completion por
  nome. É o que o LSP vai substituir.

### 2.1 Defeitos conhecidos do que existe

| Onde | Problema |
|---|---|
| ~~`pascalNav.ts` `unitDe()`~~ | **Resolvido.** O `Registry` guarda unit→arquivo e aceita o nome curto de unit com namespace. |
| `registry.ts` | Não indexa métodos, funções livres, constantes nem tipos — só classes e propriedades. |
| `pascal.ts` | Regex por linha. Não entende `with`, genéricos, sobrecarga, escopo. |
| ~~Repo~~ | **Resolvido.** Repositório iniciado, 90 arquivos versionados; `.vsix`, `out/` e os scripts de diagnóstico ficaram de fora pelo `.gitignore`. |

---

## 3. As fases

### Fase 0 — Identidade (`Delphi4VSCode`) — **feita**

Rename aplicado nas 206 ocorrências: `name`, `displayName`, os 29 comandos, as 15
configurações, os keybindings e o editor customizado. `src/migrar.ts` traz o que estava em
`dfmview.*` na primeira ativação, sem sobrescrever o que já tiver sido ajustado no nome novo,
e roda uma vez só. A extensão antiga (`app.dfmview`) foi desinstalada — id novo significa as
duas ativas ao mesmo tempo, brigando pelo editor de `.dfm`.

Falta: mover os scripts soltos para `sandbox/` e pôr o repositório sob git.

### Fase 1 — DelphiLSP embutido — **feita**

1. ✅ `src/lsp/config.ts` — gera o `.delphilsp.json` do `.dproj` ativo, reaproveitando
   `sources.ts`. Só reescreve quando o conteúdo muda: regravar igual faria o servidor
   recompilar o projeto inteiro à toa. 8 testes.
2. ✅ `src/lsp/cliente.ts` — `vscode-languageclient` apontando para o `DelphiLSP.exe` da
   instalação escolhida em `bdsBinPath`. Regera e reaponta quando o `.dproj` é salvo.
   `src/lsp/estado.ts` existe separado porque `vscode-languageclient` só carrega dentro do
   VS Code e derrubava os testes de ativação.
3. ✅ O `kkError` era o `-LU` sem pacotes (§1.2). Completa no projeto de teste.
4. **Convivência**: o LSP tem prioridade; o índice atual vira fallback para o que o LSP não
   faz — `references`, `workspaceSymbol`, e completion quando o servidor cala. Isso importa:
   o LSP só responde bem para arquivos que pertencem ao projeto ativo, e o índice responde
   para qualquer `.pas` aberto.
5. Sempre enviar o texto **sem BOM**.

Entrega: autocomplete do compilador, hover com a declaração real, Ctrl+clique em qualquer
símbolo, Error Insight enquanto digita.

### Fase 2 — Criar coisas sem a IDE

- ✅ **Nova unit** — `.pas` com o esqueleto mínimo, registrado no `uses` do `.dpr`.
- ✅ **Novo projeto** — VCL, Console, DLL e Package. O `.dpr`/`.dpk` e o `.dproj` saem de
  `src/dfm/novoProjeto.ts`, com GUID derivado do nome (gerar duas vezes dá o mesmo arquivo).
  **Compilado de verdade com o MSBuild do Delphi 11**: console (19 linhas, 129 KB) e VCL com
  form (49 linhas, 1,96 MB). O projeto novo já entra como ativo na extensão.
- **Novo Form / Frame / DataModule** — já existe (`scaffold.ts`); falta pedir o nome da
  classe e do arquivo, e abrir o designer em seguida.
- **Projeto DUnitX** — falta; os outros quatro tipos já saem.
- **Gabaritos da própria IDE** — o `ObjRepos` da instalação tem os templates que o
  File > New usa. Vale ler dali em vez de inventar (a decidir na implementação).
- **Adicionar componente ao form** já existe pela paleta; falta o caminho inverso: declarar
  o campo no `.pas` ao criar o componente no designer.

### Fase 3 — Codificação fluente

- ✅ **Formatação** via `Formatter.exe`, com o `Formatter.config` do usuário. Substitui o
  formatador próprio, cortado por alterar 55,7% das linhas em 150 `.pas` reais. O arquivo
  temporário vai **com BOM**: sem ele o `Formatter.exe` lê como ANSI e come todo acento de
  comentário e de string — num código em português isso é a maioria dos arquivos.
- ✅ **Ctrl+clique em unit do `uses`** — pelo LSP, com o mapa unit→arquivo do índice como
  fallback.
- **Ctrl+Shift+↑/↓** entre declaração e implementação (já existe, falta o atalho).
- ✅ **Class Completion** (`Ctrl+Shift+C`) — `src/dfm/classcomp.ts`. O corpo gerado foi
  **compilado com o `dcc32`** antes de virar teste, e as regras de diretiva saíram de
  perguntar ao compilador caso a caso, não da documentação:

  | Diretiva | No corpo |
  |---|---|
  | `stdcall` `cdecl` `safecall` `register` `pascal` | repete |
  | `overload` `inline` | `E1030` |
  | `virtual` `reintroduce` `static` | `E2070` |
  | `override` | `E2137` |

  O palpite óbvio — que `overload` se repete — é justamente o errado.

  Varrido contra os **810 `.pas` do projeto de teste**: 3 arquivos acusavam pendência num código que
  compila, e os dois defeitos por trás disso foram corrigidos (`TFooClass = class of TFoo`
  entrava na pilha como classe com corpo; implementação com o nome na linha seguinte à
  palavra-chave não era reconhecida). Depois: **0 falso-positivo**.
- ✅ **Adicionar ao `uses`** — quick fix no `E2003 Undeclared identifier`, pelo índice. Entra
  no `uses` da `implementation` quando existe: pôr tudo na `interface` cria dependência
  circular, que no Delphi é erro de compilação e não aviso.
- **Outline / breadcrumbs** — `documentSymbol` do LSP.
- **Snippets** de Object Pascal (`try..finally`, `for..in`, cabeçalho de classe).

### Fase 4 — Rodar e depurar

- **Rodar** já existe. Falta capturar a saída e casar erro de compilação com o arquivo
  (o `problemMatcher` já está declarado, falta validar contra saída real do MSBuild).
- **Depurador**: não há DAP oficial da Embarcadero, e `DelphiLSP` não depura. As opções
  honestas são (a) continuar abrindo a IDE só para depurar, (b) `gdb`/`lldb` para Linux64.
  **Este é o teto do projeto** — e é melhor dizer isso do que prometer.

### Fase 5 — Designer, continuando

- Terminar os 0,42% de transbordo (`ldTabbed` já entrou; falta o dropdown do
  `TcxLookupComboBox`, que hoje desenha expandido).
- `TdxRibbon` e `TdxOrgChart` (15 classes, ~30 instâncias no projeto de teste — cortado por baixo
  retorno; reavaliar).
- Sincronizar designer ↔ `.pas`: criar componente no designer declara o campo; apagar
  remove; renomear renomeia nos dois.

---

## 4. Ordem de execução

Fases 0, 1 e 2 em paralelo, conforme decidido — o rename e o scaffolding não dependem do LSP,
e o LSP é o que leva mais tempo até a primeira versão instalável.

| # | Entrega | Depende de |
|---|---|---|
| 1 | Rename para `Delphi4VSCode` + limpeza do repo | — |
| 2 | Gerador do `.delphilsp.json` + teste que valida contra o `.dproj` do projeto de teste | — |
| 3 | Cliente LSP com fallback no índice | 2 |
| 4 | Completion do compilador funcionando | 3 |
| 5 | Nova unit / novo Form / novo projeto | 1 |
| 6 | Formatação via `Formatter.exe` | 1 |
| 7 | Class Completion e quick fix de `uses` | 3 |

---

## 5. Regras que valem para tudo isto

- Nada entra como "funciona" sem ter rodado. O que não foi testado é dito como não testado.
- Toda regra não trivial deixa um teste que falha se ela quebrar — foi assim que os quatro
  defeitos do `TdxLayoutControl` apareceram.
- Medir antes e depois quando o ganho for aferível (transbordo, tempo de indexação,
  precisão da inferência).
- O índice próprio não é jogado fora quando o LSP entrar: ele cobre o que o LSP não faz e o
  que está fora do projeto ativo.

---

## 6. Levantamento: o que ainda dá para melhorar

Feito depois da Fase 3, com medição no projeto do projeto de teste e sondagem da instalação do Delphi.

### 6.1 Defeitos reais no que já existe

| # | Onde | Problema |
|---|---|---|
| D1 | `lsp/cliente.ts` | Trocar o projeto ativo **não** recarrega o Code Insight: o servidor segue compilando o projeto anterior, sem nada na tela dizendo isso. |
| D2 | `lsp/cliente.ts` | Trocar Debug↔Release ou Win32↔Win64 também não recarrega — e o objeto de configuração é capturado uma vez na ativação, então nem um recarregar manual pega o valor novo. O sintoma é sutil: completar contra as DCUs da plataforma errada. |
| D3 | `build.ts` | `ativar()` não avisa ninguém. Não existe evento de "o projeto mudou", e é por isso que D1 acontece. |

### 6.2 Alavancas de linha de comando ainda não usadas

A instalação traz **89 executáveis** em `bin`. Os que valem, sondados:

| Binário | O que abre | Estado |
|---|---|---|
| `AuditsCLI.exe` | Linter e métricas de código em XML (severidade, arquivo, linha; complexidade, LOC, acoplamento por classe). Vira diagnóstico e CodeLens. | Roda; gera `<projeto>.audits.xml` e `.metrics.xml` |
| `brcc32.exe` / `cgrc.exe` | Compila `.rc` → `.res`. É o que põe **ícone e version info** no executável. | Não sondado |
| `GetItCmd.exe` | Instala e desinstala componentes do GetIt pela linha de comando. | Ajuda confirmada |
| `reFind.exe` | Busca e substituição PCRE em massa, com `.bak`. É a ferramenta que a IDE usa para renomear unit no projeto. | Ajuda confirmada |
| `rmtdbg280.exe`, `paclient.exe` | Depurador remoto e Platform Assistant. É o teto declarado do projeto — vale **investigar**, não prometer. | Não sondado |
| `tlibimp.exe`, `GenTLB.exe`, `WSDLImp.exe` | Importadores de type library e WSDL. | Não sondados |
| `convert.exe` | `.dfm` binário ↔ texto. Já temos o nosso; serve de conferência. | Ajuda confirmada |

### 6.3 Buracos do índice próprio

O `Registry` indexa **classes e propriedades**. Não indexa método, função livre, constante nem tipo — e é isso que impede duas coisas que se usam o dia inteiro:

- **Ctrl+T** (ir a símbolo no projeto): `workspaceSymbol` não existe no DelphiLSP e nós não podemos prover.
- **Achar usos** (`references`): idem.

### 6.4 Designer

| Lacuna | Tamanho medido no projeto de teste |
|---|---|
| `TcxVerticalGrid` / `TcxCategoryRow` / `TcxEditorRow` | 138 objetos em 13 forms |
| FastReport (`Tfrx*`) | 4.235 objetos em 23 forms — é um designer à parte, não um controle de form |
| Criar componente no designer não declara o campo no `.pas` | todo componente novo |

### 6.5 Fluxo e qualidade

- O `problemMatcher` está declarado e **nunca foi validado** contra saída real do MSBuild: erro de compilação pode não virar item clicável no Problems.
- Sem snippets de Object Pascal.
- Sem runner de DUnitX.
- `pascal.ts` só enxerga a **primeira** classe da unit — o cruzamento `.dfm` × `.pas` erra em unit com duas classes.
- A leitura dos 312 BPLs leva ~24 s.
