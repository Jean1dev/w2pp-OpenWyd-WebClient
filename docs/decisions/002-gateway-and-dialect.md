# ADR 002 — Gateway WSS→TCP e camada de dialeto no cliente

Data: 28/09/2026. Estado: **implementado; validação parcial** (ver [evidências da etapa 3](../evidence/03-protocolo/README.md)).

## Contexto

O runtime do Alan (ADR 001) já fala CPSock por WebSocket via `emscripten/websocket.h`, mas:

- o proxy de debug upstream escolhe o destino TCP pelos parâmetros `?host=&port=` enviados pelo navegador;
- as cenas fazem cast direto dos pacotes para structs do `Basedef.h` do Alan, cujos layouts divergem do dialeto do servidor Go (16 vs 18 equipamentos, Level `int32` vs `short`, banco 128 vs 120, caudas diferentes; ver [matriz](../compatibility.md));
- o login envia `Version = 1758`, e o servidor exige o `-client-version` configurado (12000 no Railway do operador, 7640 por padrão).

## Decisões

1. **Gateway próprio em Go** (`gateway/`, módulo separado, `github.com/coder/websocket` v1.8.15 fixado). Ele só aceita a rota `/ws/<canal>`, e cada canal é mapeado pelo operador para um `host:port`. Uma requisição com qualquer query string é **recusada (400)**: o cliente legado anexava `?host=&port=`, e ignorar esses parâmetros em silêncio esconderia um cliente desatualizado. `Origin` é comparada exatamente com uma allowlist; não há curingas. O gateway aceita só mensagens binárias, com um buffer fixo por direção e sem fila adicional. A backpressure acontece pelo bloqueio da escrita, e um deadline de escrita encerra o par quando a outra ponta para de ler. O timeout de ociosidade considera as duas direções. O gateway limita conexões globais e por IP. O encerramento de uma ponta fecha a outra; um EOF limpo do servidor gera close frame `1000`. Os logs registram contadores e o motivo do encerramento, nunca payload. `/config.json` entrega ao navegador apenas `wsUrl`, `channel`, `clientVersion` e a versão do manifesto; o destino TCP nunca aparece.
2. **Tradução no cliente, na fronteira**. O arquivo próprio `client/dialect/WydDialect.{h,cpp}` é copiado para o checkout por `tools/apply_openwyd_patches.py`. Ele lê e escreve o fio por offsets little-endian explícitos e preenche as structs do runtime campo a campo. Pontos de instalação:
   - saída: `CPSock::SendDialect`, antes de `AddMessage`, isto é, antes da ofuscação;
   - entrada: os dois loops de `NewApp.cpp`, depois de `ReadMessage` e antes de `ObjectManager::OnPacketEvent`.

   Três regras valem para todo pacote:
   - **Lista de permissão:** só passa sem tradução um pacote com layout verificado idêntico. Opcode ou tamanho desconhecido é descartado e contado, com o opcode registrado. O mesmo número de opcode nos dois lados não basta; `UpdateScore` e chat são os exemplos cobertos por teste.
   - **Nunca truncar em silêncio:** `Level` fora de `short` recusa o pacote. `Magic`, `RegenHP` e `RegenMP` fora de `char` viram 0 e são contados. Bytes não mapeados com conteúdo são contados.
   - **Credenciais:** senha, senha de exclusão e PIN são apagados da struct da cena, da cópia traduzida e do buffer de envio depois do envio.
3. **Capacidade do banco 128** (patch 0003). A interface continua mostrando 3×40 células. Os itens 120..127 ficam em memória e são contados em `WYD_STAT_CARGO_HIDDEN`, sem serem descartados. A quarta página de banco fica para as etapas 5/6.
4. **ClientVersion por ambiente**: vem do canal do gateway e é aplicado por `wyd_net_set_client_version`. Sem essa configuração, o AccountLogin não é enviado e o evento é contado. O valor de 12000 no Railway foi lido das variáveis do serviço, não presumido.
5. **Patches pequenos e separados** sobre `beb9f69`, aplicados com `git apply` sobre o SHA do lock:
   - `0001`: plataforma e higiene de credenciais;
   - `0002`: ganchos do dialeto;
   - `0003`: banco com 128 posições.

## Achados que motivaram mudanças no upstream

- `CPSock::RefreshRecvBuffer` não tinha chamador. Um fluxo que sempre termina no meio de um frame avançava `nRecvPosition` até encher os 128 KiB, e a conexão travava. `Receive()` agora compacta o buffer antes de ler. Isso é coberto pelo teste de fluxo com 152.000 bytes.
- `m_szAccountPass` guardava os dois primeiros caracteres da senha e nunca era lido. Deixou de recebê-los.
- `keypass`/`keypasschage` (PIN) permaneciam na cena depois do envio e agora são zerados.
- Achado registrado, sem mudança: `BASE_CanCargo` indexa `CargoGrid[ty][9*yy+…]` e pode escrever além da linha, já com 120 posições. O problema é anterior a este trabalho.

## Consequências

- O fluxo login→seleção é traduzido e testado. `CNFCharacterLogin`, `CreateMob`, `CNFNew`/`CNFDelete`, `AccountSecure` e `DeleteCharacter` estão traduzidos e têm teste unitário, mas ainda **não têm prova ponta a ponta**, que fica para a etapa 4.
- Todo pacote de gameplay ainda não mapeado (`UpdateScore`, `UpdateEtc`, `SendItem`, chat etc.) chega ao cliente e é descartado. O Field com servidor real ainda não exibe esse estado. Os contadores mostram quais opcodes faltam.
- Uma mudança de protocolo no servidor exige atualizar os offsets, as fixtures e os três testes: Python, Go overlay e C++.
