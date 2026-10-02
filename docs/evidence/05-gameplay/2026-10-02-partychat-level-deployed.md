# Etapa 5: chat de grupo e nível com os PRs #364 e #365 implantados (02/10/2026)

Ambiente:
- Railway `tm-server`, deploy `bc7b3923` (merge do #365, que já contém o #364 `f9970da7`), `ClientVersion=12000`;
- contas A e B de `.env`; WASM `tmproject_startup.1790883428920400700`, sem rebuild.

## Chat de grupo (`login,enter,second,partychat`): **aprovado**

Execução 3, 11:27–11:46 UTC; [JSON](2026-10-02-partychat-passed.json), [log do servidor](2026-10-02-partychat-passed-server.txt).

| Passo | Resultado |
|---|---|
| Grupo formado pelos cliques originais | `0x037F` / `0x03AB` roteados |
| A (líder) fala `=…` | `0x0334` de 146 bytes; B mostra a linha com o nome de A; A não recebe aviso |
| B (membro) fala `=…` | A mostra a linha com o nome de B; B não recebe aviso |
| B digita `partychat` | sai como `0x0333`; B mostra "Party Chatting : Off" |
| A fala com o canal de B desligado | B não mostra nada (espera de 20 s) |
| B digita `partychat` de novo | "Party Chatting : On"; a fala seguinte de A chega |
| B sai pelo "Sair do Grupo" | `0x037E` roteado; A e B sem grupo |
| A tenta falar `=…` sem grupo | o runtime não envia, como o original |

- O botão `B_CHAT_PARTY` (65678) não estava visível no layout. O toggle foi digitado na caixa de chat, que o runtime envia como fala comum (`0x0333`), igual ao botão.
- Protocolo limpo: nenhum descarte do dialeto, nenhum erro de página.

**Execuções anteriores:**
- **Execução 1 (10:55):** interrompida pelo deploy do #365 às 11:01, que reiniciou o tm-server.
- **Execução 2** ([JSON](2026-10-02-partychat-run2-leave.json)): todo o chat passou, e só a saída do grupo reprovou. Causa (confirmada em captura): o `say` do harness fechava os painéis com Esc antes de abrir o chat, inclusive a janela do grupo onde fica o "Sair do Grupo". As falas da fase passaram a usar `keepPanels`.

## Nível e defesa com o #365

- A fase `enter` mostra o mesmo nível na seleção e no HUD (6 e 6; antes eram 5 e 6). A defesa de A foi de 37 para 38 (+1 por nível, como no legado).
- O TK de B (Exp 0) aparece como "Nv 1" no HUD (nível 0 no fio).

## Migração `0025` e sessão online (confirmado em execução)

- A migração consta em `schema_migrations`, mas, logo depois do deploy, o TK de B ainda estava no nível 1 com Exp 0.
- B estava online na execução 1 durante o deploy. A explicação provável é que o tm-server tenha salvo o personagem com o nível antigo ao desligar, depois que a migração rodou.
- O mesmo `UPDATE` da migração foi reaplicado no banco de testes e afetou exatamente essa linha.
- **Cuidado operacional:** migrações que mudam dados de personagem devem rodar com os jogadores deslogados, ou depois que o tm-server salvar e parar.
