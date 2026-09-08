# Delphi4VSCode

**Escrever, desenhar, compilar e rodar Delphi sem abrir a IDE.**

Autocompletar vindo do compilador de verdade, designer visual de `.dfm`, build por MSBuild,
testes DUnitX no Test Explorer e scaffolding de projeto — dentro do VS Code.

---

## Por que o autocompletar é o do compilador

A instalação do Delphi traz o `DelphiLSP.exe`, o mesmo servidor de Code Insight que a IDE usa.
Ele fala LSP e roda fora dela — só exige um arquivo de projeto que normalmente só a IDE
escreve. **Esta extensão gera esse arquivo** a partir do seu `.dproj`, e com isso o
autocompletar deixa de ser adivinhação por nome e passa a vir do compilador:

```pascal
Dados.│        →  ItemID, RegistroID, Valor, Emissao, Descricao, Centro, GerarLancamento
```

Isso é um `record` declarado em **outra unit** do projeto, resolvido pela cadeia de herança
inteira. O hover mostra a assinatura real e o arquivo de origem; o Ctrl+clique numa unit do
`uses` abre o `.pas` dela, resolvido pelo compilador e não por busca de nome.

Requer o RAD Studio instalado. Testado no **Delphi 11 (22.0)** e no **Delphi 10.4 (21.0)**.

---

## O que tem

### Código

| | |
|---|---|
| **Code Insight** | Autocompletar, hover, ir para a definição, ajuda de assinatura e Error Insight — tudo pelo `DelphiLSP.exe`. Se o servidor cair ou errar, cai no índice próprio em vez de deixar você sem nada. |
| **Ctrl+T** e **achar usos** | O DelphiLSP não oferece `workspaceSymbol` nem `references`; um índice próprio cobre os dois. |
| **Class Completion** (`Ctrl+Shift+C`) | Declarei o método na classe, gera o corpo em `implementation`. As regras de qual diretiva se repete no corpo vieram de perguntar ao `dcc32` caso a caso — `overload`, por exemplo, **não** se repete. |
| **Ctrl+Shift+↑** | Alterna entre a declaração do método na classe e o corpo em `implementation`, como na IDE. Não depende do índice nem do servidor: o par mora no mesmo arquivo. |
| **Dobrar código** | Seções da unit, blocos, declarações de tipo, `{$REGION}` e comentário de bloco. O `foldingRange` não existe no DelphiLSP, e o dobramento por indentação do VS Code não serve para Pascal — `begin` e `end` ficam na mesma coluna do `procedure`. |
| **Formatação** | Pelo `Formatter.exe` da instalação, com o seu `Formatter.config`. O mesmo resultado do `Ctrl+D` da IDE. |
| **Quick fix de `uses`** | No `E2003 Undeclared identifier`, oferece acrescentar a unit que declara o símbolo. |
| **Snippets** | 16 de Object Pascal, com `try..finally` e fixture DUnitX. |

### Designer de forms

O objetivo é o mesmo da IDE: **desenhar o form com os componentes que ele tem**, sejam quais
forem — não uma lista de componentes suportados.

| | |
|---|---|
| **Qualquer componente** | A família de cada um sai da cadeia de herança e das propriedades que ele publica, nessa ordem; o nome é o último recurso. Um controle que publica `Columns` junto de um `DataSource` desenha como grade, tenha o nome que tiver e venha de quem vier — inclusive de um fabricante que a extensão nunca viu. |
| **Componente sem fonte** | O índice não vem só dos `.pas`: o RTTI dos BPLs instalados também entra, então componente que existe apenas como `.dcu` é reconhecido igual. |
| **Herança visual e frames** | `inherited Form1: TForm1` e `inline Frame1: TFrame1` carregam o arquivo de origem e mesclam os overrides. |
| **Layout calculado** | Container que reposiciona os filhos em tempo de execução tem o layout **recalculado**, e não lido das coordenadas gravadas — que são só o retrato da última vez que a IDE desenhou. É o que faz reordenar e redimensionar terem efeito visível. |
| **Edita** | Arrastar, redimensionar, inspetor de propriedades, paleta com busca, copiar e colar entre forms. Toda edição é um `WorkspaceEdit`: o Ctrl+Z é o do VS Code e o save é seu. |
| **Sincroniza com o `.pas`** | Criar componente declara o campo na classe; apagar remove. |
| **`.dfm` binário** | Lê o formato TPF0 e converte para texto quando você pedir. |

