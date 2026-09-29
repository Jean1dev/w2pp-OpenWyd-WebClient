# Morte e respawn (etapa 5, fatia 2)

## Fluxo confirmado em fonte

**Cliente** (`TMFieldScene.cpp`, upstream `beb9f69b` + patches):

1. Com HP 0 ou `m_cDie == 1`, um clique esquerdo (`dwFlags 513`) no campo, fora da cidade, abre a caixa 11 (`g_pMessageStringTable[27]`, "voltar à cidade").
2. OK na caixa 11 envia `0x03AE` (`MSG_STANDARDPARM`, `Parm = 2`) e marca `m_cLastTown`.
3. 5 s depois o runtime envia `MSG_Recall` = `0x0289`, zera `m_cDie` e toca a animação de level up.

**Servidor** (`98286fdf`):

- `mobai.go` aplica o dano do mob e faz broadcast de `0x0367` com `Header.ID = IDScene`, que coloca a vítima em estado de morte no cliente.
- `mobDeathExpLoss` (`death_exp.go`): personagens mortais abaixo do nível 35 não perdem EXP (portão FREEEXP).
- `0x03AE` não tem rota e é apenas registrado.
- `0x0289` (`character.go` `restart`): `HP = 2`, `sendScore`, `sendSetHpMp`, `recall` para `CitySpawn(LastCity)` e `sendEtc`.

O dialeto já deixava passar `0x03AE` e `0x0289` com tamanho exato (ADR 004), e as respostas do servidor usam pacotes já traduzidos. Esta fatia não altera o dialeto.

## Cenário `death`

Fases `login,enter,second,death`, sem combinar com `attack` ou `mapchange` (`validateOptions`):

1. B fica no spawn de Armia.
2. A atravessa o portal para Armia Field (`2588,2096`, Trolls), sem atacar. Se nenhum mob agredir em 20 s, A caminha até o mob mais próximo com clique real.
3. Com A morto, um clique real no chão abre a caixa 11. OK é confirmado pelo export de automação já usado no portal. O harness registra os opcodes enviados até o recall.
4. `checkRespawn` exige:
   - morte com HP 0 causada por ataques do servidor, contados desde antes do portal;
   - caixa 11, `0x03AE` e `0x0289` enviados;
   - A de volta ao spawn de Armia, vivo, com HP válido;
   - nível e EXP inalterados abaixo do nível 35;
   - B vendo A de volta na cidade.
5. `world:checks` tem casos negativos para cada requisito e para as combinações de fases proibidas: 9 testes passaram.

## Execução 1: todo o fluxo ok, métrica do harness reprovou

**Confirmado em execução, falhou:** `2026-09-29T20:23:22Z`, [JSON sanitizado](2026-09-29-death-baseline-failed.json).

- A morreu (HP 0), a caixa 11 abriu e foram enviados `0x03AE` e depois `0x0289`.
- O servidor reviveu A com HP 2 em `2086.5,2102.5`, dentro do spawn de Armia; 3 s depois o HP já era 33 por regeneração.
- Nível 1 e EXP 548 inalterados. B viu A de volta. Nenhum descarte nas duas sessões.
- **Reprovou** em `death without a server attack on A` (`mobHits = 0`). Os Trolls mataram A durante a espera de 4 s de `toArmiaField` após o teleporte, antes da linha de base dos ataques. Isso repete a execução 1 do combate. **Correção:** linha de base e trilha de HP tomadas antes do portal.

## Execução 2: morte e respawn aprovados

**Confirmado em execução, aprovada (`ok: true`):** `2026-09-29T20:33:42Z` até `20:42:23Z`, [JSON sanitizado](2026-09-29-death-passed.json), [logs do Railway](2026-09-29-death-passed-server.txt). Rodou como processo separado. Fases `login` (21 s), `enter` (16 s), `second` (96 s), `death` (371 s).

- **Morte:** HP de A `[105, 0]` com 1 ataque do servidor recebido desde antes do portal. Sem aproximação: os Trolls agrediram primeiro.
- **Volta à cidade:** caixa 11 aberta pelo clique real no chão; enviados `0x03AE` e depois `0x0289`.
- **Servidor** (logs), com `0x0289` chegando 5,7 s depois de `0x03AE`, como o runtime programa:
  - `20:41:07` teleporte `2142,2070 → 2588,2096` (portal);
  - `20:41:46` `recv 0x03ae routed=false`;
  - `20:41:52` `recv 0x0289 routed=true` e teleporte `2588,2096 → 2095,2094`.
- **Depois do respawn:**
  - A em `2095.5,2094.5`, dentro do spawn de Armia;
  - primeiro HP após o recall 2 (valor do `restart`), 33 três segundos depois por regeneração;
  - `die = 0`, nível 1, EXP 548 inalterada (portão abaixo do nível 35).
- **B viu A de volta na cidade.** Nenhum descarte de entrada ou saída nas duas sessões, zero erros de página.

**Limites:**

- B não observou a morte em si: ficou na cidade, porque os Trolls também o matariam.
- O OK da caixa 11 usa o export de automação, como no portal; o clique que abre a caixa é real.
- Perda de EXP acima do nível 35 e morte em PvP não foram exercitadas.
