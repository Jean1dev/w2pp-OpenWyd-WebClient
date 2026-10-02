# ADR 015: acesso ao cliente web pela conta do portal

Data: 02/10/2026. Estado: **implantado em 02/10/2026.** Portal [#34](https://github.com/Jean1dev/wyd-plataforma/pull/34) (`329f5aa`) e gateway [#19](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/pull/19) (`82f3850`, deploy `3504ab4c`); `WYD_BASIC_AUTH_*` removidas do Railway. O gate está **confirmado em execução** no domínio público com um ticket assinado com o segredo do Railway ([evidência](../evidence/08-entrega/2026-10-02-portal-gate.md#produção-02102026)). **Pendente:** um ticket emitido pelo próprio Vercel após um login real, porque o valor *Sensitive* não pode ser lido de volta.

## Contexto

O deploy da [ADR 005](005-railway-deploy-and-ci.md) protege todas as rotas com uma única credencial Basic. O navegador mostra um prompt de usuário e senha antes do jogo. Com outros jogadores entrando, essa senha compartilhada não escala e não serve para cadastro.

O cadastro e o login de contas já existem no portal (`wyd-plataforma`, Next.js no Vercel, `wyd-ten.vercel.app`): `POST /api/signup`, `POST /api/login` e a sessão `iron-session` (`wyd_session`).

## Decisão do operador

Abrir o cliente totalmente (`WYD_ALLOW_PUBLIC=true`) foi recusado. Antes, o operador viu as consequências: distribuição pública dos assets comerciais, egress do bucket (~320 MB por visitante), tm-server exposto a força bruta e as exports `wyd_debug_*` ainda no build.

A escolha foi o **gate por conta do portal**: só baixa a página, os assets e abre o WebSocket quem fez login no site. Isso reduz custo e abuso, mas **não resolve a licença dos assets**, porque qualquer pessoa cadastrada os recebe. O operador assume esse risco.

## Desenho

```text
cliente (Railway) sem cookie ── 302 ──> portal /jogar
portal /jogar sem sessão ── 303 ──> /?next=/jogar (Entrar | Criar Conta) ── volta a /jogar
portal /jogar com sessão ── form POST auto-submit ──> <cliente>/auth/portal  (ticket no corpo)
gateway: valida o ticket ── Set-Cookie wyd_play ── 303 /
```

- **Ticket:** `base64url(JSON {sub, iat, exp, jti}) "." base64url(HMAC-SHA256(segredo, "wyd-play-ticket.v1." + payload))`.
  - `sub` é o `accountId` do portal; validade de 60 s; `jti` de 16 bytes aleatórios;
  - não carrega senha, nome nem role;
  - viaja no corpo de um POST, nunca em URL, histórico ou `Referer` (`referrer-policy: no-referrer`).
- **Gateway** (`gateway/internal/relay/portalauth.go`):
  - verifica a assinatura em tempo constante antes de decodificar e limita o token a 1 KiB;
  - exige `exp - iat` ≤ 2 min, com tolerância de relógio de 30 s;
  - aceita cada `jti` uma vez, num cache em memória limitado a 4096 entradas e podado por expiração.
  - Recusas são logadas só com o motivo e o IP.
- **Sessão do gateway:** cookie `wyd_play` com `{sub, exp}` assinado com outro rótulo (`wyd-play-cookie.v1.`), o que impede usar o cookie como ticket e vice-versa. Atributos `HttpOnly`, `Secure` (exceto com `allowInsecure`), `SameSite=Lax` e `Path=/`; duração de 12 h (`sessionTtl`).
- **Sem sessão:**
  - navegação `GET` em `/` ou `*.html` vai para `<portal>/jogar`;
  - assets, `config.json` e `/ws/*` recebem 401;
  - `/healthz` e `POST /auth/portal` são livres.
- **Configuração:**
  - `portalAuth {url, ticketSecret, sessionTtl}` ou as variáveis `WYD_PORTAL_URL` e `WYD_PORTAL_TICKET_SECRET` (≥ 32 caracteres);
  - é exclusivo com `basicAuth`, que continua disponível para ambientes privados;
  - o segredo nunca aparece em mensagens de erro.
- **Portal** (entrega separada no repositório `wyd-plataforma`):
  - `src/lib/play-ticket.ts` (gera o ticket e o form);
  - `src/app/jogar/route.ts`, um Route Handler com `no-store` e `X-Frame-Options: DENY`, linkado por `<a>` simples para não haver prefetch;
  - `AuthTabs` volta a `/jogar` só quando `next` é exatamente `/jogar`, sem open redirect;
  - botão "Jogar no navegador" no `TopNav` e em `/download`;
  - variáveis `PLAY_TICKET_SECRET` e `WEBCLIENT_URL`.
- **Vetor compartilhado:** o mesmo ticket fixo, gerado com `node:crypto`, é verificado por `TestNodeTicketVector` no gateway e reproduzido byte a byte por `play-ticket.test.ts` no portal.

## Consequências e limites

- O jogo continua pedindo conta, senha e PIN na tela do cliente. A sessão do portal só libera o acesso à página. O login automático exigiria mudar o protocolo ou o servidor e fica fora do escopo.
- Uma conta bloqueada depois do login mantém o cookie do gateway por até 12 h. O tm-server continua sendo a autoridade sobre o login no jogo.
- *Login CSRF:* um terceiro poderia postar o próprio ticket e abrir o cliente na sessão de gateway dele. Isso não dá acesso a nada além da página e dos assets, e a conta do jogo continua sendo digitada pelo jogador.
- O cache de `jti` vive em memória: um reinício do gateway esquece os tickets usados, mas eles expiram em segundos.

## Troca no Railway

**Variáveis registradas em 02/10/2026, a pedido do operador, via CLI:**
- Railway (`wyd-client-web`/`production`, serviço `w2pp-OpenWyd-WebClient`): `WYD_PORTAL_URL=https://wyd-ten.vercel.app` e `WYD_PORTAL_TICKET_SECRET`, com `--skip-deploys`;
- Vercel (projeto `wyd`, Production, *Sensitive*): `PLAY_TICKET_SECRET` e `WEBCLIENT_URL=https://w2pp-openwyd-webclient-production.up.railway.app`.

O segredo, de 32 bytes aleatórios, foi passado por stdin. A cópia local está no `.env` como `W2PP_DEPLOY_PORTAL_TICKET_SECRET`; o hash confere com o valor do Railway. O Vercel não permite ler variáveis *Sensitive*, então lá o valor não foi conferido.

**`WYD_BASIC_AUTH_*` continuam definidas de propósito:** o gateway implantado ainda não conhece o gate. Quando esta mudança for implantada, as duas credenciais juntas fazem o gateway recusar iniciar, então **remova `WYD_BASIC_AUTH_USER/PASSWORD` no mesmo momento do deploy**.

Passos restantes:

1. Antes de abrir para jogadores, recomendado pela [ADR 003](003-in-world-dialect-and-automation.md): colocar `wyd_debug_*` atrás de flag de build. Definir também `WYD_MAX_CONNS_PER_IP`.
2. Merge e deploy do portal: a rota `/jogar` passa a existir com as variáveis já definidas.
3. Merge do gateway, com remoção de `WYD_BASIC_AUTH_*` e deploy.
