# Gate por conta do portal: testes locais (02/10/2026)

Decisão e desenho na [ADR 015](../../decisions/015-portal-account-gate.md).

Estado: **confirmado em teste e em execução local** (gateway e portal reais, por HTTP). **Não verificado:**
- deploy no Railway e no Vercel;
- login real pelo portal, que depende do `web-api` via gRPC, ausente nesta máquina;
- um navegador real.

## Toolchain

Go 1.25.13 baixado de `dl.google.com` para `.cache/toolchains/go` e conferido contra o SHA-256 do lock (`54a6bbff…`, `OK`). Portal com pnpm 10.7.0 e `pnpm install --frozen-lockfile`.

## Gateway (`gateway/`)

```text
go vet ./...      -> sem achados
go test ./...     -> ok config, ok relay
```

Casos novos:
- `TestNodeTicketVector`: vetor gerado com `node:crypto` aceito; recusado com o rótulo da sessão e com outro segredo.
- `TestPortalGateFlow`:
  - `/healthz` 200;
  - `/` e `/client.html` → 302 para `https://portal.example/jogar`;
  - `runtime.js`, `config.json` e WebSocket → 401;
  - ticket → 303 `/` com cookie `HttpOnly`, `SameSite=Lax`, `Path=/`;
  - com o cookie, página, `config.json` e WebSocket OK;
  - replay, cookie usado como ticket e ticket usado como cookie → 401.
- `TestPortalTicketRejects`: vazio, expirado, futuro, vida longa, `jti` curto, assinatura errada, sem assinatura, ponto extra, maior que 1 KiB, payload não JSON, sem `sub`; e `GET /auth/portal` → 405.
- `TestPortalSessionExpires`: cookie recusado após 13 h; `Secure` ausente só com `allowInsecure`.
- `TestPortalCookieSecureBehindTLS`: `Secure` com `tlsTerminatedByProxy`.
- `TestPortalReplayCacheIsBounded`: cache cheio é podado por expiração.
- `TestFromEnvPortalGate`: variáveis válidas; recusa junto com Basic, segredo curto ou ausente, URL ausente, `http`, com caminho ou com query; o segredo não vaza na mensagem.

## Portal (`wyd-plataforma`, branch `Jean1dev/jogar-no-navegador`)

```text
pnpm test       -> 17/17 (4 novos em src/lib/play-ticket.test.ts, incluindo o vetor do gateway)
pnpm lint       -> sem achados
pnpm typecheck  -> sem erros
pnpm build      -> ok; /jogar dinâmico (ƒ)
```

## Fluxo HTTP local entre os dois

Gateway compilado desta branch com `portalAuth` (segredo aleatório descartável) e `next start` do portal com o mesmo segredo e `WEBCLIENT_URL=http://127.0.0.1:18080`. O ticket foi emitido pelo próprio `issuePlayTicket` do portal (via `tsx`).

| Verificação | Resultado |
|---|---|
| portal `GET /jogar` sem sessão | 303 → `/?next=/jogar` |
| gateway `GET /healthz` | 200 |
| gateway `GET /` sem cookie | 302 → `http://localhost:13000/jogar` |
| gateway `runtime.js`, `config.json` sem cookie | 401, 401 |
| `POST /auth/portal` com ticket do portal | 303 → `/`, cookie `wyd_play` `HttpOnly` |
| `client.html`, `config.json` com cookie | 200, 200 (sem destino TCP) |
| reenvio do mesmo ticket | 401 |
| log do gateway | `auth: "portal"`; recusa `reason: "replayed"`, sem conteúdo do ticket |

## Próximo passo

Executar a troca descrita na ADR 015 e repetir no domínio público:
- o fluxo completo, com cadastro e login reais no portal;
- duas sessões e relogin no jogo;
- cookie expirado voltando ao portal;
- DevTools, para confirmar o ticket fora da URL e do histórico e o cookie `Secure`.
