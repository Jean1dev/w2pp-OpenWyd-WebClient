# Etapa 5 — gameplay com servidor autoritativo

Estado: **Em andamento**. Primeira fatia: combate. Decisões na [ADR 004](../../decisions/004-combat-dialect.md).

Ambiente: Railway `tm-server` (commit do servidor `98286fdf…`, `ClientVersion=12000`), com as contas A e B de `.env`. Upstream `beb9f69b…` com os patches 0001–0018 (0018 em 30/09: probes de loja, banco e chat).

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
| Skills: Transknight, área em dois alvos no mesmo golpe | **confirmado em execução** | [área múltipla](2026-09-30-area-multiple.md#prova-de-área--aprovada): um `0x0367` com alvos 1037/1035, resposta autoritativa com dano 40 em ambos recebida igual por A e B, HP 70→30 nas duas sessões, MP 112→97, relogin preservado |
| Skills: BeastMaster (Fera Flamejante) | **confirmado em execução** | [outras classes](2026-09-30-skills-classes.md#beastmaster): grind 1→8, aprendida no Mestre_Archi, usada: MP 119→111, HP 70→1 |
| `0x02CB` MoveStop (saída) | diferido | sem rota no servidor (`routed=false`); `DEFERRED_OUTBOUND` na ADR 004 |
| Skills de buff e cura | pendente | exigem nível 11+ (BM) ou 16–20 (Foema) |
| Dialeto de itens `0376` (C↔S), `0373` (36↔34), `0185` | confirmado em teste e em execução | C++ com 496 verificações; overlay Go com `MsgTradingItemBody`/`MsgUseItemBody` reais ([ADR 007](../../decisions/007-inventory-dialect.md)) |
| Equipar/desequipar com B observando, score recalculado, relogin | **confirmado em execução** | [inventário](2026-09-30-inventory.md#equipar-e-desequipar--aprovado-railway): arma 861 equip 6 ↔ carry 13 por cliques reais, B vê `look` 863→0→863, Damage do servidor 28→30 com a arma, relogin idêntico |
| Movimento impossível (poção no slot da arma) | **confirmado em execução** | o runtime recusa localmente, sem pacote; o estado não muda |
| Score do login = template BaseMob | divergência do servidor (confirmada em fonte) | [inventário](2026-09-30-inventory.md#primeira-execução-reprovada-pela-regra-não-pelo-cliente); proposta: `sendScore` depois do login |
| Poção (uso, clique repetido, célula vazia, B vê a cura, relogin) | **confirmado em execução** | [inventário](2026-09-30-inventory.md#poção--aprovada-railway-execução-8): respawn com HP 41, uso com HP 80 → 130, 117→116 pelo servidor, B vê 130, clique duplo consome 2 (→114), célula vazia não envia nada, relogin idêntico; três `0x0373` no log do servidor |
| Loot dos Gremlins no carry, relogin | **confirmado em execução** | [inventário](2026-09-30-inventory.md#loot--aprovado-railway-sem-ouro-por-defeito-do-servidor): 25 abates, 8 itens nos slots 13–20 via `0x0182`, relogin idêntico |
| Ouro dos mobs (`0x0337`) | **bloqueado pelo servidor** (confirmado em fonte e em execução) | `SpawnMobAt` não copia o `Coin` do template, então `GoldDrop` sempre dá 0; 0 de ouro em 25 abates |
| Drop e coleta no chão | **bloqueado pelo servidor** | sem `0x026E`, CNF placeholder de 16 bytes, sem decay; proposta na ADR 007 |
| Dialeto `0379/037A/0387/0388/0339/0333/0334` | confirmado em teste e em execução | C++ com 545 verificações; overlay Go com os encoders reais ([ADR 008](../../decisions/008-shop-cargo-chat-dialect.md)); no Railway, corpo de 128 no `0x0333` e de 146 no `0x0334` (padding não enviado) |
| Loja NPC: vender, comprar, recusa sem ouro, clique repetido, relogin | **confirmado em execução** | [fatia 3](2026-09-30-shop-bank-chat.md#loja-aki-merchant-1--aprovada-execução-2): `sell ok gain=75`, `buy ok price=300`, `buy denied` sem mudança, `buy resync` sem duplicar, relogin idêntico |
| Clique segurado na loja | comportamento original (confirmado em fonte e em execução) | 513 por nível a cada quadro + trava de 500 ms: dois quadros segurados compram duas vezes, e as duas são cobradas |
| Banco: item de ida e volta, depósito, saque, saque e depósito acima do saldo, relogin | **confirmado em execução** | [fatia 3](2026-09-30-shop-bank-chat.md#banco-guarda-carga-merchant-2--aprovado-execução-3): `0x0376` nos dois sentidos, `cargo deposit/withdraw` de 100 conferidos com o `0x0339` do cliente, recusas sem mudança |
| `0x0339` ouro do banco @12 | **confirmado em execução** | 74 de ouro guardados sobrevivem ao relogin, iguais ao log `cargo deposit`/`withdraw` ([fatia A](2026-10-01-slice-a.md#ouro-guardado-no-banco-entre-sessões-loginenterbank-aprovado)) |
| Chat: fala vista por B, sussurro recebido, sussurro para offline | **confirmado em execução** | [fatia 3](2026-09-30-shop-bank-chat.md#chat-e-teleporte--aprovados-execução-2): B mostra a fala; o sussurro chega sem o 1º caractere (runtime); offline → `0x0102` |
| Sussurro com o nome do remetente | lacuna do servidor (confirmada em fonte, não observada) | `chat.go:71` repassa `MobName` = destinatário ([ADR 008](../../decisions/008-shop-cargo-chat-dialect.md)) |
| Teleporte: portal (etapa 4) e comandos `/azran` e `/armia` | **confirmado em execução** | `chat command` + `teleport` no log; B deixa de ver A e volta a vê-la |
| Teleporte pago (portal Armia → Noatum, 700) | **confirmado em execução** | cobra exatamente 700 e leva a Noatum; com 500 de ouro, `0x0290` sem teleporte e sem cobrança; o relogin mantém só a cobrança ([fatia A](2026-10-01-slice-a.md#teleporte-pago-armia--noatum-loginenterpaidteleport-aprovado)) |
| Chat de grupo/guilda | pendente | não exercitado |
| Venda de item sem preço | comportamento do servidor (confirmado em fonte e em execução) | o item 4144 tem `Price` 0 e rende `price/4 = 0`; o harness vende só item com preço ≥ 4 ([fatia A](2026-10-01-slice-a.md#venda-loginentershop-aprovada)) |
| Grupo | aprovado | recusa, aceite, clique repetido, saída, expulsão, desconexão de membro e de líder, e relogin com inventário preservado; execução 6 no Railway ([fatia 4](2026-09-30-party.md)) |
| Troca | **confirmado em execução** | recusa, oferta encaminhada, reset das confirmações por mudança de ouro, troca de item e ouro, relogin, cancelamento (`0x0384`) e troca de volta; servidor `2e532afa` com o PR #358 ([fatia 4, troca](2026-10-01-trade.md)) |
| Troca: bolsa cheia e desconexão no meio | **confirmado em execução** | o servidor desfaz a troca sem mover nada (aviso 31); a desconexão de A fecha a janela de B sem mudança; limpeza da fase incompleta por prazo ([fatia A](2026-10-01-slice-a.md#casos-de-troca-loginentersecondtradeedge)) |
| Persistência após reinício | pendente | fatia 5 |

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
npm run protocol:dialect      # 496 verificações
npm run protocol:vectors      # inclui TestExtDialect{Inbound,Outbound}/attack_*
npm run world:checks          # 21 testes (checkCombat, checkCombatRelogin, checkRespawn, checkGrind, checkLearn, checkCast com área, DEFERRED_INBOUND = {0x5000}, DEFERRED_OUTBOUND = {0x02cb})
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
# fatia 2 (itens): uma fase por processo
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,equip --class 0
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,potion --class 0
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,loot --class 0
python tools/route_armia.py --git-dir ../start/external/server --from 2096,2097 --to 2077,2123
```
