# Etapa 5, fatia 3 — loja, banco, teleporte e chat (30/09/2026)

Ambiente: Railway `tm-server` (servidor `98286fdf`, `ClientVersion=12000`), contas A e B de `.env`, personagem de classe 0 da conta A (nível 10, 998.687–1.000.112 de ouro). Upstream `beb9f69b` com os patches 0001–0018. WASM `tmproject_startup.1790788748589055200` (SHA-256 `1433ef27…63e1b0`, 115 objetos certificados, 0 indefinidos). Decisões na [ADR 008](../../decisions/008-shop-cargo-chat-dialect.md).

Cada fase rodou num processo separado, com o comando:

```
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases <fases> --class 0
```

## Verificação local (confirmado em teste)

- `npm run protocol:dialect`: 545 verificações, 0 falhas. Cobre tamanho exato, tamanho errado, padding zerado e texto sem terminador.
- `npm run protocol:vectors`: 97 vetores e 28 fluxos. O overlay Go confere as fixtures novas com `EncodeUpdateCargoCoin`, `MsgWhisperBody`, `StandardParm` e a leitura de `buy`/`sell` do servidor.
- `npm run world:checks`: 25/0.
- `npm run scene` verde.
- `npm run client:stream` verde. O enchimento "desconhecido" do fluxo roteirizado passou de `0x0333` para `0x0383` (troca), porque o chat agora é mapeado.
- Pilha de patches 0001–0018 verificada.

## Loja (Aki, Merchant 1) — **aprovada** (execução 2)

Fases `login,enter,shop`. [JSON](2026-09-30-shop-passed.json), [log do servidor](2026-09-30-shop-passed-server.txt).

- Um clique real em Aki (`0x027B`) fez o servidor abrir a loja (`shop opened npc=12460 merchant=1`), com 28 itens e preços do catálogo do cliente.
- **Venda:** o item 1801 foi pego na bolsa, solto na grade da loja e confirmado na caixa 890. Saíram um `0x037A` (18 bytes), `sell ok slot=14 gain=75`, o slot foi limpo e o ouro subiu de 999.212 para 999.287.
- **Compra:** toque curto no item 1774. Saiu um `0x0379`, `buy ok price=300`, e o item chegou pelo `0x0182`. Ouro 999.287 → 998.987.
- **Sem ouro:** item 693 (20.080.000). O servidor registrou `buy denied` e não respondeu (lacuna 1 da ADR 008); o ouro e a bolsa não mudaram.
- **Clique repetido** (dois toques no mesmo quadro): o primeiro deu `buy ok` no slot 27. No segundo, o runtime ainda não tinha o `0x0182` e escolheu o mesmo slot, então o servidor respondeu `buy resync (dest occupied)`. Resultado: 1 item por 300, sem duplicação.
- O relogin preservou a bolsa, o ouro, o nível e a EXP. Protocolo limpo.

### Execução 1 — reprovada pela regra do harness ([JSON](2026-09-30-shop-held-click-failed.json), [log](2026-09-30-shop-held-click-failed-server.txt))

Cada clique do harness gerou dois `0x0379` com 1 s de intervalo, e o servidor cobrou os dois (2 × 300).

**Causa, confirmada em fonte:** `EventTranslator` chama `OnLMousePressed()` (evento 513) a cada leitura do DirectInput enquanto o botão está pressionado; o disparo é por nível, não por borda. O `SGrid` só espaça as compras por `m_dwLastBuyTime + 500` ms. A ~1 quadro/s headless, o botão segurado por 2 quadros compra duas vezes. Um jogador a 60 quadros/s solta antes dos 500 ms.

É comportamento do cliente original, não do dialeto, e não há duplicação: cada unidade foi paga. O harness passou a usar toque curto (`tapCanvas`), e a regra agora usa o preço unitário (ouro gasto ÷ unidades).

## Banco (Guarda Carga, Merchant 2) — **aprovado** (execução 3)

Fases `login,enter,bank`. [JSON](2026-09-30-bank-passed.json), [log do servidor](2026-09-30-bank-passed-server.txt).

