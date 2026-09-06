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
- ⚠️ **Uma unit do `uses` mata o completar: `Vcl.Graphics`.** Bissecção sobre as 41 units do
  `uses` de um form real: com as 5 primeiras (`Winapi.Windows`, `Winapi.Messages`,
  `System.SysUtils`, `System.Variants`, `System.Classes`) o completar devolve 108 itens; ao
  acrescentar `Vcl.Graphics` cai para 0, com `Kibitz result: kkError` no log. Quatro hipóteses
  foram testadas e **descartadas**: defines contraditórios (`RELEASE` e `DEBUG` juntos, que o
  `.dproj` do projeto de teste de fato define), os caminhos `-O`/`-R`, o Browsing Path dentro do `-U`, e
  os caminhos de saída e de pacotes (`-NU`, `-E`, `-LE`, `-LN`, `-NB`). Segue em aberto.

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

## 2. Onde estamos hoje (v0.15.0)

Medido, não estimado:

- **~13.900 linhas** de TypeScript, **265 testes** passando.
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
| `pascalNav.ts` `unitDe()` | Varre as 29 mil classes a cada Ctrl+clique. O índice não guarda unit→arquivo, só classe→arquivo, então unit sem classe (`System.SysUtils`) nunca é encontrada. |
| `registry.ts` | Não indexa métodos, funções livres, constantes nem tipos — só classes e propriedades. |
| `pascal.ts` | Regex por linha. Não entende `with`, genéricos, sobrecarga, escopo. |
| Repo | **Não é repositório git** — 13 mil linhas sem controle de versão. Além disso, 14 `.vsix` e `diag.js`/`diag2.js` soltos na raiz. |

---

## 3. As fases

### Fase 0 — Identidade (`Delphi4VSCode`) — **feita**

Rename aplicado nas 206 ocorrências: `name`, `displayName`, os 29 comandos, as 15
configurações, os keybindings e o editor customizado. `src/migrar.ts` traz o que estava em
`dfmview.*` na primeira ativação, sem sobrescrever o que já tiver sido ajustado no nome novo,
e roda uma vez só. A extensão antiga (`app.dfmview`) foi desinstalada — id novo significa as
duas ativas ao mesmo tempo, brigando pelo editor de `.dfm`.

Falta: mover os scripts soltos para `sandbox/` e pôr o repositório sob git.

### Fase 1 — DelphiLSP embutido — **em pé, com uma pendência**

1. ✅ `src/lsp/config.ts` — gera o `.delphilsp.json` do `.dproj` ativo, reaproveitando
   `sources.ts`. Só reescreve quando o conteúdo muda: regravar igual faria o servidor
   recompilar o projeto inteiro à toa. 8 testes.
2. ✅ `src/lsp/cliente.ts` — `vscode-languageclient` apontando para o `DelphiLSP.exe` da
   instalação escolhida em `bdsBinPath`. Regera e reaponta quando o `.dproj` é salvo.
   `src/lsp/estado.ts` existe separado porque `vscode-languageclient` só carrega dentro do
   VS Code e derrubava os testes de ativação.
3. ⚠️ Fechar o `kkError` do `Vcl.Graphics` (§1.1) — é o que separa "funciona no exemplo" de
   "funciona no projeto de teste".
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

- **Formatação** via `Formatter.exe` — `DocumentFormattingEditProvider` chamando o binário
  com o `Formatter.config` do usuário. Isso **substitui** o formatador próprio, que foi
  cortado por alterar 55,7% das linhas em 150 `.pas` reais (ver
  `src/dfm/formatar-decisao.md`).
- **Ctrl+clique em unit do `uses`** — pelo LSP; e um mapa unit→arquivo no índice como
  fallback, que também corrige a varredura O(29k) de hoje.
- **Ctrl+Shift+↑/↓** entre declaração e implementação (já existe, falta o atalho).
- **Class Completion** — o `Ctrl+Shift+C` do Delphi: declarei o método na classe, gerar o
  corpo em `implementation` (e o inverso).
- **Adicionar ao `uses`** — quick fix no `E2003 Undeclared identifier` usando o índice para
  saber em que unit o símbolo mora.
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
