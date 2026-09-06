# Delphi Form Designer

Abre e edita arquivos `.dfm` e `.fmx` do Delphi visualmente dentro do VS Code, com suporte a
VCL, FireMonkey e DevExpress.

## O que faz

- **Renderiza o form** a partir do `.dfm`, resolvendo herança de componentes pelos `.pas` do
  projeto — um `TcxGrid` desenha como grid, não como caixa cinza.
- **Resolve frames e herança visual**: `inline Frame1: TFrame1` e `inherited Form1: TForm1`
  carregam o `.dfm` de origem e mesclam os overrides.
- **Layout do dxLayoutControl**: alterna entre as coordenadas gravadas pelo designer e o
  layout recalculado, em que reordenar e redimensionar têm efeito visível.
- **Edita** posição, tamanho e propriedades. Toda edição é um `WorkspaceEdit`: o arquivo fica
  sujo na aba, o Ctrl+Z é o do VS Code e o save é seu.
- **Data modules** desenham a superfície com os componentes, como no Delphi.
- **Lê `.dfm` binário** (formato TPF0) e **grava uma cópia binária** quando você pedir.
- **Problemas** do form no painel Problems: componente fora do pai, TabOrder repetido, nome
  duplicado, e propriedade que a classe não declara.
- **Estrutura** navegável, mais uma faixa com os componentes não visuais do form — actions,
  menus, data sources — que nunca aparecem na tela.

## Object Inspector

Espelha o do Delphi: categorias, filtro, e uma aba própria para **Eventos**. O botão `A↓`
alterna entre categorias e ordem alfabética.

| tipo de propriedade | como se edita |
|---|---|
| texto, número, enum | direto na linha |
| booleano | lista True/False |
| cor | amostra clicável + nome (`clBtnFace`) ou `$00BBGGRR` |
| conjunto (`Font.Style`, `Anchors`) | caixinhas |
| lista de strings (`Lines`, `Items`) | caixa com uma linha por item |
| coleção (`Columns`) | ordenar, duplicar e remover itens |
| referência (`DataSource`, `PopupMenu`) | lista dos componentes compatíveis do form |
| sub-propriedades (`Font.*`) | grupo que abre e fecha |
| evento | vai ao método, ou cria o handler no `.pas` |

O que está gravado neste arquivo vem em **negrito**; o que veio de frame ou ancestral vem em
itálico. Selecionando vários componentes (Ctrl+clique), o inspetor mostra só o que todos têm
e grava em todos de uma vez.

Trocar o `Name` renomeia de verdade: o `.dfm`, quem apontava para o componente, e no `.pas` o
campo mais os handlers derivados do nome. A extensão mostra a lista antes de aplicar.

## Criar

- **Delphi: novo Form / Frame / Data Module** cria o par `.pas` + `.dfm` e registra a unit no
  `.dpr` do projeto ativo. Para form, oferece modelos (em branco, diálogo com OK/Cancelar,
  consulta com grade) ou herdar de um form do projeto.
- **Insert** abre a paleta com **todos os componentes instalados** — os das fontes indexadas e
  os que só existem em `.bpl`. A primeira aba mostra os que o projeto já usa, ordenados por
  frequência (num projeto DevExpress o `TcxButton` vem antes do `TButton`); a aba *todos* traz
  o resto. O filtro procura por nome de classe e por unit, e vale sobre a paleta inteira. Dá
  para clicar ou **arrastar até o container**.
- A unit de cada componente vem do índice — do arquivo, quando há fonte, e do `UnitName` do
  RTTI, quando a classe só existe compilada — e entra sozinha no `uses` do `.pas`.
- Dentro de um `TdxLayoutControl`, criar um componente cria junto o `TdxLayoutItem` que o
  posiciona — sem ele o componente existe mas não aparece.
- Botão direito: **inserir frame existente**, **salvar a seleção como modelo** e **inserir
  modelo salvo** (com renumeração automática dos nomes que colidirem).
- Menu (`TMainMenu`, `TPopupMenu`): editor de itens com caption, separador, subitem e ordem.

## Projeto ativo e compilação