- Um clique real no Guarda Carga (#3408, 2144,2082) abriu o banco. O cliente mostra 0 de ouro no banco (`0x0339`) e nenhum item.
- **Item:** o 1774 foi da bolsa (slot 14) para o banco (slot 0) com um `0x0376`, e voltou com outro. O servidor aplicou os dois; o banco ficou vazio.
- **Depósito:** botão real de ouro, 100 digitado no teclado, OK. Saiu um `0x0388`, `cargo deposit coin=100 cargo=100`, e o cliente foi de 998.687/0 para 998.587/100.
- **Saque:** o mesmo gesto no botão do banco. Saiu um `0x0387`, `cargo withdraw coin=100 cargo=0`, e o cliente voltou a 998.687/0.
- **Saque acima do saldo:** um `0x0387` enviado e recusado pelo servidor sem resposta; nada mudou.
- **Depósito acima do saldo:** o próprio cliente recusa (mensagem 34) sem enviar pacote e mantém a caixa aberta, como no original.
- **Relogin e nova abertura do banco:** carry 998.687, banco 0, slot 0 vazio.
- O ouro do banco mostrado pelo cliente bate com o log do servidor em 0 → 100 → 0. Isso sustenta a leitura do `0x0339` com o ouro em @12. Continua **hipótese** para valores altos e para ouro guardado entre sessões, que ainda não foi exercitado.
- O log desta janela não mostra `0x027B` nem `cargo opened`, embora o cliente tenha recebido o `0x0339`. A ausência não foi explicada.

Falhas anteriores:
1. O padrão de nome procurava `Guarda_Carga`, mas o jogo exibe "Guarda Carga". Nenhuma ação no banco foi feita.
2. [JSON](2026-09-30-bank-modal-failed.json), [log](2026-09-30-bank-modal-failed-server.txt): o ouro foi aprovado, mas a caixa de valor ficou aberta depois do depósito acima do saldo (comportamento original: `B_IG_OK` devolve o foco ao campo) e bloqueou os cliques no item. A fase passou a mover o item antes das operações de ouro.

## Chat e teleporte — **aprovados** (execução 2)

Fases `login,enter,second,chat`. [JSON](2026-09-30-chat-passed.json), [log do servidor](2026-09-30-chat-passed-server.txt).

- **Fala:** Enter, texto digitado, Enter. Saiu um `0x0333` (140 bytes; corpo de 128 no log), e B mostra `[A]> ola <marca>`. A mostra a própria linha localmente, e o servidor não ecoa.
- **Sussurro:** `/nomeDeB psiu <marca>` gerou um `0x0334` de 158 bytes (corpo de 146; o padding de 160 → 158 não é enviado). B recebeu o texto no memo privado, sem o primeiro caractere (`siu <marca>`).
  - O corte é do runtime: `OnPacketMessageWhisper` exibe `&String[1]`, e o remetente monta `String` sem prefixo. **Hipótese:** o servidor legado reescrevia o sussurro com um prefixo; o servidor atual repassa o payload como veio.
  - O probe não encontrou nenhum dos dois nomes nas linhas novas de B. Por isso, o `MobName` não trocado (lacuna 3 da ADR 008) está **confirmado em fonte, não observado**.
- **Sussurro para um nome offline:** o servidor responde `0x0102` (NotConnected), traduzido para painel.
- **Teleporte por comando** (`teleportCmds`):
  - `/azran` gerou `chat command cmd=azran` e `teleport from 2100,2100 to 2500,1716`; A andou 554 tiles, e B, em Armia, deixou de vê-la;
  - `/armia` trouxe A de volta a 2101,2102, e B voltou a vê-la.
- Protocolo limpo nas duas sessões.

Execução 1 ([JSON](2026-09-30-chat-whisper-cut-failed.json)): tudo igual, mas a regra procurava "psiu <marca>" e o runtime exibe "siu <marca>". A regra passou a procurar só a marca.

## Limites

- Só Chromium headless. Não houve comparação com o cliente Windows.
- Loja: uma loja (Aki), um item comprado e um vendido. Venda a partir do equipamento, taxa de cidade e loja de skills misturada não foram exercitadas.
- Banco: uma página, um item, uma conta. O ouro guardado entre sessões não foi exercitado (ficou 0 no fim).
- Teleporte: portais (etapa 4) e comandos `/cidade`. Teleporte pago por tile de NPC não foi exercitado.
- Chat de grupo, guilda e reino não foram exercitados: o servidor os trata como fala comum.
- As recusas do servidor (compra sem ouro, saque acima do saldo) não têm resposta. O cliente não mostra nada, e o harness só confirma que o estado não mudou.
