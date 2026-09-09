# Cenário de depuração

Projeto mínimo para conferir que a depuração está de pé na sua máquina, sem depender de um
projeto grande. Um carrinho com dois itens; `TCarrinho.Media` divide o total pela quantidade,
e é lá que o breakpoint faz sentido — com o carrinho vazio, aquela linha divide por zero.

## Antes

Duas coisas que não vão embutidas na extensão:

| | |
|---|---|
| Extensão **C/C++** da Microsoft (`ms-vscode.cpptools`) | Só o motor de depuração (`cppvsdbg`). O Code Insight continua sendo o do Delphi. |
| **map2pdb** | O Delphi não gera PDB, e é o PDB que qualquer depurador do Windows lê. O [map2pdb](https://github.com/andersmelander/map2pdb) converte o `.map` detalhado; é código aberto escrito em Delphi, então compila com o compilador que você já tem. Aponte o `.exe` em `delphi4vscode.debug.map2pdb`. |

## Rodando

1. **Delphi: escolher o projeto ativo** → `Depuracao.dproj`
2. Ponha o breakpoint na linha do `Result := Total / Length(FItens)`
3. **F5**

A extensão compila com `/p:DCC_MapFile=3` (o map detalhado, que ela pede na linha de comando
e não grava no seu `.dproj`), converte o `.map` em `.pdb` se ele estiver velho, e sobe o
depurador.

## O que funciona, e o que não

| | |
|---|---|
| Breakpoint por linha de Pascal | sim |
| Passo a passo, entrar e sair de método | sim |
| Pilha de chamadas com arquivo e linha | sim |
| Ponto de parada condicional, contagem de acertos | sim — é do VS Code |
| **Ver variável local por nome** | **não** |

A última merece explicação, porque é uma limitação de origem e não um defeito de configuração.
O PDB é construído a partir do `.map`, e o `.map` tem endereços, nomes públicos e números de
linha — não tem tipo nem variável local. O depurador diz isso com todas as letras:

```
Private symbols (symbols.pri) are required for locals.
```

Dá para inspecionar registrador e memória, e o `Watch` aceita expressão de endereço. O que não
dá é escrever `LCarrinho.FItens` e ver a lista. Fechar essa lacuna exigiria um `.natvis` com os
tipos da RTL, e está anotado no roadmap.
