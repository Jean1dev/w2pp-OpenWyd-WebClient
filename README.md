# w2pp-OpenWyd-WebClient

Pacote de contexto e prompts para construir nosso cliente WYD no navegador, integrado ao servidor Go [Jean1dev/w2pp-OpenWYD](https://github.com/Jean1dev/w2pp-OpenWYD).

Estado em **29/09/2026**:
- O runtime do Alan roda em WASM no navegador sobre os assets locais do operador.
- Um gateway próprio (`gateway/`) e uma camada de dialeto (`client/dialect/`) o conectam ao tm-server Go.
- No servidor de teste do operador (Railway), já foram provados: login e PIN, criação das quatro classes, entrada no Field, duas sessões que se veem e veem o movimento, relogin e troca de mapa.
- O combate (`MSG_Attack`) está traduzido e coberto por testes, mas ainda **não foi provado online**.
- O cliente Windows e o restante do gameplay estão pendentes.

Veja [progresso](docs/PROGRESS.md), [setup reproduzível](docs/setup.md), [deploy no Railway](docs/deploy.md) e as evidências de [auditoria](docs/evidence/01-auditoria/README.md), [cena](docs/evidence/02-build/README.md), [protocolo](docs/evidence/03-protocolo/README.md), [mundo](docs/evidence/04-login-mundo/README.md) e [gameplay](docs/evidence/05-gameplay/README.md).

Jogar localmente contra o servidor de teste do Railway: `make dev` (ou `npm run dev` no Windows sem `make`). O comando aplica os patches, recompila o runtime só se necessário, monta o site, sobe o gateway e abre o Chrome em `http://127.0.0.1:8290/client.html`.

Verificações locais, com o dataset já importado e o runtime rebuildado com os patches ([setup](docs/setup.md)):

```
npm run scene             # cena offline
npm run gateway:test      # gateway WS→TCP
npm run protocol:vectors  # vetores CPSock independentes contra o codec Go
npm run protocol:dialect  # tradutor do dialeto (wasm32)
npm run client:stream     # navegador + gateway + servidor roteirizado
npm run world:checks      # regras do harness online
npm run world -- --target <host:porta> --env-file .env   # cenários reais com duas contas
```

A CI (`.github/workflows/ci.yml`) roda o que não depende de dados privados: gateway com `-race`, reprodutibilidade de vetores e fixtures, vetores contra o codec do servidor fixado, dialeto em wasm32 e build da imagem Docker com smoke sem assets. O deploy (`Dockerfile`, `railway.json`) serve página e runtime da imagem e os dados do jogo a partir de um Volume do operador, atrás de senha. Veja [docs/deploy.md](docs/deploy.md).

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
