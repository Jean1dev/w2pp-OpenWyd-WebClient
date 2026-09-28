# Prompt mestre — executar o desenvolvimento

Você está no repositório `Jean1dev/w2pp-OpenWyd-WebClient`. Construa nosso cliente WYD web integrado ao servidor Go existente. Este pedido é de implementação, não apenas de planejamento.

Leia `AGENTS.md`, `docs/CONTEXT.md`, `docs/SOURCES.md`, `docs/ACCEPTANCE.md` e `docs/PROGRESS.md`. Examine a árvore e o estado Git; preserve trabalho existente. Os prompts 01–08 são a sequência de entregas, não funcionalidades já implementadas.

Execute a primeira etapa pendente usando o prompt correspondente. Se o resultado satisfizer seus critérios e não houver dependência pendente, prossiga para a etapa seguinte dentro do escopo da sessão. Não pule auditoria de compatibilidade para começar pela UI. Não reescreva toda a engine sem decisão documentada.

Use checkouts separados para servidor e upstream; registre seus caminhos e SHAs. Não dependa do diretório absoluto usado por quem preparou estes documentos. Só o código executável escolhido e validado determina comandos de build. Reutilize recursos existentes quando adequados.

A cada etapa entregue implementação, verificação proporcional ao risco e evidência reproduzível. Corrija falhas de sua implementação antes de encerrar. Se houver dependência externa ausente, indique precisamente qual e continue trabalho independente útil, sem simular testes que dependem dela.

Atualize `docs/PROGRESS.md`, registre decisões em `docs/decisions/` e evidências em `docs/evidence/`. Termine informando o que roda de verdade, comandos usados, limitações e próxima etapa. Nunca marque uma etapa completa só por ter escrito um plano.
