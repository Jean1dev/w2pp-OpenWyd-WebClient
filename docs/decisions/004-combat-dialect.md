# ADR 004 — Dialeto de combate (`MSG_Attack`)

Data: 29/09/2026. Estado: **implementado; validação online em [evidências da etapa 5](../evidence/05-gameplay/README.md)**.

## Contexto

A etapa 5 começa pelo combate. Até aqui, o dialeto descartava o `0x0367` e `checkHealth` o tolerava como `DEFERRED_INBOUND` (revisão da ADR 003). O runtime e o servidor usam três opcodes para o mesmo pacote (`0x0367` multi, `0x039D` um alvo, `0x039E` dois alvos), mas os layouts divergem. Confirmado em fonte:

| Offset | Servidor (`protocol/messages.go` `MsgAttackBody`) | Runtime (`Basedef.h` `MSG_Attack`) |
|---|---|---|
| 12 | — (zero) | `FakeExp` i32 |
| 16 | `CurrentHp` i32 do atacante | `ReqMp` i32 |
| 20..23 | — | padding (`CurrentExp` alinhado a 8) |
| 24 | `CurrentExp` i64 | `CurrentExp` i64 |
| 32 | — (eco do cliente) | `Rsv` short |
| 34..45 | `PosX`, `PosY`, `TargetX`, `TargetY`, `AttackerID`, `Progress` u16 | idem |
| 46 / 48 | `Motion` / `DoubleCritical` | idem |
| 47 / 49 | — (eco do cliente) | `FlagLocal` / `SkillParm` |
| 52 / 56 | `CurrentMp` i32 / `SkillIndex` i16 | idem |
| 58 | `ReqMp` i16 | padding |
| 60 + 8i | `Dam[i]` = `{TargetID i32, Damage i32}` | `{TargetID u16, pad, Damage i32}` |
| tamanho | 60 + 8N, N = comprimento/8, no máximo 13 | 168 / 72 / 80 fixos por opcode |

Comportamento do servidor que afeta a tradução (`handler/combat.go`):

- decide o dano e sobrescreve, no pacote do próprio cliente, os campos `Dam[].Damage`, HP, Exp, MP e `ReqMp`;
- responde sempre com `0x0367` e `Header.ID = 30000`, com o **mesmo comprimento** da requisição, para o atacante e para quem está no campo de visão;
- os ataques de mob (`mobai.go`) usam o mesmo pacote com N = 1 e `SkillIndex = 0`;
- o combate corpo a corpo não passa pelo caminho de skill (sentinela −2), e as skills usam −1.

O runtime (`TMFieldScene::OnPacketAttack`) lê `ReqMp@16` e, quando ele próprio é o alvo e o atacante tem id > 1000, subtrai esse valor do próprio MP. Se `@16` passasse direto, o HP do atacante seria descontado do MP de quem apanha.

## Decisão

1. **Entrada (`InAttack`)** — valida `comprimento = 60 + 8N`, com 1 ≤ N ≤ capacidade do opcode (13/1/2). Qualquer outro comprimento é descartado e contado como `inDropSize`.
   - Monta a struct do runtime correspondente ao opcode, zerada, e copia campo a campo.
   - `ReqMp` ← `i16@58`, ampliado.
   - `FakeExp` ← 0; bytes não nulos em `@12` são contados em `unmappedNonZero`.
   - O `CurrentHp` do atacante não é copiado, porque o runtime não tem campo para ele.
   - `TargetID` é estreitado para u16. Valor fora da faixa vira 0 e é contado em `fieldZeroed`.
   - `Rsv`, `FlagLocal` e `SkillParm` são copiados como vieram, pois são o eco dos bytes do próprio cliente.
2. **Saída** — cada opcode exige o tamanho exato do runtime (168/72/80) e é reescrito como 60 + 8N, com N igual à capacidade do opcode.
   - Todos os campos são gravados por offset. O padding nunca sai, porque no servidor o `TargetID` é i32 e absorveria esse lixo.
   - `@16` e `@58` saem zerados: o `ReqMp` do runtime não é entrada do servidor, que usa o próprio.
