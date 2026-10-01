# Evidências da etapa 3 — transporte, dialeto e login real — 28/09/2026

Revisões: servidor `98286fdf01202f503523e89d3e50b2183f00c36c`; OpenWyd `beb9f69bdea6d81f70af14b5ce85ed064575bb26` com `patches/openwyd/0001..0003`; Go 1.25.13; Emscripten 6.0.0; Playwright 1.54.2 (Chromium headless). Decisões em [ADR 002](../../decisions/002-gateway-and-dialect.md).

## Onde termina a compatibilidade comprovada

| Trecho | Estado | Como |
|---|---|---|
| Navegador → gateway → TCP, bytes e ordem | **confirmado em execução** | testes adversariais do gateway, fluxo roteirizado e Railway |
| INITCODE, tabela, transformação, checksum, framing | **confirmado em execução** nas três implementações | vetores independentes em Python, Go (overlay) e cliente WASM |
| AccountLogin `020D` com ClientVersion 12000 | **confirmado em execução** no tmserver do Railway | log do servidor: `recv packet type=0x020d len=104`, `account login: OK` |
| CNFAccountLogin `010A` (2008 bytes) → seleção de personagem | **confirmado em execução** com o servidor real; conta sem personagens | 2008 bytes recebidos e traduzidos, estado 5 (Select Character), sem fixture |
| Conteúdo de SELCHAR e banco (4 slots, 128 itens, Exp > 32 bits) | **confirmado em execução** com fluxo roteirizado; **confirmado em teste unitário** | nomes lidos do runtime; 276 verificações campo a campo |
| CNFNew, CNFCharacterLogin, CreateMob, AccountSecure (PIN), CharacterLogin | **confirmado em teste unitário** e em execução nas etapas 4–5 | fixtures conferidas byte a byte contra os encoders Go |
| DeleteCharacter `0211` → CNFDeleteCharacter `0112`; recusa `011B` (servidor `2e532afa`) | **confirmado em execução** no Railway (30/09 e 01/10) | [exclusão ponta a ponta](#exclusão-de-personagem-ponta-a-ponta-30092026), [recusa `0x011B`](#recusa-de-exclusão-com-0x011b-01102026) |
| Criação/entrada de personagem, Field com servidor, duas sessões, relogin | **pendente (etapa 4)** | exige clique no modelo 3D e teclado de PIN; não executado |
| Pacotes de gameplay (`UpdateScore`, `UpdateEtc`, `SendItem`, chat…) | **não mapeados**: descartados e contados | lista de opcodes descartados no probe |

## 1. Tabela CPSock — SHA-256 completo

[keytable-sha256.json](keytable-sha256.json): o mesmo `e47996fe5e92de5d86d503d5415665f1f464bf344370c709be450607dd97cf8f` (512 bytes) em três fontes extraídas por parser, sem cópia entre elas: `CPSock.cpp` do Alan, `keytable.go` do servidor e o snapshot `reference/server/protocol-spec.md` (legado `CPSock.cpp:29-46`). O prefixo abreviado do relatório histórico não foi usado.

## 2. Vetores independentes

`tools/protocol/cpsock_ref.py` implementa o codec a partir do **fonte C++** (`AddMessage`/`ReadMessage`), sem usar o Go nem o tradutor. `gen_vectors.py` (semente 7662) grava:

- [vectors/transport](vectors/transport): 97 frames no esquema de fixture do servidor, com keywords 0/3/42/127/128/200/255, tamanhos 12/13/15/16/116/2008/8192 e corpos zero, 0xFF e aleatórios;
- [vectors/streams.json](vectors/streams.json): 28 fluxos. Cobrem handshake 1+3, byte a byte, header partido em cada um dos 11 pontos, três frames num chunk, frame de 8192, INITCODE errado, tamanhos 0/11/8193/65535, EOF no header e no corpo, checksum errado (enquadrado e sinalizado) e fluxos S→C sem INITCODE.

`tools/protocol/run_go_vectors.py` injeta `tools/protocol/overlay/*_test.go` no pacote `tmserver/internal/protocol` com `go test -overlay`; o checkout do servidor não é modificado. Resultado: `TestExtTransportVectors` e `TestExtStreams` PASS. `Encode(plain)` gera exatamente o fio esperado, `Decode(fio)` recupera o plaintext e o `Framer` aceita ou recusa cada fluxo como previsto.

## 3. Fixtures do dialeto

[fixtures/dialect.json](fixtures/dialect.json) é gerado por `gen_fixtures.py` por offsets explícitos, com dados sintéticos: quatro slots com slot vazio, Level 0 e 32767, Str −1/Dex −32768, Exp de 2³²+123 e 9·10¹⁵, equipamento no slot 15, banco nos slots 0/119/120/127, jogador com dados de PK e NPC com nome de 16 bytes.

- **Go (`TestExtDialectInbound/Outbound`)** reconstrói os mesmos dados com `EncodeCNFAccountLoginBody`, `EncodeCNFNewCharacterBody`, `EncodeCNFCharacterLoginBody` e `EncodeCreateMobBody`, e exige igualdade byte a byte. Na outra direção, decodifica com os decoders reais os frames que o cliente deve emitir: AccountLogin, CharacterLogin, DeleteCharacter e AccountSecure. Um byte trocado de propósito falhou com o offset exato (`abs 822`).
- **C++ (`tools/protocol/run_dialect_test.py`)** compila `WydDialect.cpp` com o `Basedef.h` já com os patches, via em++ para wasm32, a mesma ABI do navegador, e executa no Node. Resultado: **276 verificações, 0 falhas**. Cobre campo a campo, recusa de Level > `short`, tamanhos errados, `Magic` zerado e contado, cauda não mapeada contada, `UpdateScore` e chat descartados apesar do mesmo opcode, ClientVersion ausente, senha e PIN longos demais e apagamento de credenciais.

## 4. Gateway

`npm run gateway:test` (vet + testes; `-race` indisponível, pois não há gcc/cgo nesta máquina):

- config: allowlist exata, sem curingas, TLS ou opt-in explícito para WS, alvo com porta válida, sem query no `publicWsUrl`, campo desconhecido rejeitado;
- relay: query `host/port` → 400; canal desconhecido → 404; Origin estranha, ausente ou com prefixo → 403, sem tocar o TCP; handshake 1+3 e header partido em todos os pontos, frames colados e parciais preservados byte a byte; EOF do servidor chega como close 1000 depois de todos os bytes; texto e mensagem acima do limite fecham as duas pontas; limites global e por IP liberados ao fechar; falha de dial → 502 sem vazar vaga; servidor e navegador que não leem acionam o deadline de escrita sem acumular memória; ociosidade e shutdown fecham tudo.

Dois defeitos foram achados e corrigidos pelos próprios testes: o close frame se perdia porque o contexto era cancelado antes do close, e o `NetConn` da biblioteca desativa o limite de leitura (`netconn.go:49`).

## 5. Fluxo roteirizado no navegador — [client-scripted.json](client-scripted.json)

`npm run client:stream` sobe o gateway real, um servidor TCP roteirizado (teste isolado, não multiplayer) e o Chromium com `client.html` sob a CSP real. O cliente envia o login pelo painel original (`wyd_debug_selectserver_login`). A resposta tem 154.148 bytes em 1002 frames com keywords variadas e cortes 1+5+6, depois 700 e depois 1000 bytes: **158 chunks terminam no meio de um frame**, e o total passa dos 128 KiB do buffer de recepção.

Resultado: 1002 frames, com hash FNV `39e6572a` idêntico ao esperado; 1 traduzido, 1 repassado e 1000 descartados. Os nomes da seleção são exatos, `cargoHidden = 2`, e não houve erro de página, GL ou tamanho. O C→S decodificado pela referência Python mostra INITCODE, AccountLogin com 116 bytes, keyword 3, checksum válido, versão 12000 e campos reservados zerados, além de um ping `03A0`.

Antes da correção, o mesmo teste parou no frame 331 com o opcode lixo `0x10fe`. A causa era `RefreshRecvBuffer`: sem nenhum chamador no upstream, ele calculava `nRecvPosition -= left` em vez de `= left`. `RefreshSendBuffer` tinha o mesmo erro. Os dois foram corrigidos no patch 0001.

## 6. Login real no servidor do operador — [client-railway.json](client-railway.json) e [railway-tmserver-log.txt](railway-tmserver-log.txt)

- **Ambiente**, lido pela Railway CLI apenas em modo leitura: serviço `tm-server` online, deploy `98286fdf` (igual ao lock), `W2PP_CLIENT_VERSION=12000` e proxy TCP `reseau.proxy.rlwy.net:56950` → 8281. Nenhum deploy, restart ou variável foi alterado.
- **Conta**: criada a pedido do usuário no portal do operador (`wyd-ten.vercel.app`, `POST /api/signup` → 201) por um script que gerou a senha e a gravou só no `.env` (ignorado pelo Git), sem imprimi-la. O nome aparece mascarado nas evidências.
- **Janela** 2026-09-28T19:12:49Z–19:13:23Z, com o gateway local encaminhando para o proxy do Railway. No servidor: INITCODE `11 f3 11 1f`; `recv packet type=0x020d len=104 routed=true`; `account login: OK … chars=0`; `session send stats frames=1 bytes=2008 by_type=0x010a:1`; EOF ao fechar o navegador. No cliente: 2008 bytes recebidos, 1 frame traduzido, estado 5 "Select Character", fixture 0, sem erro de página ou GL e nenhum descarte. O gateway registrou `bytes_up=132, bytes_down=2008, reason=browser closed`.
- **Tela**: a captura local da cena (`.cache/client-server.png`, sha256 `201add74…e761`, fora do Git por conter assets) mostra a seleção com o teclado de PIN do jogo e os slots vazios. Os painéis do teclado aparecem sem moldura; não investigamos se é lacuna de asset.

## Comandos

```
npm run gateway:test
npm run protocol:vectors      # hash da tabela, vetores, Go overlay (transporte + dialeto)
npm run protocol:dialect      # patches + teste C++ wasm32
# rebuild do runtime: ver docs/setup.md (objetos + link), depois:
npm run scene                 # regressão da etapa 2 (passou com o runtime novo)
npm run client:stream         # navegador + gateway + servidor roteirizado
node tools/verify_client_stream.mjs --mode server --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env
```

Também executados: testes upstream `test_wasm_socket_bridge.py` (6 OK) e `test_wasm_link_freshness.py` (16 OK) com os patches; link estrito com 0 símbolos indefinidos.

## Limites

- Só Chromium headless. Não houve segunda sessão, cliente Windows 7662, relogin nem personagem; o login real parou na seleção com uma conta vazia.
- O login automatizado preenche o painel original por `wyd_debug_selectserver_login`: o texto chega à UI por uma função de depuração, não por digitação. A página humana usa teclado e mouse no canvas.
- O controle de senha da cena guarda o texto até a cena ser destruída, e o vetor interno de envio do WebSocket libera memória sem apagá-la. Hoje a credencial fica transitória em memória, mas não é apagada em todos os pontos.
- A mensagem de erro de login (`0x102` com o índice do aviso) chega à cena, que a ignora: o painel reabilita o login sem mostrar o motivo.
- `CNFCharacterLogin`: `Quest`, `Rsv`, `LearnedSkill[1]`, `Ext1/Ext2`, `CurrentKill` e `TotalKill` ficam zerados, e o `Magic` do servidor é tratado como o `char Magic` do runtime (**hipótese**). Validar na etapa 4 com o servidor real.

## Exclusão de personagem ponta a ponta (30/09/2026)

Decisões na [ADR 011](../../decisions/011-delete-character-end-to-end.md). Railway `tm-server` (`98286fdf`, `ClientVersion=12000`), conta B. WASM `tmproject_startup.1790812300295676400` (SHA-256 `6c441b66…`), com os patches 0001–0021.

```
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases delete
python tools/capture_world_logs.py --since 2026-09-30T23:57:30Z --until 2026-10-01T00:00:20Z --out docs/evidence/03-protocolo/2026-09-30-delete-server.txt
```

**Aprovada na primeira execução** ([JSON](2026-09-30-delete.json), [log do servidor](2026-09-30-delete-server.txt)):

1. Um personagem descartável foi criado no slot 1 (`create char: OK slot=1 total=2`) e estava presente depois de um relogin.
2. Com a senha errada, o cliente enviou `0x0211`, e o log do servidor registra corpo de 32 bytes (44 − 12 de cabeçalho), o layout Go. O servidor respondeu `0x011A`, e a lista ficou intacta.
3. Com a senha certa, foi enviado um novo `0x0211`. O servidor respondeu `0x0112`, só o slot 1 ficou vazio e o slot 0 foi preservado.
4. No relogin, a lista é a mesma, com o mesmo nível no slot 0.

A saúde de protocolo ficou limpa nas três sessões, sem descartes nem erros de página.

**Divergência do servidor (confirmada em fonte e em execução):** o legado responde à recusa com `0x011B` (`_MSG_DeleteCharacterFail`). O servidor Go responde com `0x011A`, que o runtime exibe como falha de criação. A correção é uma entrega separada, o [PR #359](https://github.com/Jean1dev/w2pp-OpenWYD/pull/359), ainda não publicada.

Limites:
- Nenhuma captura do texto exibido. O painel tem 2 s de vida e a leitura foi feita depois de 3 s; o texto vem do fonte.
- A automação abre a caixa e o painel pelos controles da cena, não por clique no botão desenhado.
- Só Chromium headless.

## Recusa de exclusão com `0x011B` (01/10/2026)

O [PR #359](https://github.com/Jean1dev/w2pp-OpenWYD/pull/359) foi integrado (`2e532afa`, 01/10 11:35 UTC). O deploy `5b9c73de` do `tm-server`, com esse commit, está ativo e com estado `SUCCESS`, conforme `railway deployment list` em 01/10. Os campos `revisions` do JSON mostram o checkout local `external/server` (`98286fdf`), não o servidor implantado.

Harness: `checkDelete` agora exige `0x011B` e o texto da recusa (`tools/trade_checks.mjs`). Como o runtime mostra a mensagem por só 2000 ms (`TMSelectCharScene.cpp`, `SetMessage(g_pMessageStringTable[20], 2000)`), a leitura passou a ser feita assim que a resposta chega, antes da espera de 3 s. Isso encerra o limite "nenhuma captura do texto exibido" de 30/09.

```
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases delete
python tools/capture_world_logs.py --since 2026-10-01T16:29:40Z --until 2026-10-01T16:32:10Z --out docs/evidence/03-protocolo/2026-10-01-delete-011b-server.txt
```

Para o JSON e o log do servidor, ver [2026-10-01-delete-011b.json](2026-10-01-delete-011b.json) e [2026-10-01-delete-011b-server.txt](2026-10-01-delete-011b-server.txt).

**Execução 16:26 UTC (aprovada pela regra antiga):** recusa `0x11b` e lista intacta; exclusão `0x112`; relogin igual. O `panelText` veio vazio, porque a leitura acontecia depois de o painel sumir. Esta execução levou à correção do harness.

**Execução 16:29 UTC (aprovada, regra nova):**
1. Personagem descartável criado no slot 1 e presente após o relogin.
2. Senha errada: `0x0211` enviado (corpo de 32 bytes no log do servidor). Resposta `0x011B`, painel "Falha ao apagar o personagem." (mensagem 20) e lista intacta.
3. Senha certa: novo `0x0211`, resposta `0x0112`, só o slot 1 esvaziado.
4. Relogin com a mesma lista e o mesmo nível no slot 0. Saúde de protocolo limpa nas três sessões.

O servidor não registra os pacotes que envia; o `0x011B` foi observado no cliente (`socket.lastRecvOpcode`), junto com a mensagem correspondente da tabela de strings.

Limites: só Chromium headless; a caixa e o painel são acionados pelos controles da cena (exports de automação), não por clique no botão desenhado.
