# Por que não há formatador de Pascal

Foi implementado e descartado.

A regra de indentação do Object Pascal não cabe em heurística de linha: `type`, `var` e
`const` mudam de nível conforme estejam na unit ou dentro de um método; o corpo de uma
classe indenta de um jeito e o de um `record` de outro; `case` tem dois níveis; `else` pode
fechar um `if` ou um `case`; e diretivas `{$IFDEF}` cortam blocos ao meio.

Medido sobre 150 `.pas` do projeto de teste (24.820 linhas), a versão por regex
alterava **55,7% das linhas** — nos piores arquivos, 75%. Um formatador assim não formata:
reescreve. Num repositório com histórico, isso transforma qualquer commit em diff ilegível e
esconde a mudança de verdade no meio do ruído.

Fazer certo exige um parser de Object Pascal, não uma tabela de expressões regulares. Até
lá, `files.trimTrailingWhitespace` e `editor.insertSpaces` do próprio VS Code cobrem a parte
segura, sem tocar em estrutura.
