# Skills das outras classes (etapa 5): Huntress, Transknight (área) e BeastMaster

Continuação de [skills da Foema](2026-09-29-skills.md). Decisões do usuário em 29/09:

1. Subir de nível, por combate real, os personagens das classes 0, 2 e 3 da conta A. A alteração é permanente.
2. Transknight usa Giro da Fúria (área) em vez de Carga.

Ambiente: Railway `tm-server` (servidor `98286fdf…`, `ClientVersion=12000`), upstream `beb9f69b…` com os patches 0001–0016. O runtime não foi religado nesta sessão: `tmproject_startup.1790719644704247800.wasm`, SHA-256 `ab36af77…eac4bb`, o mesmo do [cast da Foema](2026-09-29-skills.md#uso-da-skill-em-combate). Horários em UTC. Cada cenário rodou num processo separado ([issue #6](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/issues/6)).

## Fatos confirmados em fonte (`98286fdf`)

- Pontos = nível × 3 − custo (`skill.go` `deriveSkillBonus`). Os requisitos de `ItemList` estão zerados, então só os pontos limitam o aprendizado.
- Skill escolhida por classe (`SkillData.csv`: `idx, SkillPoint, TargetType, ManaSpent, …, Range`):

  | Classe | Skill | idx / bit | Item | Custo | Nível | TargetType | MP | Alcance |
  |---|---|---|---|---|---|---|---|---|
  | TK (0) | Giro da Fúria | 0 / 0 | 5000 | 24 | 8 | 3 (área) | 15 | 5 |
  | BM (2) | Fera Flamejante | 48 / 0 | 5048 | 24 | 8 | 1 | 8 | 6 |
  | HT (3) | Golpe Felino | 80 / 8 | 5080 | 18 | 6 | 1 | 10 | 2 |

- **Mestres.** Os NPCs de `Release/TMsrv/run/npc` com `Merchant 19` e as 24 skills de uma classe são:
  - `Cap.Cavaleiros` (TK, blob `1bc48f31`);
  - `Foema_Ancian` (FM, `8d35238d`);
  - `Mestre_Archi` (BM, `5d408764`);
  - `ForeLearner` (HT, `9cc4c79c`).

  Todos ficam em Armia pelo `NPCGener.txt`: Cap.Cavaleiros em 2144,2120, Mestre_Archi em 2077,2123 e ForeLearner em 2130,2125. `Knight_Leader` também vende as skills da TK, mas não é gerado em Armia.
- `Mestre_Haby` (2148,2068) é `Merchant 31` e não ensina skills. A primeira hipótese do plano (Archi, Grifo, Haby) estava errada e foi corrigida pela leitura dos NPCs.
- Os blobs foram lidos do clone parcial em `../start/external/server`, que traz os objetos sob demanda. O checkout deste worktree não tem esses blobs.
- **Área:** `SkillUse` junta os alvos próximos num `MSG_Attack` para TargetType 3 (`TMFieldScene.cpp:8715`, `9144-9161`). O servidor valida cada alvo contra `Range` e `MaxTarget` (`combat.go` `validateSkillTarget`).
- **`0x02CB`:** é o MoveStop do runtime, enviado antes de um golpe comum dado em movimento (`TMFieldScene.cpp:11600`, `SkillIndex -1`). O servidor não tem rota para ele: `dispatch.go` registra `routed=false` e ignora.

## Mudanças

- `tools/verify_world.mjs`:
  - **learn:** mestres e planos das classes 0, 2 e 3. A descoberta registra o que cada candidato oferece e segue para o próximo se o NPC for de outra classe. Uma caixa aberta por um NPC que não é mestre é cancelada com Esc, nunca com OK. A caixa do portal (16) também é cancelada. O estado parcial fica em `r.learn`.
  - **cast:** planos das quatro classes com alcance. O harness se aproxima do alvo até o alcance e, para área, escolhe um Gremlin com vizinho a ≤ 3 tiles e registra `nearby` e `hitMobs`, conferidos pelo HP do servidor.
- `tools/world_checks.mjs`:
  - `checkCast` com área: o alvo precisa estar entre os atingidos, e os atingidos não podem ser mais que os mobs no alcance;
  - `DEFERRED_OUTBOUND = {0x02cb}` em `checkHealth`: qualquer outro descarte de saída continua reprovando.
- `tools/world_checks.test.mjs`: casos da HT (bit 8), da área e de saída diferida, com os casos negativos correspondentes. `world:checks` 12/0.
- `tools/route_armia.py` (novo): rotas pelo `HeightMap`/`AttributeMap` na revisão fixada, assado como `route.Bake`, com busca 8-direcional e passo de altura < 8. Validado contra a rota já provada dos Gremlins (corredor y≈2101).

Dialeto, patches e WASM ficaram sem mudança.

## Execuções no Railway

| Execução | Resultado | Detalhe |
|---|---|---|
| HT grind (`01:01`) | **aprovada** | Nível 1→6 em 24 Gremlins pagos pelo servidor, EXP 0→4469, sem descanso nem morte, 14 min. [JSON](2026-09-30-ht-grind-passed.json) |
| HT learn 1 (`01:15`) e 2 (`01:30`) | falharam | Mestre_Haby (Merchant 31): o clique abre a caixa "Deseja continuar?", sem `0x027B`, e a caixa bloqueou os cliques seguintes. Levou à leitura dos NPCs e à correção dos mestres. [JSON](2026-09-30-ht-learn-haby-failed.json) |
| **HT learn 3 (`02:31`)** | **fase aprovada** | ForeLearner 12476: `0x027B` → `shop opened npc=12476 merchant=19`, lista 5072..5095, caixa 4, `0x0277` → `skill learned skill=80 cost=18 rest=0`. Bit 8 e 0 pontos no relogin. O veredito geral saiu `false` por um defeito do harness (entradas sem `ok` em `results`), corrigido. A skill já aprendida impede repetir a fase. [JSON](2026-09-30-ht-learn-passed.json), [logs](2026-09-30-ht-learn-passed-server.txt) |
| **HT cast (`02:36`)** | **aprovada** | Célula 8 = 5080; barra[0] = 80 por Shift+1 (`0x0378`); slot 0. Um clique direito: MP 110→100, Gremlin HP 70→0. Servidor: `recv 0x0378 len=20`, `recv 0x039d len=56` (1 alvo). [JSON](2026-09-30-ht-cast-passed.json), [logs](2026-09-30-ht-cast-passed-server.txt) |
| TK grind (`02:44`) | nível atingido; reprovou na saúde | Nível 1→8 em 49 Gremlins, EXP 548→6726, sem morte (`checkGrind` passa). Um `0x02CB` descartado na saída, que nunca chegou ao servidor (zero ocorrências nos logs). Decisão: diferido e documentado, não traduzido. [JSON](2026-09-30-tk-grind-movestop-failed.json) |
| TK learn 1 (`03:06`) | falhou | O caminho mais curto pelo mapa raspa a borda de um canteiro elevado (x 2115..2120, y 2099..2104). A TK entrou nele em 2119,2103 e o roteamento do cliente não saiu. A rota passou a contornar pelo sul. [JSON](2026-09-30-tk-learn-planter-failed.json) |
| **TK learn 2 (`03:11`)** | **aprovada** | Cap.Cavaleiros 12467: lista 5000..5023, `skill learned skill=0 cost=24 rest=0`, bit 0 e 0 pontos no relogin. [JSON](2026-09-30-tk-learn-passed.json), [logs](2026-09-30-tk-learn-passed-server.txt) |
| **TK cast (`03:18`)** | **aprovada** | Célula 0 = 5000, barra[0] = 0, `0x0378`. Um clique direito: MP 112→97 (ManaSpent 15), alvo HP 70→30. Servidor: `recv 0x0367 len=152 routed=true`, o `MSG_Attack` de 13 alvos (48 + 8×13), formato de área. Dois Gremlins no raio de 7 tiles, um atingido. [JSON](2026-09-30-tk-cast-passed.json), [logs](2026-09-30-tk-cast-passed-server.txt) |

## Limitações

- **Área.** O pacote de área saiu e foi aceito, mas o dano em mais de um mob no mesmo golpe não foi observado. O segundo Gremlin estava no raio registrado (≤ 7 tiles), mas não se sabe se estava no raio de coleta do cliente nem no `Range` 5 do servidor. Hipótese não verificada: o cliente só inclui alvos muito próximos.
- **Buff e cura** continuam pendentes. As mais baratas exigem nível 11 (BM Evocar Condor, 33 pontos) ou 16 a 20 (Foema Cura, 48 pontos, somados aos 12 já gastos).
- **Durante o learn 3 da HT**, um clique de caminhada abriu por engano a loja de um mercador comum (`shop opened npc=12531 merchant=1`), mesmo com a verificação de hover do harness. Não houve compra nem efeito no personagem.
- **Os personagens da conta A foram alterados**: HT nível 6 com Golpe Felino, TK nível 8 com Giro da Fúria e BM nível 8 com Fera Flamejante.
- Não houve comparação visual com o cliente Windows.

## BeastMaster

A primeira tentativa (`03:26`) foi interrompida pelo Claude Code por falta de memória no sistema, logo depois do login e antes do primeiro abate. Depois disso havia 724 MiB livres e nenhum processo do harness restante. O usuário pediu para rodar de novo, e a nova execução começou com 1736 MiB livres.

| Execução | Resultado | Detalhe |
|---|---|---|
| **BM grind (`10:35`)** | **aprovada** | Nível 1→8 em 51 Gremlins pagos pelo servidor, EXP 0→6726, sem descanso nem morte, 22 min. Protocolo limpo (só os 51 `0x5000` diferidos). [JSON](2026-09-30-bm-grind-passed.json) |
| **BM learn (`10:58`)** | **aprovada** | Mestre_Archi 12500: lista 5048..5071, caixa 4, `0x0277` → `skill learned skill=48 cost=24 rest=0`, bit 0 e 0 pontos no relogin. Dois `0x027B` → `shop opened` no mesmo NPC, porque o harness clicou de novo enquanto a janela ainda não tinha aparecido. [JSON](2026-09-30-bm-learn-passed.json), [logs](2026-09-30-bm-learn-passed-server.txt) |
| **BM cast (`11:03`)** | **aprovada** | Célula 0 = 5048, barra[0] = 48 por Shift+1 (`0x0378`), slot 0. Um clique direito: MP 119→111 (ManaSpent 8), Gremlin HP 70→1. Servidor: `recv 0x0378 len=20`, `recv 0x039d len=56` (1 alvo). [JSON](2026-09-30-bm-cast-passed.json), [logs](2026-09-30-bm-cast-passed-server.txt) |

Com isso, as quatro classes têm uma skill aprendida no mestre e usada em combate contra o servidor real.
