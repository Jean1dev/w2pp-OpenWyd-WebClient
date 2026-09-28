# Progresso

Atualização: 28/09/2026. Auditoria iniciada; runtime original do Alan compilado e linkado localmente em WASM. Ainda não há cliente adaptado, cena no navegador ou teste de gameplay.

| Etapa | Estado | Evidência |
|---|---|---|
| 1 Auditoria | Em andamento | [Fontes, layouts, build e assets](evidence/01-auditoria/README.md) |
| 2 Build e cena | Pendente | — |
| 3 Protocolo | Pendente | — |
| 4 Login e mundo | Pendente | — |
| 5 Gameplay | Pendente | — |
| 6 Paridade | Pendente | — |
| 7 Experiência web | Pendente | — |
| 8 Entrega | Pendente | — |

## Próxima ação

Concluir `prompts/01-auditoria.md`: revisar os consumidores ainda assinalados na [matriz](compatibility.md), especialmente caudas e respostas auxiliares; fechar o mapeamento dos assets7662 para o runtime do Alan. A rota de continuidade está escolhida no [ADR001](decisions/001-client-architecture.md). O build de código já passou; a próxima prova de runtime exige loaders corretos para ItemList/SkillData e atlas/fontes locais válidos. Só então avançar à cena real da etapa2. Não seguir diretamente para login/UI.

## Registro por sessão

### 28/09/2026 — auditoria e viabilidade do porte

- **Decisão do usuário:** continuar/forkar a base alanpetry; acompanhar as últimas alterações integradas do servidor. Não iniciar engine alternativa.
- **Revisões:** cliente inicial `b60db820aa84e3ded322a64ebdd2d99e14b9b6f2`; servidor `98286fdf01202f503523e89d3e50b2183f00c36c`; Alan `beb9f69bdea6d81f70af14b5ce85ed064575bb26`. Checkouts em `external/server` e `external/OpenWyd`, isolados e ignorados.
- **Ambiente:** Windows/PowerShell, Python3.14.3; Go1.25.13 e Emscripten6.0.0 instalados no cache local. Docker daemon indisponível; nenhuma stack iniciada.
- **Entregas próprias:** lock de dependências; ferramentas de inventário de fontes, probe ABI, preflight de assets e verificação estrutural de WASM; matriz, setup, dependências, ADR e evidências. Atualizados README, contexto/fontes, progresso e ignore de caches Python. Nenhuma modificação no servidor ou no upstream versionado.
- **Resultados:** 114 objetos compilados/certificados após uma primeira tentativa recusada por fingerprint; link estrito sem símbolos indefinidos; WASM válido de1.893.013 bytes. Go:111 pass e2 skips; testes Python upstream:6+16 pass. Comandos e limites em [evidências](evidence/01-auditoria/README.md) e [setup](setup.md).
- **Assets fornecidos:** `C:\Users\User\Documents\Client-aws\Client-aws`, somente leitura. 7.092 arquivos/318.725.705 bytes inventariados;20 padrões ausentes,2 derivados upstream ausentes,5 arquivos vazios. ItemList/SkillData incompatíveis com o tamanho lido pelo Alan; nenhuma conversão ou importação realizada.
- **Limitações:** matriz ainda parcial; layouts provisórios no backend; fontes/atlas e formatos de assets pendentes; nenhum teste visual, login ou multiplayer. Proveniência de terceiros ainda limita incorporação/distribuição integral. Nada publicado ou commitado.
- **Próximo passo:** concluir o mapa de consumidores e o contrato dos loaders7662, preparar patches pequenos no fork local e validar uma cena real com os assets do operador. Não declarar etapa1/2 Validada nesta sessão.

### 28/09/2026 — entrega da auditoria para revisão

- Solicitação do usuário: commit, push e PR da entrega acima, na branch `Jean1dev/start`, com destino a `main`.
- Revisados os arquivos próprios e a proveniência dos metadados; assets, executáveis, toolchains, checkouts externos e manifesto completo de assets permanecem ignorados.
- Verificações de entrega: revisão do diff, `git diff --check`, inspeção dos arquivos novos e conferência dos resultados registrados. Não foram repetidos build ou testes de gameplay; a etapa 1 continua Em andamento.

Estados permitidos: Pendente, Em andamento, Bloqueada (motivo específico), Validada. Uma etapa parcialmente testada não é Validada.
