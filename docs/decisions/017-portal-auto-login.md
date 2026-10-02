# ADR 017: login automático no jogo pela conta do portal

Data: 02/10/2026. Estado: **implementado em três entregas, aguardando teste de ponta a ponta na stack local e deploy**. Revê o item "fora do escopo" da [ADR 015](015-portal-account-gate.md#consequências-e-limites).

## Contexto

O jogador entra no portal e clica em "Jogar no navegador". Com a [seleção automática do servidor](../evidence/07-web/2026-10-02-auto-server.md), o jogo abre direto no painel de login, mas ainda pede conta e senha. O pedido do operador é cair na seleção de personagem sem digitar de novo.

Restrições:
- O navegador não conhece a senha. O portal guarda só o hash Argon2id, e o `AGENTS.md` proíbe gravar credenciais no navegador, em URL ou em log.
- O pacote `MSG_AccountLogin` (`0x020D`) e o cliente Windows 7662 não mudam.
- O campo de senha do cliente tem 12 bytes, e `TMSelectServerScene::OnControlEvent(B_LOGIN_OK)` o copia com `sprintf_s`, que precisa do terminador (confirmado em fonte). No máximo 11 caracteres cabem.

## Decisão

**Um código de login de uso único**:
- emitido pelo servidor a pedido do portal;
- válido por 2 minutos;
- guardado só como SHA-256;
- aceito uma vez pelo `dbserver` no lugar da senha.

```text
portal /jogar (sessão iron-session)
  └─ gRPC IssuePlayCode{assertion}                      webserver (w2pp-OpenWYD)
       assertion = base64url(JSON{sub,iat,exp,jti}) "." base64url(HMAC-SHA256(PLAY_CODE_SECRET, "wyd-play-code.v1." + payload))
       ← {account_name, code (10 chars), expires_in_seconds: 120}
  └─ ticket (ADR 015) com os campos opcionais name e code → POST <cliente>/auth/portal
gateway: sessão wyd_play (como antes) + handoff em memória {sub, name, code, exp 120 s}
         cookie wyd_login (HttpOnly, SameSite=Strict, Path=/auth/game-login, Max-Age 120)
página: depois do salto da lista, POST auth/game-login (uma vez) → {account, code}
        → wyd_selectserver_login (patch 0026) → B_LOGIN_OK original → 0x020D
tmserver → dbserver AccountLogin: senha falha → código com o formato certo → ConsumePlayCode (DELETE … RETURNING, atômico)
```

### Código

- **Formato:** 10 símbolos de `abcdefghijkmnpqrstuvwxyz23456789`, sem `0/o/1/l`, cerca de 50 bits, gerados com `crypto/rand`. 32 símbolos dividem 256, então não há viés.
- **Hash SHA-256, não Argon2id:** o Argon2id protege senhas humanas de baixa entropia contra ataque offline. O código é aleatório, de uso único e vive 2 minutos, e o hash determinístico permite a busca direta no banco.
- **Ataque online:** é inviável. Cada conta tem no máximo 5 códigos ativos, cada tentativa conta para o bloqueio `MaxFailLogin` do tmserver, e o código expira em 2 minutos.
- **Ordem no `AccountLogin`:** a senha é testada primeiro, então uma senha real que pareça um código continua funcionando. Conta bloqueada nunca consome código.

### Autenticação do pedido

O `api-server` (webserver gRPC) tem domínio público e proxy TCP no Railway, sem certificado de cliente. Isso foi **confirmado na CLI do Railway**: `RAILWAY_PUBLIC_DOMAIN` e `RAILWAY_TCP_PROXY_*` do serviço `api-server`. O comentário em `src/lib/web-api/channel.ts` do portal diz o mesmo.

Por isso o `IssuePlayCode` **não confia em `account_id`**. A conta vem só de uma asserção HMAC que apenas o portal sabe assinar:
- segredo `PLAY_CODE_SECRET` com 32+ caracteres;
- rótulo próprio, diferente do ticket;
- vida de até 2 minutos;
- `jti` de uso único.

Sem o segredo, a RPC responde `DISABLED`. As demais RPCs do webserver confiam no `account_id`/`moderator_id` da requisição; esse problema fica numa issue separada no repositório do servidor.

### Gateway e página

- **Gateway:** valida `name` (`[a-z0-9]{4,12}`) e `code`, e descarta um login malformado; a sessão abre do mesmo jeito. O handoff:
  - exige a sessão do gateway da mesma conta e o cookie `wyd_login`;
  - recusa `Origin` de outro host;
  - responde uma vez, com `no-store`, e apaga a entrada e o cookie;
  - nunca loga nome nem código.
- **Página:** pede o handoff uma vez, depois do primeiro salto da lista, e chama `wyd_selectserver_login` até o painel aceitar (no máximo 20 tentativas, a cada 15 quadros). Em `clientEvidence` fica só `autoLogin: pending | none | sent | failed`.
- **Runtime (patch 0026):** só age com o painel já aberto e pronto. Não força visibilidade nem relógio, ao contrário de `wyd_debug_selectserver_login`. Ele apaga o buffer do código; o `B_LOGIN_OK` com o patch 0004 já limpa o campo de senha depois do envio.

### Compatibilidade e falhas

Cada entrega pode ir ao ar sozinha:
- **Gateway antigo:** já ignora campos extras do ticket (`json.Unmarshal`).
- **Portal sem `PLAY_CODE_SECRET`:** não emite código.
- **Página com gateway antigo:** recebe 401/404 no handoff e segue no login manual.
- **Código vencido ou gateway reiniciado:** login manual.

## Limites

- O PIN continua sendo pedido, por decisão do operador.
- Voltar ao login dentro do jogo pede a senha. O código já foi usado; o jogador pode reabrir pelo portal.
- O código viaja no corpo do formulário que o portal devolve ao navegador (HTML com `no-store`) e na resposta do handoff, como a senha já viajava digitada, sempre por TLS em produção.

## Entregas

| Repositório | Conteúdo |
|---|---|
| `w2pp-OpenWYD` | `internal/playcode`, migração `0026_account_play_code`, `store.IssuePlayCode`/`ConsumePlayCode`, `AccountWebService.IssuePlayCode`, `dbserver AccountLogin`, `W2PP_PLAY_CODE_SECRET` no webserver |
| `wyd-plataforma` | `proto/web.proto` sincronizado, `src/lib/play-code.ts`, ticket com `name`/`code`, `/jogar` com prazo de 1,5 s |
| este | handoff no gateway (`portalauth.go`), patch 0026, `web/client.js`, testes |

## Deploy (ordem)

1. **Servidor:** aplica a migração no boot. Definir `W2PP_PLAY_CODE_SECRET` no `api-server` com 32+ bytes aleatórios.
2. **Portal:** definir `PLAY_CODE_SECRET` no Vercel com o mesmo valor.
3. **Cliente web:** imagem com o patch 0026 e o gateway novo.
