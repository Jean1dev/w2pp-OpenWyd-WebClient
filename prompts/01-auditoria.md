# Etapa 1 — baseline e decisão de arquitetura

Leia os documentos de contexto e progresso indicados em `AGENTS.md`. Investigue o servidor Go e o upstream OpenWyd em SHAs fixados antes de implementar a engine.

1. Identifique toolchain Emscripten, build de objetos/link, entrypoint, bridge de render, rede e assets. Diferencie app de inspeção e runtime WASM. Liste arquivos gerados e fontes necessárias; não importe o repositório inteiro por conveniência.
2. Compare o baseline do servidor com seu main atual. Confirme configuração efetiva de ClientVersion (7640/12000), portas e fluxo de contas. Registre versão do cliente candidato (a análise antiga encontrou 1758) sem assumir que continua igual.
3. Crie `docs/compatibility.md`: para cada pacote necessário a login, seleção, mundo e gameplay, registre direção, opcode, comprimento total/body, offsets, tipos, contagens, divergência e teste necessário. Comece por login, SELCHAR, STRUCT_SCORE, CreateMob, CharacterLogin, movimento e inventário; expanda com os consumidores reais. Confira alinhamento WASM e MSVC x86.
4. Audite origem e declarações de licença dos componentes escolhidos. Não trate submodule como solução de direitos. Registre o que pode ser incorporado, o que exige esclarecimento e o que pode ser implementado independentemente. Não envie mensagens a terceiros sem instrução do usuário.
5. Registre ADR em `docs/decisions/001-client-architecture.md`: porte C++/WASM como candidato inicial, alternativas, evidências, lacunas, escopo mínimo e decisão. Defina layout da árvore, gateway, configuração, política de assets e manutenção de patches. Se a decisão depender de informação ausente, documente sem inventar aprovação.

Entregue também `docs/setup.md` com pré-requisitos verificados e `docs/dependencies.md` com SHAs/versões/origem. Aceitação: decisões rastreáveis, incompatibilidades explícitas e plano de build executável. Ainda não declarar multiplayer compatível.
