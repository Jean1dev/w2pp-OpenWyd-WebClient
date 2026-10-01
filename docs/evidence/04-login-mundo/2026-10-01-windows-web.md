# Cliente Windows 7662 × cliente web — 01/10/2026

## Ambiente

- tm-server Railway `2e532af`, `ClientVersion=12000`.
- **Windows:** `wyd.exe` 7662 (`Client-aws`, carimbo `0x5594c797`) aberto pelo launcher `wyd-plataforma`, proxy `127.0.0.1:8281`. Música em 0 no `Config.bin` ([contorno](2026-10-01-windows-crash.md)).
- **Web:** `npm run dev` nesta máquina (gateway local), Chromium do operador.
- Execução manual pelo operador; log do tm-server consultado via Railway CLI e não versionado (contas e IPs). Os IPs no servidor aparecem como endereços internos do proxy Railway e não distinguem as sessões.

## Identificação das sessões

| Sessão | Como foi identificada | Conta e personagem |
|---|---|---|
| `conn=2` = Windows | `WYD.log`: `Init Field Scene::Start` às 13:14:53 (−03:00) = `character login request conn=2` às 16:14:53 UTC; sondagem do launcher (`connection sent no data`) às 16:14:29, antes da conexão | conta nova sem personagens; Huntress criada no slot 0 às 16:14:50 (`create char: OK`) |
| `conn=1` = web | entrada às 16:13:51 UTC, sem sondagem do launcher; operador confirmou `npm run dev` | conta principal do operador, personagem do slot 2 (classe 3) |

## Resultados

**Confirmado em execução** (log do tm-server, frames por `Header.ID`) e **confirmado pelo operador** (visual):

| Item | Resultado |
|---|---|
| Login, PIN, criação e entrada no Field (Windows) | `account login: OK`, `0x0FDE`, `0x020F` → `create char: OK`, `0x0213` → `CNFCharacterLogin`; `WYD.log` até `Init Field Scene::End`; sem falha no Windows (a última falha registrada segue sendo a das 12:59:21) |
| Ambos no mundo | 16:14:53–16:15:19 UTC |
| Movimento web → Windows | o Windows recebeu os 2 `0x036c` com ID 1; o operador viu o personagem web andar |
| Movimento Windows → web | o navegador recebeu os 4 `0x036c` e o `0x0366` com ID 2; o operador viu o personagem Windows andar |
| Chat Windows → web | `0x0333` com ID 2 repassado ao navegador |
| Despawn ao desconectar (web sai) | o navegador saiu às 16:15:19; o Windows recebeu `0x0165` com ID 1 |
| Saída do Windows | `0x03AE` (saída pelo menu), EOF às 16:15:26 |
| Erros | nenhum `version mismatch`, WARN além do `session out queue high` conhecido (rajada de entrada da sessão web, profundidade 32–36 de 64), ERROR ou panic |

## Não coberto

- **Relogin do Windows** com o web observando (fechar e reabrir o cliente Windows): o Windows saiu depois do web e não voltou. O despawn foi provado no sentido web → Windows, não no inverso.
- Comparação visual detalhada (nomes e equipamento quadro a quadro) e capturas: só a confirmação verbal do operador de que cada lado viu o outro andar.
