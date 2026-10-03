# ADR 018: chat global da página, ao lado do jogo

Data: 03/10/2026. Estado: **implementado; aprovado nos testes do gateway e no `chat:ui` com o gateway real e duas sessões ([evidência](../evidence/07-web/2026-10-03-web-chat.md)); deploy pendente**.

## Contexto

O operador pediu um chat em tempo real com os outros jogadores, ao lado da janela do jogo, sem persistência. O nick é o nome da conta usada no login.

O chat do jogo não serve para isso:
- a fala `0x0333` só chega a quem está em visão (ADR 008), e o protocolo do servidor não muda para acomodar a página;
- o chat de grupo, guilda e reino depende de estado do jogo.

## Decisão

Uma **sala global única no gateway**, separada do relé binário.

- **Rota:** `GET /chat/ws`, um WebSocket de texto atrás do mesmo portão do portal. Ela tem as mesmas regras do `/ws/<canal>`:
  - `Origin` exato da lista;
  - query recusada.

  O `relay.go` continua sem decodificar nem logar o fluxo do jogo.
- **Nick:** o nome da conta (`[a-z0-9]{4,12}`), que o ticket do portal traz desde o ADR 017.
  - O gateway grava esse nome no cookie de sessão `wyd_play` (campo `name`, assinado) e o injeta no contexto da requisição.
  - O navegador nunca escolhe o nick: um campo `nick` no JSON é ignorado.
  - Sem nome válido na sessão o chat fica em **somente leitura**. Isso vale para cookie antigo, Basic Auth ou gateway sem autenticação.
- **Sala:** `internal/chat.Hub`, com um goroutine dono do estado e entrada e saída por canais, sem locks.
  - Cada conexão tem uma fila de 32 mensagens. Quem fica para trás é derrubado (`1008 slow client`) sem atrasar os outros.
  - Respostas só para a própria conexão (hello e erros) usam uma fila própria, que o hub nunca fecha.
- **Protocolo** (JSON):
  - entrada: `{"t":"say","text"}`;
  - saída: `hello{nick,canSend}`, `msg{nick,text,ts}`, `online{n}` e `error{code: invalid|rate|readonly}`.
  - Quem fala recebe o próprio eco como confirmação.
- **Contenção:**
  - frame de até 1 KiB;
  - texto UTF-8 válido de 1 a 200 runas, sem caracteres de controle nem de direção bidi;
  - 5 mensagens em rajada, depois 1 a cada 2 s, por conexão;
  - limites de conexão próprios (`chat.maxClients` 256 e `chat.maxPerIP` 4), que não consomem as conexões do jogo;
  - ping a cada 30 s.
- **Sem persistência:** não há histórico, e quem entra vê só o que vier depois. Nada vai para disco. O log registra apenas `chat open/closed`, a contagem enviada e o motivo; nunca o nick nem o texto.
- **Página:**
  - `web/chat.js` e `web/chat.css`, num `<aside>` ao lado do canvas; abaixo de 1140 px, o painel vai para baixo do jogo;
  - o painel aparece só quando `/config.json` traz `"chat": true`. Com gateway antigo ou `WYD_CHAT_ENABLED=false`, fica escondido;
  - o texto é exibido só com `textContent`;
  - reconexão com backoff de 1 a 30 s;
  - Esc devolve o foco ao canvas;
  - no modo "ampliar", o canvas usa a largura que sobra ao lado do chat.
- **Configuração:**
  - bloco `chat` (`enabled`, `maxClients`, `maxPerIP`);
  - `WYD_CHAT_ENABLED=false` no deploy por variáveis;
  - o log de início mostra `chat=true|false`.

## Limites e pendências

- **Portal (fora deste repositório, confirmado em fonte):** `wyd-plataforma` `src/lib/play-ticket.ts` só inclui `name` quando também há `code` (`name && code`). Sem `PLAY_CODE_SECRET`, ou quando a emissão do código falha, o jogador entra em somente leitura. Proposta: enviar `name` sempre. O gateway já aceita o nome sozinho, sem tentar o login automático.
- **Réplicas:** uma réplica do gateway é uma sala. Com várias, cada uma seria uma sala separada; o Railway roda uma.
- **Moderação:** não há moderação, mute nem filtro. A contenção se resume ao rate limit e ao tamanho máximo.
- **Tela de carregamento:** ela cobre a página durante o download, então o chat só fica visível depois.
