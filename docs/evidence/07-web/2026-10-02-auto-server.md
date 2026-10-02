# Seleção automática do servidor (02/10/2026)

## Escopo

Pedido do usuário: o jogador já entrou pelo portal, então a lista de servidores não deve aparecer. O `serverlist.bin` tem vários grupos, mas todos apontam para o mesmo destino, então na prática é um servidor só. A página pula a seleção e o jogo abre direto no painel de login.

Ficou fora, por exigir uma entrega no servidor, pular conta e senha (código de uso único, [ADR 015](../../decisions/015-portal-account-gate.md#consequências-e-limites)).

Base: repositório `8758d80` e upstream `beb9f69bdea6d81f70af14b5ce85ed064575bb26` com os patches 0001–0025. Toolchain, montada neste worktree conforme o `docs/setup.md` e conferida contra o `dependencies.lock.json`:

| Ferramenta | Versão e verificação |
|---|---|
| emsdk | 6.0.0, commit `d223ae7` |
| Go | 1.25.13, SHA-256 do zip conferido |
| Playwright | 1.54.2 |
| Node | 24.14.1 |
| Python | 3.14.3 |

Assets: importados de `C:\Users\User\Documents\Client-aws\Client-aws`, com a origem só lida (7.093 arquivos, em `assets-local/`, ignorado pelo Git).

## Confirmado em fonte (upstream fixado)

O fluxo original de `TMSelectServerScene`:
- o clique num grupo de `L_SELECT_SERVERG` dispara `OnControlEvent(L_SELECT_SERVERG, índice)` e preenche os canais;
- o clique num canal só marca a seleção;
- `B_SERVER_SEL_OK`:
  - copia `g_pServerList[grupo][canal]` para `m_szServerIP`;
  - esconde a lista e mostra o painel de login (`m_cLogin = 1`), com foco na conta;
  - recusa canal inválido ou cheio.

Com `Game_grade`, a lista fica escondida durante a vinheta, e `FrameMoveGameGrade` a reexibe ao terminar. Por isso a seleção automática espera `m_bGameGradePlay == 0` e a lista visível.

No painel, Tab alterna conta e senha, e Enter com a senha em foco aciona `B_LOGIN_OK` (`OnCharEvent`).

## Implementação

- **`patches/openwyd/0025-selectserver-auto.patch`:** cria a exportação pública `wyd_selectserver_auto()`.
  - **Regra:** todos os canais (`g_pServerList[g][1..]`) de todos os grupos têm o mesmo endereço. A entrada `[g][0]` é a URL de status e não conta.
  - **Quando age:** só na cena de seleção, com `m_cLogin == 0`, a vinheta terminada, a lista visível e sem caixa de mensagem.
  - **Como age:** aciona os controles na ordem dos cliques do jogador: primeiro grupo, primeiro canal e "OK". Não digita nem envia nada.
  - **Retorno:** 1 quando o login abriu; 0 quando ainda não está pronto ou o jogador voltou à lista (`m_cLogin = 2`); -1 quando não se aplica (destinos diferentes, nenhum canal, ou "OK" recusado).
- **`web/client.js`:** chama `_wyd_selectserver_auto` a cada 15 quadros até receber -1, ou `null` se o runtime não tiver a exportação. Cada abertura conta em `clientEvidence.autoServer`.
- **`tools/verify_auto_server.mjs` (`npm run auto:server`):** teste com runtime real, página real (CSP), gateway real e o tm-server do operador. Ele não usa nenhuma `wyd_debug_*`.
  - Depois do salto, digita **pelo teclado**, no painel original, uma conta inexistente gerada na hora.
  - Nenhuma conta real é usada ou contada como tentativa errada. A conta descartável não vai para a evidência.

## Confirmado em execução

**Destino:** a CLI do Railway (`@railway/cli` 5.63.1, só leitura, projeto `wyd`, serviço `tm-server`, `production`) informou:
- `RAILWAY_TCP_PROXY_DOMAIN=reseau.proxy.rlwy.net`, `RAILWAY_TCP_PROXY_PORT=56950`, porta interna 8281;
- `W2PP_CLIENT_VERSION=12000`.

Só essas chaves foram lidas.

| Comando | Resultado |
|---|---|
| `build_tmproject_wasm_objects.py` e `link_tmproject_wasm_startup.py --dev` | link com 0 símbolos indefinidos; `tmproject_startup.1790971954495606900.wasm` (SHA-256 `15d04f9f49443bd5…`) exporta `wyd_selectserver_auto` |
| `python tools/build_local_scene.py` | site em `.cache/local-scene`, pacote de 304 MB |
| `npm run auto:server` (Chromium, alvo `reseau.proxy.rlwy.net:56950`, ClientVersion 12000) | **8/8**, detalhados abaixo |
| `check_public_exports.py --site .cache/local-scene` | 44 problemas, **todos** `wyd_debug_*` (esperado no build `--dev`); nenhuma função usada pela página falta |
| `npm run loading:ui` / `npm run settings:ui` / `test_public_exports` | 42/42, 36/36, 4/4 |

Os 8 checks do `auto:server`:
1. **Lista:** 3 canais em 3 grupos, um só destino (`127.0.0.1`).
2. **Salto:** o painel de login abriu sem nenhum clique, em 425 ms depois do primeiro quadro. A primeira execução levou 1.520 ms.
3. **Carregamento:** a tela de carregamento estava fechada.
4. **Login:** o `0x020D` saiu (`connect=1`, 120 B).
5. **Resposta:** o tm-server respondeu `0x0102` (16 B = cabeçalho de 12 + 4, `MsgMessageBoxOk` com `NoticeNoAccount` em `tmserver/internal/handler/notice.go`), e o painel mostrou "Conta inexistente.".
6. **Estado:** continuou em Select Server.
7. **Erros:** nenhum.

As capturas `login-panel.png` e `server-reply.png` e o `results.json` ficam em `.cache/auto-server/` (ignorado). A captura do painel mostra o login com a conta em foco e nenhuma lista de servidores.

Na primeira execução, o check de resposta aceitava qualquer byte recebido e passou lendo "Conectando no servidor.", que é texto do próprio cliente. Ele foi endurecido para exigir o opcode `0x0102` e passou de novo.

## Não executado / limitações

- **Relogin:** sair do jogo e voltar ao painel não foi exercitado com conta real. Pela fonte, a cena é recriada com `m_cLogin = 0` e o salto se repete.
- **Firefox:** não rodou com o runtime real.
- **Build:** o build público (`--public`) não foi montado localmente; a CI o monta e checa as exportações.

## Próximo passo

CI verde, deploy e conferir pelo portal (`clientEvidence.autoServer === 1` no domínio público).