A view **Delphi** na barra lateral lista todos os `.dproj` e `.dpr` da pasta aberta. Clique
num `.dproj` para torná-lo ativo — ele sobe para o topo com um ✓ verde, e o nome aparece na
barra de status embaixo.

Na barra de status ficam dois itens: o **projeto** e a **configuração/plataforma**. Clicar em
cada um troca o seu. O botão ▶ na barra do designer compila sem tirar a mão do form.

| | |
|---|---|
| `Ctrl+F9` | compilar o projeto ativo (`/t:Make` — o *Compile* do IDE) |
| `Shift+F9` | recompilar tudo (`/t:Build` — passa `-B` ao dcc32) |
| `Ctrl+Shift+F9` | limpar e reconstruir (`/t:Clean;Build` — apaga os DCU e refaz) |
| clique no nome do projeto | trocar de projeto |
| clique em `Debug/Win32` | trocar configuração e plataforma |
| **Delphi: compilar como...** | compila numa configuração só desta vez, sem gravar |

Os três atalhos também valem com o foco no designer.

`delphi4vscode.buildVerbosity` controla o detalhe (`quiet`, `minimal`, `normal`, `detailed`,
`diagnostic`). Em `detailed` sai a linha do `dcc32` com o search path inteiro — é o que se
olha quando uma unit não é encontrada ou vem do lugar errado.

**Delphi: abrir log de diagnóstico** mostra o que a extensão fez em cada build: projeto,
rsvars escolhido, script gerado. O arquivo sobrevive ao reload da janela, ao contrário do
painel Output.

Os erros do compilador vão para o painel Problems e aparecem **na própria linha do código**.

### Projeto com toolchain própria

Nem todo projeto Delphi compila com o `rsvars.bat` da instalação. Há projeto que carrega no
próprio repositório o compilador, a lib da VCL recompilada e o `EnvOptions.proj` — porque
substitui alguma unit da VCL (um `Vcl.Consts.pas` traduzido, por exemplo). Compilar isso com
a instalação da máquina falha sempre com `F2051`, e não há configuração de search path que
resolva: os `.dcu` oficiais da VCL foram compilados contra a unit original.

Nesse caso, **Delphi: usar o script de build do projeto** encontra o script do repositório e
passa a chamá-lo no lugar do msbuild:

```jsonc
{
  "delphi4vscode.buildScript": "\"<caminho>/ci/build_debug.bat\" ${project}",
  "delphi4vscode.buildScriptCwd": "<diretório de onde o script espera rodar>"
}
```

Marcadores: `${project}` (nome do `.dproj` sem extensão), `${projectPath}`, `${target}`,
`${config}`, `${platform}`, `${workspaceFolder}`. Os erros continuam indo para o painel
Problems.

A distinção entre os dois atalhos é a mesma do Delphi e importa: o `Shift+F9` recompila toda
unit que tenha fonte no search path. Num projeto que mantém cópia própria de uma unit da VCL
(um `Vcl.Consts.pas` traduzido, por exemplo), isso recompila a cópia contra os `.dcu`
pré-compilados da VCL e o build para com `F2051 — Unit X was compiled with a different
version of Y`. O `Ctrl+F9` não passa por isso.

## Configuração

```jsonc
{
  // pastas de .pas a indexar; vazio usa o próprio workspace
  "delphi4vscode.sourcePaths": [
    "C:/Program Files (x86)/Embarcadero/Studio/22.0/source/vcl",
    "C:/Program Files (x86)/Embarcadero/Studio/22.0/source/rtl",
    "C:/Program Files (x86)/Embarcadero/Studio/22.0/source/data",
    "vendor/devexpress/product/source"
  ],
  // avisar quando o .dfm grava propriedade que a classe não declara
  "delphi4vscode.validarPropriedades": true
}
```

### Componentes sem fonte

Componente comercial costuma vir só compilado. O `.dcu` não ajuda — formato proprietário que
muda a cada versão —, mas o `.bpl` sim: todo `published` deixa RTTI no binário, e dali saem
nome da classe, ancestral, unit e as propriedades publicadas. A extensão lê os pacotes da
pasta `Bpl` e os da instalação, em segundo plano, e usa isso **só para completar** o que o
índice de fontes não cobriu. Desligue em `delphi4vscode.lerPacotes` se não quiser.

