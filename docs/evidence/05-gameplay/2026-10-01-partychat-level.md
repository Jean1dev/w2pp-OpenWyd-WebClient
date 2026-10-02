# Etapa 5: score após o #363, chat de grupo e nível inicial (01/10/2026, noite)

Ambiente:
- Railway `tm-server`, deploy `bb798b1b` (commit `052cd5fe`, merge do PR #363), `SUCCESS` às 22:16 UTC (`railway deployment list --json`); `ClientVersion=12000`;
- contas A e B de `.env`, um TK em cada conta;
- WASM `tmproject_startup.1790883428920400700`, pilha 0001–0022, sem rebuild nesta sessão.

Cada cenário rodou num processo separado:

```
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases <fases>
python tools/capture_world_logs.py --since <início> --until <fim> --out <arquivo>
```

Os JSONs e logs foram conferidos contra todos os valores do `.env`: nenhum aparece.

## Dano após o login com o #363 (`login,enter,second,equip`): **aprovado**

Execução 23:31–23:40 UTC; [JSON](2026-10-01-equip-after-363.json), [log do servidor](2026-10-01-equip-after-363-server.txt).

| | Nível (fio) | HP | MP | Dano | Defesa |
|---|---|---|---|---|---|
| HUD logo após o login | 6 | 120/120 | 110/110 | **28** | 37 |
| Sem a arma (slot 6, item 861) | | | | 26 | 37 |
| Com a arma de novo | | | | **28** | 37 |
| Prévia na seleção | 5 | 120/115 | 110/105 | — | — |

- Antes do #363, o dano logo após o login era o mesmo de sem a arma (21 → 23 ao reequipar, nas execuções de 01/10). Agora o login já mostra o dano com a arma. Isso fecha a questão em aberto da fatia A (**confirmado em execução**).
- B vê A tirar e pôr a arma; a poção arrastada para o slot da arma continua recusada localmente, sem pacote; relogin idêntico.
- A prévia da seleção traz o nível do fio menos 1 (5 vs 6), que é a divergência tratada no PR #365 ([ADR 013](../../decisions/013-party-chat-and-level-seed.md)). O `MaxHp` da prévia (115) é o persistido; o do mundo (120) é o calculado.

## Chat de grupo (`login,enter,second,partychat`): **lacuna do servidor confirmada em execução**

Execução 23:44–23:59 UTC, contra o `052cd5fe` (sem o PR #364); [JSON](2026-10-01-partychat-gap.json), [log do servidor](2026-10-01-partychat-gap-server.txt).

- O grupo foi formado pelos cliques originais (`0x037F`/`0x03AB` roteados).
- Cada linha `=texto` saiu como `0x0334` de 146 bytes no servidor (`MobName` vazio). Foram seis no log, de 23:51:56 a 23:57:42.
- Em todas, quem falou recebeu o aviso `0x0102` ("não conectado") e o outro não mostrou nada. É o comportamento previsto pela fonte: `messageWhisper` trata o nome vazio como destinatário.
- **Defeitos do harness revelados por esta execução, corrigidos e não validados online:**
  - **`partychat` saiu como `0x0334`.** Depois de uma linha `=`, a caixa de chat reabriu com o prefixo, e o comando virou `=partychat`. O harness agora apaga o conteúdo da caixa antes de digitar e usa o botão original `B_CHAT_PARTY` (65678), com o comando digitado só como alternativa.
  - **A saída do grupo (`475139`) não foi vista por A em 30 s.** A causa não foi identificada. O harness agora fecha a caixa de chat antes do clique, tira capturas e repete o clique uma vez.
- A correção do servidor está no PR [#364](https://github.com/Jean1dev/w2pp-OpenWYD/pull/364). A fase deve passar só depois do merge e do deploy.

## Nível seleção × mundo: **causa confirmada em fonte**, correção no PR #365

- O legado cria no nível 0, e os templates `BaseMob` têm `BaseScore.Level = 0` em @44. O cliente soma 1 nas duas telas.
- O Go cria no nível 1 e compensa só na seleção (`selCharWireLevel`).
- Nível e Exp seguem a mesma curva do legado, então só a semente diverge.
- Efeito colateral encontrado na fonte: `playerBaseAC` dá 1 de defesa a menos para todo personagem acima do nível 0.
- Detalhes e efeitos da migração na [ADR 013](../../decisions/013-party-chat-and-level-seed.md).

## Testes

- Servidor, PR #364: `go test ./tmserver/internal/handler/ -run 'PartyChat|Whisper|ChatPublic'` ok; cinco dos seis testes novos falham sem a correção. `go vet ./tmserver/...` limpo. `go test ./tmserver/...`: só `TestTransformExpiryRevertsMesh` falhou, e ele também falha no `052cd5fe` sem a mudança (3 de 5 execuções).
- Servidor, PR #365: testes do `tmserver` verdes e `go vet ./...` limpo. Falhas fora do escopo:
  - `dbserver/cmd/dbserver`, também no `main`;
  - `internal/npctemplate`, por causa do sistema de arquivos sem distinção de maiúsculas no Windows.

  A migração não foi executada num Postgres local.
- Cliente: `npm run world:checks` 34/0, com `checkPartyChat` e a regra da fase `partychat`.

## Não executado

- Buff e cura: adiados por decisão do usuário. As contas desta worktree têm só um TK cada. O mais barato é o Lobisomem da BM (33 pontos, nível 11); a cura da Foema custa 48 pontos (nível 16).
- `partychat` aprovado, que depende do merge e do deploy do #364.
- Reinício controlado (fatia 5).
