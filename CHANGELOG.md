# Mudanças

O VS Code mostra este arquivo na aba da extensão. Só o que muda para quem usa fica aqui; o
detalhe técnico está nas mensagens de commit.

## 0.25.0

- **Code Insight do compilador.** O `DelphiLSP.exe` da instalação passa a atender autocompletar,
  hover, ir para a definição, ajuda de assinatura e Error Insight. O arquivo de projeto que ele
  exige é gerado a partir do `.dproj` — a IDE não precisa ser aberta.
- **Ctrl+T** (ir a símbolo no projeto) e **achar usos**, que o DelphiLSP não oferece.
- **Class Completion** no `Ctrl+Shift+C`.
- **Formatação** pelo `Formatter.exe` da instalação, com o seu `Formatter.config`.
- **Testes DUnitX** no Test Explorer, descobertos sem compilar.
- **Novo projeto, nova unit** e o campo do componente declarado na classe ao criar no designer.
- 16 snippets de Object Pascal.
- Erro de compilação passa a virar item clicável no painel Problems. O matcher nunca tinha
  casado com a saída real do MSBuild.
- Um item de status mostra o estado do Code Insight, e diz quando falta escolher o projeto.

### Correções que valem menção

- O cruzamento `.dfm` × `.pas` produzia **8.158 avisos falsos** num projeto real, e dizia que o
  form "vai falhar ao carregar" — o que um programa de teste mostrou ser falso. Agora são 3
  avisos, verdadeiros, com o texto do que de fato acontece.
- Um erro interno do servidor não vira mais erro na tela: cai no índice próprio.

## 0.14.0 e anteriores

Publicadas como **dfmview / Delphi Form Designer**. O nome mudou quando o escopo deixou de ser
só o designer de `.dfm`.

- Designer visual de `.dfm` e `.fmx`, com herança de componentes resolvida pelos `.pas` e pelos
  BPLs instalados.
- Layout do `TdxLayoutControl` calculado em vez de lido das coordenadas gravadas.
- Build por MSBuild com Debug/Release, executar, e gestão de units no `.dpr`.
- Leitura de `.dfm` binário (TPF0) e conversão para texto.

Ao atualizar de uma versão `dfmview`, as configurações são trazidas automaticamente. O
**projeto ativo não vem junto** — o VS Code isola esse estado por extensão e não há API para
lê-lo — então a extensão pergunta na primeira vez.
