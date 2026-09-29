# ADR 003 — Dialeto no mundo, avisos do servidor e automação online

Data: 28/09/2026. Estado: **implementado; validação online parcial**. Detalhes em [evidências da etapa 4](../evidence/04-login-mundo/README.md).

## Contexto

Na etapa 3, o dialeto (ADR 002) cobria só a entrada: login, seleção, `CNFCharacterLogin`, `CreateMob` e `Action`. Tudo o que o tmserver envia quando o personagem entra no mundo era descartado. A sequência, confirmada em fonte (`handler/character.go:184-505`), é: `UpdateScore`, `SendAffect`, `PKInfo`, `CreateMobTrade` e, fora do login, `SetHpMp`, `SetHpDam`, `SendItem`, `UpdateEtc`, `UpdateEquip` e `UpdateWeather`. O prompt da etapa 4 proíbe avançar com HP, buffs ou equipamento corrompidos em silêncio.

Duas outras lacunas:

- **Aviso do servidor ignorado.** O `MSG_MessageBoxOk` (`0x102`) do servidor leva um código local de aviso (`handler/notice.go`, `iota`). O próprio servidor marca esse formato como placeholder. O cabeçalho usa `Header.ID = conn`, e o `TMScene` do runtime só exibe avisos com `ID == 0`. Com isso, senha errada, versão errada e conta bloqueada reabilitavam o painel sem dizer o motivo.
- **Criação e entrada não automatizáveis.** Criar personagem e entrar no mundo exigiam clicar no modelo 3D e no teclado de PIN embaralhado.

## Decisões

1. **Tradução por campo, com os mesmos princípios do ADR 002.**
   - **`UpdateScore`:** mesmo tamanho nos dois lados, cauda diferente.
     - `Level` `int32` → `short`; valor fora do intervalo recusa o pacote.
     - `CurrHp`/`CurrMp` do servidor ocupam `ReqHp`/`ReqMp` do runtime.
     - `Magic` `i32` → `u16`, com zero contado em overflow.
     - `Rsv` e `LearnedSkill` ficam **zero**, em vez de receber a peculiaridade `0xCC` da cauda.
   - **`SendAffect` → `MSG_UpdateAffect`:** o servidor envia `Type, Value u8, Level u16`; o runtime lê `Type, Level char, Value short`. `Level` acima de `char` vira 0 e é contado.
   - **`UpdateEquip`:** 16 → 18 slots.
   - **`CreateMobTrade`:** o mesmo leitor de `CreateMob` + `Desc[24]`. `Tab[26]` → `Nick` é **hipótese**.
   - **`SetHpDam`:** `Dam` `i32` → `short` com contagem de overflow.
   - **Passagem direta com tamanho exato:** `SetHpMp`, `SendItem`, `UpdateEtc`, `PKInfo` e `UpdateWeather`. Os layouts são idênticos e ficam fixados por `static_assert`. Em `UpdateEtc`, o `Magic` do servidor cai no padding do runtime; o sentido `Hold` → `FakeExp` é hipótese.
   - Chat e demais pacotes continuam descartados e contados. O fluxo roteirizado da etapa 3 passou a usar `0x333` como opcode "não mapeado".
2. **Avisos viram `MessagePanel`.** O dialeto traduz `0x102` em `0x101` com `ID 0` e um texto fixo em português, sem acentos, para os códigos 0–15 do `notice.go` no SHA fixado. Para os demais códigos, o texto é "Aviso do servidor (N)."
   - Não usamos a tabela de mensagens do cliente porque a correspondência entre código local e índice não está comprovada.
   - Se o servidor mudar a ordem do `iota`, o texto muda. A mudança é detectável pelo teste `notice_*` do overlay Go.
3. **Saída `ReqTeleport` `0x290` e `ChangeCity` `0x291`.** O runtime envia `StandardParm` de 16 bytes; o servidor lê só o cabeçalho e usa a posição autoritativa. Os dois passam com tamanho exato.
4. **Senha limpa após o envio.** O controle de senha da seleção de servidor é apagado logo depois do `AccountLogin`, e o buffer da função de depuração também (patch 0004). Uma recusa pede a senha de novo.
5. **Automação pelos controles originais** (patch 0004, exports `EMSCRIPTEN_KEEPALIVE`). As funções abaixo chamam `OnControlEvent` das cenas, o mesmo caminho de um clique. A cena monta e envia seus próprios pacotes; nenhuma export fabrica ou lê payload.
   - `wyd_debug_selchar_pin`: pressiona o teclado embaralhado pelos dígitos de `keybuf` e depois o botão de verificação.
   - `wyd_debug_selchar_open_create` e `wyd_debug_selchar_create`: o pick 3D da amostra de classe é substituído por `m_pTargetObject`.
   - `wyd_debug_selchar_enter`: a seleção de slot substitui o pick 3D.
   - `wyd_debug_scene_msgbox_ok`.
   - Exports de leitura: preview da seleção, painel de mensagem, caixa de mensagem e entidades do Field por id.

   O movimento no Field usa cliques reais de mouse; o ponto de destino é escolhido pelo pick de terreno do próprio runtime.

## Consequências

- `WydDialectInbound` produz no máximo 260 bytes, abaixo de `WYD_DIALECT_MAX_FRAME`.
- `tools/protocol/gen_fixtures.py` ganhou 15 fixtures. O overlay Go exige igualdade byte a byte com os encoders reais, e o teste C++ confere campo a campo (364 verificações).
- As funções `wyd_debug_*` ficam no build de depuração. Antes de uma entrega pública (etapa 8), elas devem ficar atrás de uma flag de build.

## Revisão — 29/09/2026

- **Descartes adiados nas verificações da etapa 4.** A política desta ADR não muda: pacotes não mapeados continuam descartados e contados. Mesmo assim, `checkHealth` (`tools/world_checks.mjs`) passou a tolerar os opcodes de `DEFERRED_INBOUND`, hoje só `0x0367` (combate, etapa 5). A tolerância vale apenas como `inDropUnknown` e até a contagem desses opcodes. Qualquer outro descarte de entrada, qualquer descarte de saída e descartes por tamanho/faixa continuam reprovando. Motivo: o Armia Field transmite combate de mobs, o que tornaria a troca de mapa impossível de aprovar sem mapear gameplay antes da hora. Ao traduzir `0x0367` na etapa 5, o opcode sai da lista.
- **Novos exports só de leitura:** classe do protocolo (0007), entidade sob o cursor (0008) e bloco de terreno carregado (0009). `_wyd_field_map_x/y` lê `HomeTownX/Y` e **não** indica o mapa atual.
- **Defeito corrigido (patch 0011):** `wyd_debug_selchar_open_create` acionava o controle 5673, que na seleção abre a confirmação de "Voltar". Agora aciona o 4613 ("Criar", `VisibleSelectCreate(0)`). A criação automatizada nunca dependeu dele, porque aperta 1545 direto. **Confirmado em execução:** a vista de criação abre pelo export, com a câmera nas quatro amostras.
