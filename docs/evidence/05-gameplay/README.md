# Etapa 5 — gameplay com servidor autoritativo

Estado: **Em andamento**. Primeira fatia: combate. Decisões na [ADR 004](../../decisions/004-combat-dialect.md).

Ambiente: Railway `tm-server` (commit do servidor `98286fdf…`, `ClientVersion=12000`), com as contas A e B de `.env`. Upstream `beb9f69b…` com os patches 0001–0012.

## Checklist por funcionalidade

| Funcionalidade | Estado | Prova |
|---|---|---|
| Dialeto `0367/039D/039E` (entrada/saída) | confirmado em teste | C++ com 429 verificações; overlay Go com `MsgAttackBody.Encode/Decode` reais (`attack_*`) |
| `0289` Restart, `0369` ReqMobByID, `03AE` (saída) | confirmado em teste | C++ (tamanho exato; tamanho errado é descartado) |
| Ataque básico: A acerta um mob, B vê | **pendente de execução** | cenário `attack` escrito; execuções abaixo |
| Morte e respawn (`03AE` → `0289`) | pendente | fluxo mapeado em fonte (`TMFieldScene.cpp:6218`, `16663`, `11928`) |
| Skills das quatro classes | pendente | `LearnedSkill` passa a ser registrado pelo cenário (export 0012); a máscara inicial vem dos templates de classe do conteúdo do servidor, ausentes do checkout |
| Inventário, drop, loja, banco, teleporte, chat, grupo, troca e persistência | pendente | fatias seguintes |

## Execuções de 29/09/2026 (cenário `login,enter,second,attack`)

Nenhuma chegou ao combate. Todas terminaram com saúde de protocolo limpa: nenhum descarte de entrada, nenhum erro de página.

1. **Prazo de 15 minutos:** A e B iam ao portal um depois do outro. Correção: os dois caminham em paralelo, e cenários com `attack` têm prazo de 25 minutos.
2. e 3. **B preso em 2117.5,2088.5**, reproduzido duas vezes. A captura `B-stall.png` mostra B dentro de um canteiro murado no caminho direto do spawn ao portal, com um `0x027B` descartado na saída (clique num NPC de loja ao tentar sair). Correções:
   - `walkToPortal` segue a rua ao sul, por pontos intermediários tirados de uma trilha bem-sucedida;
   - cliques que movem menos de 2 tiles entram numa lista de pontos a evitar.
4. **A parado a 7,6 tiles do portal.** A captura `A-stall.png` mostra um painel de quests aberto, só de UI local, sem pacote. Correções:
   - export `wyd_field_open_panels` (0012);
   - o harness fecha painéis com a tecla Esc real antes de clicar no mundo e registra `panelsClosed`;
   - raio de exclusão de 45 px.
5. **Interrompida pelo Claude Code** por falta de memória no sistema, durante o login de B. Não foi reiniciada automaticamente.

A mesma correção de caminhada vale para a fase `mapchange` da etapa 4, que falhou na suíte completa por esse motivo (ver `docs/evidence/04-login-mundo/`).

## Comandos

```powershell
npm run protocol:dialect      # 429 verificações
npm run protocol:vectors      # inclui TestExtDialect{Inbound,Outbound}/attack_*
npm run world:checks          # 7 testes (checkCombat, DEFERRED_INBOUND vazio)
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --env-file .env --phases login,enter,second,attack
```
