# Mudanças

O VS Code mostra este arquivo na aba da extensão. Só o que muda para quem usa fica aqui; o
detalhe técnico está nas mensagens de commit.

## 0.27.0

- **Depuração.** Era o teto declarado do projeto e deixou de ser. F5 compila com map
  detalhado, gera os símbolos e sobe o depurador; breakpoint, pilha, variáveis e passo a
  passo, por linha de Pascal. Precisa da extensão C/C++ da Microsoft (só o motor de
  depuração) e do conversor `map2pdb`, que é código aberto escrito em Delphi — a extensão diz
  o que falta e onde pegar.
- **Atalhos mudam junto:** `F5` depura, `Ctrl+F5` roda sem depurar, e o **`F9` volta a ser
  alternar breakpoint**. F9 rodando o programa era aceitável enquanto não havia como pôr
  breakpoint.
- **Ícone e informações de versão** do executável, sem abrir as opções do projeto:
  incrementar o build, digitar a versão, editar `CompanyName` e companhia, trocar o `.ico`.
- **Auditoria do projeto** pelo `AuditsCLI` da instalação, sob demanda, com progresso e
  cancelamento — os achados vão para o painel Problems, com os locais relacionados ligados.
- **Renomear unit** no projeto inteiro: o arquivo, o `.dfm`, o cabeçalho, todos os `uses`, o
  `.dpr` e o `.dproj` numa edição só, que um Ctrl+Z desfaz. Uso qualificado ambíguo
  (`X.Algo`, que pode ser uma variável de mesmo nome) é listado, não trocado.

## 0.26.0

- **Espaçamento do designer conferido contra a fonte do componente.** Os recuos do container
  de layout eram palpite; agora saem de `GetGroupBorderWidth` e `DLUToPixels`, e os recuos de
  cada form saem do `LayoutLookAndFeel` que ele referencia — inclusive quando esse componente
  mora num data module. Medido contra o que a IDE gravou, em 647 controles: posição exata em
  x subiu de 48% para 63%, em y de 52% para 67%, largura de 65% para 80%, altura para 92%.
- **`Offsets` de cada item do layout** passam a valer — é a margem que indenta um rádio sob o
  que ele qualifica, ou encosta dois campos.
- Um container de layout baixo saía com o conteúdo de 1px, porque o recuo padrão comia os dois
  lados. Caixas degeneradas nos 642 forms de teste: 285 antes, 56 agora — e as que sobram são
  bevel e splitter de verdade.
- **Dobrar código** (`foldingRange`), que o DelphiLSP não oferece: seções da unit, blocos,
  declarações de tipo, `{$REGION}` e comentário de bloco. O dobramento por indentação do VS
  Code não servia, porque `begin` e `end` ficam na mesma coluna do `procedure`.
- **`Ctrl+Shift+↑` alterna declaração e implementação**, como na IDE. Só em arquivo Pascal;
  quem preferir o cursor-acima original troca em Keyboard Shortcuts.

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

- Designer visual de `.dfm` e `.fmx`, com a família de cada componente resolvida pela herança
  e pelas propriedades publicadas — dos `.pas` do projeto e do RTTI dos BPLs instalados.
- Container que reposiciona os filhos em tempo de execução tem o layout calculado, em vez de
  lido das coordenadas gravadas.
- Build por MSBuild com Debug/Release, executar, e gestão de units no `.dpr`.
- Leitura de `.dfm` binário (TPF0) e conversão para texto.

Ao atualizar de uma versão `dfmview`, as configurações são trazidas automaticamente. O
**projeto ativo não vem junto** — o VS Code isola esse estado por extensão e não há API para
lê-lo — então a extensão pergunta na primeira vez.
