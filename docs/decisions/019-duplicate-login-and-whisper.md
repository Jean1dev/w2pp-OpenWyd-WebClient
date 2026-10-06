# ADR 019: login duplicado e sussurro no servidor

Data: 06/10/2026. Estado: **implementado no servidor, com testes Go; PRs [#374](https://github.com/Jean1dev/w2pp-OpenWYD/pull/374) (sussurro) e [#375](https://github.com/Jean1dev/w2pp-OpenWYD/pull/375) (login duplicado) abertos, sem merge nem deploy**. Espelhados em `patches/server/0008-whisper-sender.patch` e `0009-duplicate-login.patch`.

## Contexto

Duas lacunas do tm-server Go, registradas na [ADR 008](008-shop-cargo-chat-dialect.md) (lacuna 3) e na etapa 4. Relidas em 06/10 no deploy `dbb3ad85`, no upstream `alanpetry/OpenWyd@beb9f69` e no runtime 7662:

- **Sussurro** (`handler/chat.go`, `messageWhisper`):
  - o servidor repassa o payload sem mudar o `MobName`, que chega com o nome do **destinatário**;
  - o 7662 mostra o `MobName` como remetente;
  - o memo privado imprime `&String[1]` (`TMFieldScene.cpp:17945`), então o primeiro caractere some. Isso também acontecia com o servidor C++, que repassa o texto como foi digitado;
  - `Color == 7` desvia a linha para o chat cinza (l.17901), e `-`, `=` e `@` no início são marcadores de guilda, grupo e reino.
- **Login duplicado:**
  - o `dbserver` nunca devolve `ALREADY_PLAYING`, e as sessões são indexadas só por conn;
  - o segundo login era aceito (confirmado em execução em 29/09 e 01/10);
  - `SetCargo` trocava o cargo vivo pela cópia do banco;
  - o fim de uma sessão apagava o cargo que a outra ainda usava;
  - os salvamentos do fim de sessão não voltavam ao loop, o que permitia carregar dados mais antigos que os da sessão anterior.

O C++ original:
- **sussurro** (`_MSG_MessageWhisper.cpp`): grava o nome de quem envia e tem `/r` (`LastChat`);
- **login duplicado** (`DBSrv/CFileDB.cpp:1001-1017`, `TMSrv/ProcessDBMessage.cpp` `_MSG_DBSavingQuit`): derruba e salva a sessão antiga com o Language.txt 134, "Conta desconectada por conexão simultânea.", e recusa a nova com `0x011D`/`0x011C`. O 7662 mostra "Conexão anterior finalizada. Tente novamente." (`TMSelectServerScene.cpp:1571`).

## Decisão (do usuário, 06/10)

- **Login duplicado como o original.**
  - A sessão que está na seleção ou no jogo recebe o painel do Language.txt 134 e é fechada, o que a salva.
  - A nova recebe `0x011D`.
  - Enquanto o salvamento da sessão antiga não termina, novas tentativas recebem `0x011C`.
  - A sessão recusada volta a `UserAccept` e pode tentar de novo na mesma conexão. O original fechava a conexão.
- **Sussurro:**
  - o `MobName` passa a ser o nome de quem envia;
  - o texto ganha **um espaço na frente**, para o memo mostrar a mensagem inteira e impedir marcadores falsos de canal;
  - o `Color` é zerado;
  - o comprimento recebido é mantido: 158 do web, 160 do `WYD.exe`.
- **`/r`** responde a quem sussurrou por último. Sem histórico, vale o aviso de não conectado.

Nada muda no protocolo, no dialeto ou nas páginas. O `WydDialect` já repassa `0x0334` (≤ 158), `0x011C`/`0x011D` e `0x0101`.

## Implementação no servidor

- **Sussurro:** `chat.go` (`privateWhisperText`, `whisperReply`) e `world.Session.LastWhisperFrom`.
- **Login duplicado:**
  - `login.go`: `refuseDuplicateLogin`, mais o ramo `ALREADY_PLAYING`, que agora também volta a `UserAccept`;
  - `world.go`:
    - `saveAccountOnClose` substitui `SaveCharacterAsync` e `ReleaseCargo` no `removeSession`; o salvamento continua sob `saveWG` e volta ao loop por `worldCallbackEvent`;
    - `AccountSaving`;
    - `SessionByAccount`;
  - `protocol.MsgStillPlaying`.
- **Testes Go:**
  - `TestWhisperRewrite` e `TestWhisperReply`;
  - `login_duplicate_test.go`: derrubada e recusa, tentativas durante o salvamento, derrubada a partir do jogo, outras contas;
  - os testes que punham dois jogadores com a mesma conta passaram a usar aliases `tester#N`;
  - `go test ./tmserver/...`: 17 pacotes ok, e os testes novos ficaram estáveis com `-count=10`.

## Neste repositório

- **`patches/openwyd/0027-memo-probes.patch`:** `wyd_field_memo_count` e `wyd_field_memo_line`, que leem o memo privado (`m_pHelpList[3]`). Os probes de chat da 0018 só leem `m_pChatList`, e o nome do remetente aparece no memo. São só leitura.
- **Harness:**
  - fase `chat`: B mostra A como remetente e o texto inteiro; B responde com `/r` e A recebe de B; o aviso de offline chega;
  - fase `concurrent`, invertida:
    - recusa `0x011D`/`0x011C` com "Tente novamente";
    - a primeira página é fechada;
    - uma nova tentativa entra com o mesmo personagem e o mesmo equipamento;
  - `checkChat` e o novo `checkConcurrent` em `tools/world_checks.mjs`.

## Consequências e limites

- A trava vale por instância de tm-server: o `dbserver` não rastreia contas online.
- O relogin logo depois de fechar a página pode receber "Tente novamente" por um instante, enquanto o salvamento anterior termina. No original era igual.
- O espaço no sussurro diverge do servidor C++ para corrigir um corte que o próprio 7662 faz. Ele vale para o cliente web e para o Windows.
- **Pendente:** merge e deploy pelo operador; execução online de `chat` e `concurrent`; conferência com o cliente Windows (sussurro web ↔ Windows e login duplicado entre os dois).
