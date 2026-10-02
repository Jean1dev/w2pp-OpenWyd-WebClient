# Login automático pela conta do portal (02/10/2026)

Decisão e desenho: [ADR 017](../../decisions/017-portal-auto-login.md). O PIN continua sendo pedido.

## Revisões

| Repositório | Branch | Commit |
|---|---|---|
| `w2pp-OpenWYD` | `Jean1dev/play-code` | `84272fc9` (base `origin/main` `3ae11009`) |
| `wyd-plataforma` | `Jean1dev/play-code` | `0d75da2` (base `origin/main` `329f5aa`) |
| este | `Jean1dev/auto-login` | empilhado sobre o #23 |

Toolchain:
- Go 1.25.13;
- emsdk 6.0.0;
- protoc 3.21.12 com protoc-gen-go v1.36.11 e protoc-gen-go-grpc v1.6.2, as mesmas versões dos arquivos gerados. Sem mudanças, a regeneração difere só em CRLF;
- Node 24.14.1, pnpm 10.7.0, Playwright 1.54.2;
- Docker 29.8.0.

## Confirmado em fonte

- **Campo de senha do cliente:** `MSG_AccountLogin.AccountPass[12]` é copiado por `sprintf_s` em `B_LOGIN_OK`, o que limita a 11 caracteres. O código tem 10.
- **Login no servidor:** o tmserver repassa a senha ao `dbserver AccountLogin` (`tmserver/internal/handler/login.go`, `dbclient.AccountLogin`); o protocolo não muda.
- **Exposição do `api-server`:** domínio público e proxy TCP, sem certificado de cliente. Confirmado na CLI do Railway, lendo só `RAILWAY_PUBLIC_DOMAIN` e `RAILWAY_TCP_PROXY_*`, e no `channel.ts` do portal. Registrado em Jean1dev/w2pp-OpenWYD#369.

## Confirmado em execução

### Testes unitários e de integração

| Comando | Resultado |
|---|---|
| servidor `go test ./internal/playcode/ ./dbserver/internal/grpcsrv/ ./webserver/internal/...` | ok (vetor Node da asserção, recusas, uso único, conta bloqueada, senha normal inalterada) |
| servidor `go test ./...` | ok, exceto `internal/npctemplate` e `dbserver/cmd/dbserver` (nomes de template sensíveis a maiúsculas no NTFS). **As mesmas falhas ocorrem no checkout do servidor sem estas mudanças** |
| servidor `go test -tags=integration -p 1 ./internal/store/` num Postgres 17 **separado** (porta 55432; os testes apagam as tabelas) | ok, inclusive `TestPlayCodeIssueAndConsume` e `TestPlayCodeCapAndBlocked` |
| portal `pnpm test` / `tsc --noEmit` / `pnpm lint` / `pnpm build` | 22/22 / ok / ok / ok |
| gateway `go test ./...` | ok (handoff de uso único, expiração, outra conta, `Origin`, nada no log, vetor Node do ticket com login) |
| `npm run loading:ui` | 52/52 (Chromium e Firefox, runtime falso) |

### Runtime e regressão contra o Railway

- **Runtime:** linkado com o patch 0026 (`tmproject_startup.1790975237082925400.wasm`). Ele exporta `wyd_selectserver_login` e `wyd_selectserver_auto`.
- **`npm run auto:server` contra o Railway:** 8/8. O Railway ainda não tem o código; a lista é pulada e o login continua manual.

### De ponta a ponta, só com a stack local (`npm run auto:login`)

| Componente | Configuração |
|---|---|
| servidor | `docker compose -p wydplaycode up` do worktree `play-code`, `W2PP_PLAY_CODE_SECRET` aleatório (só no scratchpad); `webserver serving … play_codes=true`; migração 0026 aplicada; tmserver em `:8281` com `client_version=12000` |
| portal | `next dev` local com `WEB_API_INSECURE=1`, `PLAY_TICKET_SECRET` e `PLAY_CODE_SECRET` gerados pelo teste |
| gateway e página | locais, `portalAuth` apontando para o portal local; "localhost" e "127.0.0.1" são sites diferentes, como o Vercel e o Railway |
| conta | `e2e…`, criada **só no banco local** pelo `/api/signup` do portal local |

Resultado: **9/9**, em `.cache/auto-login/results.json` e `auto-selchar.png`:
- **Fase auto:** cadastro → `/jogar` → a página pulou a lista e logou sozinha (`autoLogin: sent`).
  - O tmserver registrou `account login: OK … chars=0`, e a cliente recebeu `0x010A` (`Select Character`). A captura mostra a seleção de personagem com o teclado do PIN.
  - O handoff foi entregue uma vez, e a segunda leitura deu 204.
  - O código não aparece no `clientEvidence` nem no log do gateway.
- **Fase manual:** com o portal reiniciado sem `PLAY_CODE_SECRET`, o resultado foi `autoLogin: none`, e a página parou no painel de login, à espera da senha.

### Falha observada e investigada

Na primeira execução completa, a página enviou o login (o tmserver registrou `relaying to dbServer`), mas o tmserver devolveu `DeadlineExceeded` do dbserver depois de ~11 s.

Investigação:
- não havia sessões presas no Postgres;
- o dbserver respondia na rede do compose;
- uma sonda gRPC num container mediu o `AccountLogin` em 0,2–0,5 s, inclusive com um código inválido.

A execução seguinte passou, com o login em ~4 s.

**Hipótese, não confirmada:** o canal gRPC do tmserver foi criado ("dbServer wired" às 21:21:02.3) antes de o dbserver começar a servir (21:21:03.1). Somado à CPU do Docker disputada com o Chromium em renderização por software (avisos `slow world event` de até 791 ms), isso fez o primeiro login exceder o prazo. A ordem de boot do compose é anterior a esta mudança. Não foi alterada.

## Limitações

- **Navegadores:** só o Chromium no E2E com runtime real; o Firefox só no teste isolado.
- **Expiração do código:** coberta pelo teste de integração do store e pelo do gateway, não pelo E2E.
- **Produção:** o deploy ainda não foi feito. A ordem está na ADR 017: servidor e `W2PP_PLAY_CODE_SECRET`, portal e `PLAY_CODE_SECRET`, depois o cliente web.