### Projeto e build

| | |
|---|---|
| **Compilar** | `Ctrl+F9` compila, `Shift+F9` recompila tudo, `Ctrl+Shift+F9` limpa e reconstrói. Erro de compilação vira item clicável no painel Problems. |
| **Rodar** | `F9` executa o binário compilado. |
| **Criar** | Novo projeto (VCL, Console, DLL, Package), nova Unit, novo Form, Frame ou Data Module — já registrados no `.dpr`. |
| **Testes DUnitX** | Descobertos no fonte sem compilar nada e executados pelo Test Explorer, com a falha levando à linha. |

---

## Como começar

1. Abra a pasta do seu projeto Delphi.
2. Escolha o `.dproj` ativo pela barra de status (ou aceite quando a extensão perguntar).
3. Pronto. O item **Code Insight** na barra mostra o projeto apontado.

Se o autocompletar não responder, o item de status diz por quê, e o canal
**Delphi Code Insight** (`Ctrl+Shift+U`) mostra o que o servidor carregou.

---

## Atalhos

| Atalho | O que faz |
|---|---|
| `Ctrl+F9` | Compilar |
| `Shift+F9` | Recompilar tudo |
| `Ctrl+Shift+F9` | Limpar e reconstruir |
| `F9` | Executar |
| `Ctrl+Shift+C` | Completar classe |
| `Alt+F12` | Alternar entre o designer e o texto do `.dfm` |

Os 32 comandos aparecem na paleta com o prefixo **Delphi:**.

---

## Configuração

A extensão descobre sozinha os caminhos de fonte, lendo o Library Path, o Browsing Path, o
`.dproj` e o workspace. Quase nada precisa ser configurado.

| Configuração | Padrão | Para quê |
|---|---|---|
| `delphi4vscode.bdsBinPath` | *(descoberto)* | A pasta `bin` do RAD Studio. Com mais de uma instalação, a extensão pergunta e grava. |
| `delphi4vscode.buildConfig` | `Debug` | Configuração de build. |
| `delphi4vscode.buildPlatform` | `Win32` | Plataforma. |
| `delphi4vscode.lsp.enabled` | `true` | Desligado, o Code Insight volta a ser o índice próprio. |
| `delphi4vscode.symbols.excluir` | `["vendor", …]` | Pastas fora do Ctrl+T. Código de terceiros costuma ser dois terços dos `.pas` de um projeto grande. |
| `delphi4vscode.buildScript` | *(vazio)* | Script próprio de build, quando o projeto tem um. |
| `delphi4vscode.testProject` | *(vazio)* | O `.dproj` dos testes, se não for o projeto ativo. |

---

## O que ainda não faz

- **Depurar.** Não existe adaptador de depuração oficial da Embarcadero, e o DelphiLSP não
  depura. Para pôr breakpoint, ainda é a IDE.
- O `DelphiLSP.exe` estoura sozinho de vez em quando (`Internal server error` num pedido).
  É defeito do binário da Embarcadero; a extensão registra e cai no índice próprio em vez de
  mostrar o erro para você.

O caminho até aqui e o que vem a seguir estão em [`docs/ROADMAP.md`](https://github.com/herlondf/Delphi4VSCode/blob/main/docs/ROADMAP.md).

---

## Como isto é construído

Duas regras que valem para todo o código:

**Nada entra como "funciona" sem ter rodado.** As afirmações deste README foram medidas, não
supostas. Quando uma pergunta é sobre o Delphi, quem responde é o compilador: as regras de
diretiva da Class Completion saíram de compilar cada caso com o `dcc32`, e a mensagem de um
diagnóstico foi reescrita depois que um programa de teste mostrou que a afirmação anterior era
falsa.

**Toda regra não trivial deixa um teste que falha se ela quebrar.** São 346, e vários nasceram
de um defeito encontrado ao rodar a extensão contra um projeto real de 342 forms e 810 units —
onde um diagnóstico chegou a produzir 8.158 avisos falsos antes de virar 3 verdadeiros.

---

MIT.
