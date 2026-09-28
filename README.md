# w2pp-OpenWyd-WebClient

Pacote de contexto e prompts para construir nosso cliente WYD no navegador, integrado ao servidor Go [Jean1dev/w2pp-OpenWYD](https://github.com/Jean1dev/w2pp-OpenWYD).

Estado em **28/09/2026**: auditoria em andamento e continuidade do OpenWyd escolhida. O runtime do Alan já compilou/linkou localmente em WASM; ainda não há cliente adaptado, cena validada ou gateway implementado. Veja [progresso](docs/PROGRESS.md), [setup reproduzível](docs/setup.md) e [evidências](docs/evidence/01-auditoria/README.md).

## Começar

1. Abra este repositório em seu agente de desenvolvimento.
2. Cole [prompts/00-orquestrador.md](prompts/00-orquestrador.md).
3. O agente lê [AGENTS.md](AGENTS.md), [contexto](docs/CONTEXT.md), [fontes](docs/SOURCES.md) e [progresso](docs/PROGRESS.md), e executa a primeira etapa pendente.
4. Para sessões focadas, use os prompts numerados abaixo. Para retomar, use [09-retomada.md](prompts/09-retomada.md).

| Etapa | Prompt | Resultado exigido |
|---|---|---|
| 1 | [Auditoria e decisão](prompts/01-auditoria.md) | Fontes fixadas, matriz de compatibilidade e arquitetura justificada |
| 2 | [Build e cena](prompts/02-build.md) | Build reproduzível, assets locais e cena real renderizada |
| 3 | [Transporte e protocolo](prompts/03-protocolo.md) | Gateway WS/TCP e codecs validados byte a byte |
| 4 | [Login e mundo](prompts/04-login-mundo.md) | Conta → seleção → mundo → dois clientes sincronizados |
| 5 | [Gameplay](prompts/05-gameplay.md) | Combate, itens, NPCs e persistência comprovados |
| 6 | [Paridade e desempenho](prompts/06-paridade.md) | Comparação visual e medições reproduzíveis |
| 7 | [Experiência web](prompts/07-experiencia-web.md) | Portal, cache, atualização; mobile e reconexão em etapas próprias |
| 8 | [Entrega](prompts/08-entrega.md) | CI, ambiente de demonstração e relatório de aceitação |

A rota inicial a investigar é adaptar o cliente C++/WASM de `alanpetry/OpenWyd` ao dialeto do nosso servidor. Ela é uma hipótese de engenharia, não uma declaração de compatibilidade nem autorização de redistribuição. A etapa 1 registra a decisão e alternativas. Valthera é referência observacional, não dependência.

Consulte [critérios de aceitação](docs/ACCEPTANCE.md). Cada etapa deve deixar código quando aplicável, comandos reproduzíveis, evidências e progresso atualizado. Uma cena offline não conclui integração multiplayer.