### Como a extensão decide o que desenhar

Em ordem, parando na primeira que responde:

1. **herança** — a cadeia chega a um ancestral conhecido;
2. **propriedades publicadas** — quem publica `Columns` junto de `DataSource` é uma grade,
   quem publica `ModalResult` é um botão, tenha o nome que tiver;
3. **nome** — heurística por substring;
4. **genérico** — desce a `TWinControl`/`TControl`.

A ordem entre 2 e 3 foi medida contra as classes cujo tipo já se conhece por herança, nos
1.111 `.dfm` do projeto de referência: a inferência por propriedade acerta **89,5%**, a
heurística de nome **55,5%**.

Componente que não casa com nada nenhum ainda é desenhado, na posição e no tamanho corretos,
arrastável e com o inspetor funcionando — o que se perde é só a aparência específica.

O índice é construído uma vez e guardado em cache por conjunto de pastas — abrir um segundo
projeto não invalida o do primeiro. Um `.pas` salvo é relido sozinho; **Delphi Form:
reindexar classes dos .pas** força a varredura completa depois de instalar componentes novos.

## Atalhos

| | |
|---|---|
| botão direito | menu com duplicar, apagar, alinhar, z-order, inserir, reverter herança |
| arrastar | move, ou reordena dentro de um grupo de layout |
| arrastar no vazio | laço de seleção |
| alças (8) | redimensiona por qualquer lado ou canto |
| alça no canto do form | redimensiona o form; os `Anchors` acompanham |
| setas / Shift+setas | move 1 px / 8 px |
| Alt (arrastando) | ignora o encaixe nas guias |
| Ctrl+clique | seleção múltipla — depois `A` alinha à esquerda, `T` ao topo, `D` distribui |
| Ctrl+G | grade de fundo |
| Ctrl+L | trava as posições (seleção e propriedades continuam livres) |
| Ctrl+`+` / Ctrl+`-` / Ctrl+0 | zoom; Ctrl+roda também |
| Del / Insert | apaga / abre a paleta |
| Esc | seleciona o container pai |
| duplo clique | cria o handler de `OnClick` no `.pas` |

Mover o cursor no `.dfm` aberto como texto seleciona o componente no designer, e o contrário
também vale — dá para deixar os dois lado a lado.

## Sem sair do VS Code

| | |
|---|---|
| `F9` | executar o programa compilado, num terminal próprio |
| **Delphi: acrescentar esta unit ao projeto** | põe o `.pas` aberto no `uses` do `.dpr` |
| **Delphi: remover unit do projeto** | tira do `uses`, cuidando do `;` da última linha |
| **Delphi: verificar estrutura do projeto** | unit apontando para arquivo que sumiu, `{$R *.dfm}` sem form, unit com nome trocado, entrada repetida |
| **Delphi: resumo do projeto** | forms, data modules, frames, componentes por classe, e o que o índice não conhece |
| **Delphi Form: converter binário para texto** | destrava a edição de um `.dfm` binário, guardando o original como `.bin` |

No código Pascal: **ir para a definição** (classe ou unit do `uses`), **passar entre a
declaração e a implementação** de um método, **hover** com a herança e as propriedades
publicadas, e **completar** classes e propriedades. Tudo vem do mesmo índice do designer.

No designer: `Ctrl+C`/`Ctrl+V` copiam e colam componentes **entre forms** — o que vai para a
área de transferência é o bloco de texto do `.dfm`, então funciona entre janelas e entre
projetos. `Ctrl+Shift+F` encaixa o form na janela.

## Limitações

- `.dfm` binário abre somente para leitura; para editar, converta para texto.
- Componente com `Align` que preenche o pai não é arrastável, como no próprio Delphi.
- O aviso de propriedade inexistente só age quando o índice cobre a cadeia inteira da classe;
  com a cadeia truncada ele se cala em vez de arriscar um aviso errado.
- FireMonkey é suportado na geometria (`Position`/`Size`/`Align`) e na edição; estilos e
  efeitos do FMX não são desenhados.
- Relatórios FastReport não são suportados.
