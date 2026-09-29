# ADR 005 — Deploy no Railway e CI

Data: 29/09/2026. Estado: **implementado; build local da imagem e testes verificados; deploy não executado.** Guia em [deploy.md](../deploy.md).

## Contexto

O operador pediu um deploy no Railway com Dockerfile e uma CI de validação. Três restrições do projeto definem a forma:

- os dados do jogo são comerciais e não podem entrar na imagem nem no Git (AGENTS.md, prompt 08);
- o runtime vem de um upstream sem licença que cubra a redistribuição do conjunto ([dependências](../dependencies.md));
- o gateway é só relé: não tem regra de jogo e o destino TCP é do operador.

## Decisões do operador (29/09/2026)

1. **Assets num Volume do Railway.** O operador envia os dados com `railway volume files upload`. Nada disso vai para a imagem.
2. **Acesso restrito por senha.** O gateway ganha Basic Auth opcional, e o modo por ambiente o **exige**, salvo `WYD_ALLOW_PUBLIC=true` explícito.
3. **WASM compilado no build da imagem**, a partir do SHA do `dependencies.lock.json`, com os patches locais. É reproduzível a partir do Git.

## Decisões técnicas

- **Imagem em três estágios:**
  - `emscripten/emsdk:6.0.0`, a mesma versão do lock, com sparse clone do upstream e `apply_openwyd_patches.py`;
  - `golang:1.25.13-bookworm`, com build estático do gateway;
  - `distroless/static-debian12:nonroot` no final.

  As bases ficam fixadas por digest. O upstream é lido do lock dentro do build, então não há um segundo lugar para o SHA.
- **Gateway, novos campos de configuração:**
  - `tlsTerminatedByProxy`: TLS na borda da plataforma; exige origens `https://` e `wss://` e exclui `allowInsecure`;
  - `assetDir`: segunda raiz estática. Os arquivos da imagem têm precedência, e o volume não consegue sombrear `runtime.js`;
  - `basicAuth`: comparação em tempo constante sobre SHA-256;
  - `/healthz` sem autenticação;
  - `-env`: configuração por variáveis `WYD_*`. O modo por arquivo continua igual para o uso local.
- **Limite por IP atrás do proxy:** o socket é sempre o proxy do Railway. No modo `tlsTerminatedByProxy`, o gateway usa a entrada mais à direita do `X-Forwarded-For`, a única adicionada pelo proxy. Fora desse modo, os cabeçalhos continuam ignorados. **Hipótese a confirmar no primeiro deploy:** o Railway anexa o IP do cliente como última entrada.
- **Rollback:**
  - página e runtime voltam juntos pelo redeploy de uma imagem anterior;
  - assets ficam em diretórios versionados (`/data/assets-<manifest>`) e voltam trocando `WYD_ASSET_DIR`;
  - `tools/pack_deploy_assets.py` gera o manifesto de hashes.
- **CI só com entradas distribuíveis:** este repositório, os checkouts públicos fixados (`tools/fetch_pinned.py`) e os fixtures sintéticos. Cena com assets e cenários online ficam locais, e a CI não finge cobri-los.
  - `run_dialect_test.py` aceita o emsdk do ambiente (`EMSDK`).
  - Os scripts Go já aceitavam o `go` do PATH.

## Consequências

- O primeiro deploy exige passos manuais do operador: serviço, domínio, variáveis, volume e upload. Estão descritos, mas não foram executados por esta entrega.
- **A confirmar em execução:** reenvio da credencial Basic na abertura do WebSocket de mesma origem; leitura do volume pelo uid `nonroot` (alternativa: `RAILWAY_RUN_UID=0`); porta interna do tm-server na rede privada.
- As exports `wyd_debug_*` continuam no build publicado. A ADR 003 pede uma flag de build antes de uma entrega **pública**. Com o acesso restrito isso é aceitável, mas continua pendente para a etapa 8.
