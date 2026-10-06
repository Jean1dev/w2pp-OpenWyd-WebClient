# Sussurro e login duplicado: correção no servidor e linha de base (06/10/2026)

Decisão e desenho na [ADR 019](../../decisions/019-duplicate-login-and-whisper.md). Servidor: PRs [#374](https://github.com/Jean1dev/w2pp-OpenWYD/pull/374) e [#375](https://github.com/Jean1dev/w2pp-OpenWYD/pull/375), sem merge nem deploy.

## Servidor (confirmado em teste)

Clone de `origin/main` (`dbb3ad85`) em `.cache/server-src`, Go 1.25.13, Windows:

| Branch | Commit | Resultado |
|---|---|---|
| `webclient/whisper-sender` | `072c9049` | `TestWhisperRewrite` (8 casos) e `TestWhisperReply` ok; `go vet` limpo; `go test ./tmserver/internal/handler/ ./tmserver/internal/world/` ok |
| `webclient/duplicate-login` | `495d6199` | `login_duplicate_test.go` (4 testes) estável com `-count=10`; `go vet` limpo; `go test ./tmserver/...` com 17 pacotes ok |

Na primeira versão do #375, 24 testes de handler falharam porque punham dois jogadores com a mesma conta. Agora usam aliases `tester#N`, e o login tenta de novo quando recebe `0x011C`/`0x011D`. Não executados aqui: `-race` (sem cgo local) e `golangci-lint`; ficam para a CI.

## Linha de base na produção atual (confirmado em execução)

`node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,chat`, tm-server `dbb3ad85` **sem** as correções, runtime com o patch `0027-memo-probes`. JSON sanitizado em [`2026-10-06-whisper-baseline.json`](2026-10-06-whisper-baseline.json).

| Item | Observado | Esperado após o deploy |
|---|---|---|
| Fala pública, `/azran`, `/armia` | ok (B ouve; teleporte de 560 e 554 tiles) | igual |
| Sussurro A → B: memo de B | `"Mensagem enviada pelo jogador <B>. [hh:mm:ss]"` e `"siu wyd60907"` | remetente A e `"psiu wyd…"` inteiro |
| `/r` de B | não chega a A (o servidor procura um jogador "r") | chega a A, com B como remetente |
| Sussurro para quem está offline | `0x0102` traduzido | igual |

A fase reprovou na nova regra (`B shows the whisper as from receiver`), como esperado antes do deploy. Isso também confirma a hipótese da ADR 008: o nome do remetente fica no memo privado (`m_pHelpList[3]`), que os probes antigos não liam.

## Pendente

1. Merge e deploy dos #374 e #375 pelo operador.
2. No Railway, um processo por cenário: `--phases login,enter,second,chat` e `--phases login,enter,concurrent`.
3. Cliente Windows com o relay: sussurro web ↔ Windows e login duplicado entre os dois.