3. **Pacotes vizinhos com tamanho exato** (saída):
   - `0x0289` Restart: só cabeçalho.
   - `0x0369` ReqMobByID: `StandardParm`. O runtime pede o `CreateMob` de um atacante desconhecido.
   - `0x03AE`: `StandardParm` que o runtime envia ao confirmar a caixa "voltar à cidade" (mensagem 11) antes do Restart. O servidor não tem rota para ele e só registra `routed=false`, como faria com o cliente Windows. Descartá-lo apenas marcaria a sessão como rejeitada, sem proteger nada.
4. **Contadores novos:** `WYD_STAT_IN_ATTACK` e `WYD_STAT_OUT_ATTACK`, expostos em `clientProbe().dialect.inAttack/outAttack`, para que a evidência não dependa de contagens genéricas.
5. **`0x0367` sai de `DEFERRED_INBOUND`**, que fica vazio. `checkHealth` recebe a lista como parâmetro só para o teste do mecanismo.
6. **Automação** (patch 0012): somente exports de leitura.
   - HP, morte e posição na tela de uma entidade; entidade sob o cursor; enumeração por id; HP/MP/nível/gold/Exp próprios.
   - O ataque é um clique real do mouse, dado depois que o pick do runtime confirma o alvo sob o cursor.

## Consequências

- Nada no navegador calcula dano, Exp ou gold. O HP exibido do alvo é o do `CreateMob`, menos os `Dam[]` que o servidor enviou.
- Um eco de N = 1 chega como `0x0367` e é expandido para a struct de 13 alvos, com os restantes zerados. `GetHumanByID(0)` retorna nulo, então o runtime ignora as entradas vazias.
- **Hipótese:** mobs atacam com `SkillIndex = 0` (e não −1), o que faz o runtime tratar o golpe como a skill 0 para efeitos visuais. É comportamento do servidor fixado e fica registrado, sem ser corrigido no dialeto.
- **Defeito do upstream, não corrigido:** `TMFieldScene.cpp:21481` usa `=` em vez de `==` no ramo de atacante desconhecido. O efeito é pedir `0x0369` para o atacante, que agora passa.
- Vetores: 5 fixtures de entrada (eco de um alvo, 13 alvos com miss −3, golpe de mob, `TargetID` fora da faixa, N = 14) e 2 de saída. O overlay Go reconstrói os fixtures com `MsgAttackBody.Encode` e decodifica a saída com `Decode`. O teste C++ cobre N = 0, meia entrada, capacidades por opcode e padding 0xAB.

## Retomada de 29/09/2026 — aceitação do cenário

O cenário exige B como observador do mesmo alvo, broadcast recebido e dano observado. Morte do atacante não pula a validação; entidade desaparecida não equivale a morte confirmada. Após aprovação, A reconecta e compara equipamento e progressão com o estado recebido do servidor. A fase `attack` inclui essa conferência e não cria personagem ausente de B.

A execução pelo portal para `2588,2096` encontrou Trolls e A morreu antes do primeiro ataque. O percurso de combate passa à saída leste de Armia, buscando `Gremlin` dos geradores 27–30 do `NPCGener.txt` fixado. `mapchange` conserva o roteiro de portal. Não há alteração no dialeto, no gateway nem no servidor. Resultados e limites na [evidência da retomada](../evidence/05-gameplay/2026-09-29-basic-combat.md).

## Revisão de 29/09/2026 — tamanho, não opcode

A execução 4 no Railway descartou 19 `0x039D` com 168 bytes. **Confirmado em fonte:** o corpo a corpo do runtime (`TMHuman.cpp`) envia `0x039D` com `sizeof(MSG_Attack)`, e `MsgAttackBody.Decode` ignora o opcode e deriva N do comprimento. A decisão 2 passa a ser: a struct do runtime e N vêm do tamanho recebido (168/80/72 → 13/2/1), o opcode é preservado, e qualquer outro tamanho é descartado como `outDropSize`. A entrada não muda, porque o servidor sempre responde `0x0367` com o comprimento da requisição. Detalhes em [evidência](../evidence/05-gameplay/2026-09-29-basic-combat.md).

Na execução 5, o dano e a morte foram confirmados por A e B. Surgiram dois opcodes ligados ao combate:

- `0x0378` `SetShortSkill` (C→S): layout idêntico (`Skill[20]`), passa com tamanho exato 32.
- `0x5000` `Exp_Msg_Panel_` (S→C): customizado do servidor, sem handler no runtime. Fica diferido em `checkHealth`, e a experiência continua vindo do eco de ataque.
