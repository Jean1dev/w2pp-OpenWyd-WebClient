# Etapa 5 — gameplay com servidor autoritativo

Estado: **Em andamento**. Primeira fatia: combate. Decisões na [ADR 004](../../decisions/004-combat-dialect.md).

Ambiente: Railway `tm-server` (commit do servidor `98286fdf…`, `ClientVersion=12000`), com as contas A e B de `.env`. Upstream `beb9f69b…` com os patches 0001–0012.

## Checklist por funcionalidade

| Funcionalidade | Estado | Prova |
|---|---|---|
| Dialeto `0367/039D/039E` (entrada/saída) | confirmado em teste e em execução | C++ com 435 verificações; overlay Go com `MsgAttackBody.Encode/Decode` reais (`attack_*`). Saída pelo tamanho (168/80/72 → N 13/2/1), opcode preservado: o corpo a corpo envia `0x039D` com 168 bytes |
| `0289` Restart, `0369` ReqMobByID, `03AE`, `0378` SetShortSkill (saída) | confirmado em teste | C++ (tamanho exato; tamanho errado é descartado) |
| `027B`/`0277` (saída), `017C` ShopList e `036A` Motion (entrada) | confirmado em teste e em execução | layouts idênticos, tamanho exato; [skills](2026-09-29-skills.md) |
| `5000` Exp_Msg_Panel_ (entrada) | diferido | customizado do servidor, sem handler no runtime; Exp chega pelo eco de ataque. Em `DEFERRED_INBOUND` |
| Ataque básico: A acerta um mob, B vê, relogin | **confirmado em execução** | [execução 7](2026-09-29-basic-combat.md#execução-7-combate-básico-e-relogin-aprovados): Gremlin HP 70→0, Exp 274→548, B vê o mesmo, relogin preserva equipamento/nível/Exp, protocolo limpo |
| Morte e respawn (`03AE` → `0289`) | **confirmado em execução** | [morte e respawn](2026-09-29-death-respawn.md): A morre para os Trolls (HP 105→0), caixa 11, `0x03AE`/`0x0289`, revive com HP 2 no spawn de Armia, EXP intacta, B vê A voltar |
| Skills: subir de nível e aprender | **confirmado em execução** (Foema) | [skills](2026-09-29-skills.md): 12 Gremlins até o nível 4; Flecha Mágica aprendida no mestre com cliques reais, pontos 12→0, preservada no relogin |
| Skills: usar em combate | **confirmado em execução** (Foema) | [skills](2026-09-29-skills.md#uso-da-skill-em-combate): Flecha Mágica na barra (Shift+1, `0x0378`), clique direito no Gremlin, MP 110→105 cobrado pelo servidor, HP 70→16 |
| Skills: Huntress (Golpe Felino) | **confirmado em execução** | [outras classes](2026-09-30-skills-classes.md): grind 1→6, aprendida no ForeLearner, usada: MP 110→100, HP 70→0 |
| Skills: Transknight, área (Giro da Fúria) | **confirmado em execução** (um alvo atingido) | [outras classes](2026-09-30-skills-classes.md): grind 1→8, aprendida no Cap.Cavaleiros, `0x0367` de 152 bytes (N=13) roteado, MP 112→97, HP 70→30. O dano em vários mobs no mesmo golpe não foi observado |
| Skills: BeastMaster (Fera Flamejante) | **confirmado em execução** | [outras classes](2026-09-30-skills-classes.md#beastmaster): grind 1→8, aprendida no Mestre_Archi, usada: MP 119→111, HP 70→1 |
| `0x02CB` MoveStop (saída) | diferido | sem rota no servidor (`routed=false`); `DEFERRED_OUTBOUND` na ADR 004 |
| Skills de buff e cura | pendente | exigem nível 11+ (BM) ou 16–20 (Foema) |
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

## Retomada de 29/09/2026 (tarde): combate chega ao servidor

Detalhes em [2026-09-29-basic-combat.md](2026-09-29-basic-combat.md). Critérios endurecidos: observador obrigatório, morte do atacante reprova, relogin pós-combate.

| Execução | Resultado | Causa / correção |
|---|---|---|
| 1 (portal) | falhou | A morreu entre Trolls antes do primeiro ataque. Rota trocada para os Gremlins da saída leste (geradores 27–30) |
| 2 | falhou | Cerca do portão leste. Rota pelo corredor y=2102, derivada de `HeightMap`/`AttributeMap` |
| 3 | falhou | Pick coberto por entidade abortava `walkTo`; agora tenta outro ponto |
| 4 | falhou | Rota ok; 19 `0x039D` de 168 bytes descartados (`outDropSize`). Dialeto passa a usar o tamanho |
| 5 | **dano e morte confirmados**, reprovou na saúde | `0x0378` descartado → passa com 32 bytes; `0x5000` → diferido |
| 6 | interrompida | Falta de memória na fase `second`, sem resultado ([issue #6](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/issues/6)) |
| 7 | **aprovada** | Processo separado; B fecha antes do relogin; memória amostrada por fase |

## Comandos

```powershell
npm run protocol:dialect      # 447 verificações
npm run protocol:vectors      # inclui TestExtDialect{Inbound,Outbound}/attack_*
npm run world:checks          # 12 testes (checkCombat, checkCombatRelogin, checkRespawn, checkGrind, checkLearn, checkCast com área, DEFERRED_INBOUND = {0x5000}, DEFERRED_OUTBOUND = {0x02cb})
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,attack
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,death
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,grind --class 1 --grind-level 4
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,learn --class 1
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,cast --class 1
# outras classes: --class 3 --grind-level 6 (HT), --class 0 --grind-level 8 (TK), --class 2 --grind-level 8 (BM)
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,grind --class 2 --grind-level 8
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,learn --class 2
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,cast --class 2
# rotas pelos mapas do servidor na revisão fixada (clone parcial que traz os blobs):
python tools/route_armia.py --git-dir ../start/external/server --from 2096,2097 --to 2077,2123
```
