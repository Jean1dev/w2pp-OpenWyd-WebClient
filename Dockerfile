# syntax=docker/dockerfile:1.7
#
# Web client image: gateway (Go) + page + WASM runtime compiled from the
# upstream pinned in dependencies.lock.json with patches/openwyd applied.
# Game data is NOT in this image: the gateway serves it from a mounted volume
# (WYD_ASSET_DIR). See docs/deploy.md.

ARG EMSCRIPTEN_VERSION=6.0.0
ARG GO_VERSION=1.25.13

# ---- runtime (WASM) ---------------------------------------------------------
FROM emscripten/emsdk:${EMSCRIPTEN_VERSION}@sha256:9eed2e47b4206928b22f99d2917013ad5462d777bb24cb546a652729896badd8 AS wasm
ARG BUILD_JOBS=4
WORKDIR /repo
COPY dependencies.lock.json ./
# Sparse checkout of exactly what the object builder and linker need, at the
# locked commit (single source of truth: the lock file).
RUN set -eux; \
    url="$(python3 -c 'import json;print(json.load(open("dependencies.lock.json"))["upstream"]["url"])')"; \
    commit="$(python3 -c 'import json;print(json.load(open("dependencies.lock.json"))["upstream"]["commit"])')"; \
    git clone --filter=blob:none --no-checkout --sparse "$url" external/OpenWyd; \
    git -C external/OpenWyd sparse-checkout set Projects/TMProject Dependencies/Directx/Include \
        webclient/client-wasm/compat webclient/client-wasm/config webclient/client-wasm/tools \
        webclient/client-wasm/build/link; \
    git -C external/OpenWyd checkout --detach "$commit"; \
    test "$(git -C external/OpenWyd rev-parse HEAD)" = "$commit"
COPY client/dialect client/dialect
COPY patches patches
COPY tools/apply_openwyd_patches.py tools/assemble_site.py tools/
COPY web web
RUN python3 tools/apply_openwyd_patches.py
# The object builder certifies its output against the compiler identity, which
# includes the `em++ --version` output. A fresh toolchain prints first-use
# sanity/cache messages there, so the identity changes mid-build and the builder
# rightly refuses to certify (exit 2). Warm the toolchain and its cache first.
RUN --mount=type=cache,id=wyd-emsdk-cache,target=/emsdk/upstream/emscripten/cache \
    em++ --version >/dev/null 2>&1 \
 && echo 'int main() { return 0; }' > /tmp/warm.cpp \
 && em++ -std=c++17 -O2 -c /tmp/warm.cpp -o /tmp/warm.o \
 && em++ /tmp/warm.o -o /tmp/warm.js \
 && python3 external/OpenWyd/webclient/client-wasm/tools/build_tmproject_wasm_objects.py \
        --repo-root external/OpenWyd --jobs "${BUILD_JOBS}" \
 && python3 external/OpenWyd/webclient/client-wasm/tools/link_tmproject_wasm_startup.py \
        --repo-root external/OpenWyd --dev --jobs "${BUILD_JOBS}" --link-opt-level O2 \
 && python3 tools/assemble_site.py --out /site

# ---- gateway ------------------------------------------------------------------
FROM golang:${GO_VERSION}-bookworm@sha256:e401dae1bf814e29204a8cb7915682e1780951e609ca0dd8865ee1937f510c48 AS gateway
WORKDIR /src
COPY gateway/go.mod gateway/go.sum ./
RUN go mod download && go mod verify
COPY gateway/ ./
RUN CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -ldflags="-s -w" -o /wydgateway ./cmd/wydgateway

# ---- final ------------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=gateway /wydgateway /wydgateway
COPY --from=wasm /site /srv/site
ENV WYD_STATIC_DIR=/srv/site \
    WYD_ASSET_DIR=/data/assets
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/wydgateway", "-env"]
