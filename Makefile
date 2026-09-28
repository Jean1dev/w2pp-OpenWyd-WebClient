# Cliente web local contra o tm-server do operador no Railway.
# Windows: instale make (ex.: `choco install make`) ou use `npm run dev`.
# A lógica fica em tools/dev_railway.mjs (Node), igual em todas as plataformas.

NODE ?= node

.PHONY: dev runtime site gateway test

## Aplica patches, recompila o runtime se preciso, monta o site, sobe o gateway e abre o Chrome.
dev:
	$(NODE) tools/dev_railway.mjs

## Só patches + runtime WASM (recompila apenas se as fontes mudaram).
runtime:
	$(NODE) tools/dev_railway.mjs runtime

## Só monta .cache/local-scene a partir do dataset já empacotado.
site:
	$(NODE) tools/dev_railway.mjs site

## Só compila o gateway e cria gateway.local.json se faltar.
gateway:
	$(NODE) tools/dev_railway.mjs gateway

## Testes rápidos do protocolo e do gateway.
test:
	npm run gateway:test
	npm run protocol:vectors
	npm run protocol:dialect
