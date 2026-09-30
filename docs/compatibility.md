# Compatibilidade OpenWyd ↔ servidor Go

Data: 28/09/2026. SHAs fixados em `dependencies.lock.json`. Estado: **auditoria parcial; cliente integrado até o Field com duas sessões** (etapa 3, [evidências](evidence/03-protocolo/README.md), [ADR 002](decisions/002-gateway-and-dialect.md); etapa 4, [evidências](evidence/04-login-mundo/README.md), [ADR 003](decisions/003-in-world-dialect-and-automation.md)).

Fontes principais: servidor `tmserver/internal/protocol/` e `tmserver/internal/handler/`; cliente `Projects/TMProject/Basedef.h`, `CPSock.cpp`, `TMSelectServerScene.cpp`, `TMSelectCharScene.cpp`, `TMFieldScene.cpp`, `TMHuman.cpp`. O [inventário](evidence/01-auditoria/source-inventory.json) lista 102 constantes de opcode Go, 61 atribuições diretas no dispatcher e 69 declarações de opcode upstream. Rotas montadas em loops não estão na contagem de atribuições diretas. Igualdade de opcode não é compatibilidade.

## Convenções e transporte

Nas tabelas, `T/B` = tamanho total/body, em bytes. `bN` é offset depois do header; `@N` é offset absoluto do pacote ou relativo à estrutura nomeada. `i/u` indicam inteiro com/sem sinal. Valores Go são **confirmados em fonte**, não capturas Windows. Valores ABI upstream são **confirmados em execução do probe Clang**, não execução do jogo. Campos não auditados ficam explícitos, sem completar por suposição.

Header: 12 bytes; Size u16@0, KeyWord u8@2, CheckSum u8@3, Type u16@4, ID u16@6, Tick u32@8. Little-endian. Handshake C→S `11 F3 11 1F`, uma vez por conexão. Frame entre 12 e 8192 bytes. Transformação/checksum a partir de @4. O codec Go sinaliza checksum incorreto, mas não o rejeita automaticamente. Framing é fluxo TCP; uma mensagem WS não delimita necessariamente um pacote CPSock.

Etapa 3 (**confirmado em execução**): a tabela tem o mesmo SHA-256 `e47996fe5e92de5d86d503d5415665f1f464bf344370c709be450607dd97cf8f` no C++ do Alan, no Go e no snapshot do legado. Há 97 vetores e 28 fluxos adversariais, gerados por uma referência independente e aceitos pelo codec e pelo `Framer` Go via overlay, e 1002 frames enquadrados pelo runtime WASM com cortes no meio do frame. O cliente enviava o INITCODE e o servidor não envia nenhum, confirmado nos logs do Railway. **Confirmado em fonte:** o cliente verifica checksum; um erro de checksum encerra o laço de leitura de `NewApp.cpp` e descarta o frame. Continua valendo que nenhum vetor é captura do cliente Windows: a paridade com o 7662 original não foi provada.

## Estruturas compartilhadas e ABI

O [probe](evidence/01-auditoria/upstream-layouts.json) mede 135 records diretamente do header original, nos alvos `wasm32-unknown-emscripten` e `i686-pc-windows-msvc`. O segundo é a ABI MSVC modelada por Clang, não uma execução de `cl.exe`. A única declaração auxiliar é HWND, usado por um global extern, não pelos records medidos. Não se força pack(1).

| Estrutura | Go / Alan | Campos e divergência | Verificação necessária |
|---|---|---|---|
| ITEM | 8 / 8 | índice i16/u16@0 conforme codec; 3 pares efeito/valor u8@2..7; Alan também interpreta união short | índices extremos, efeitos e vazio; preservar bytes |
| SCORE | 48 / 48 | Go Level i32@0; Alan short@0 + padding; Ac@4, Damage@8, HP/MP i32@16/20/24/28, atributos i16@32..38. Go Merchant/AttackRun/Direction@12/13/14; Alan Reserved/AttackRun@12/13, padding@14..15 | igualdade de tamanho não basta; sinal, Level e Merchant/Direction |
| SELCHAR | 840 / 904 | 4 slots; XY i16/u16 arrays@0/8, nomes[4][16]@16, score[4]@80; equipamentos@272 são [4][16] Go e [4][18] Alan; Guild@784/848, Coin@792/856, Exp i64@808/872 | quatro classes, slot vazio, último equipamento, exp >32 bits |
| MOB | 816 / 1040 | BaseScore@44 e CurrentScore@92 coincidem; Equip@140 [16]/[18]; Carry[64]@268/284; skills e bônus posteriores deslocados. Go Coin@28; Alan@24. Alan tem dummy[212]@824 e contadores finais | snapshot persistido, nível, ouro, equipamentos/carry e skills sem memcpy |
| Capacidade banco | 128 / 120 | pacote Go contém 1024 bytes de itens; Alan reserva 960 | slots 119, 120, 127; ampliar capacidade/UI interna |

Comentários genéricos de `messages.go` dizem pack(1), enquanto codecs como selchar/mob/party preservam padding natural e outros codecs usam offsets packed. Não aplicar uma regra única de packing. O que o Go efetivamente lê/escreve é o contrato atual; desvios do legado precisam de investigação separada.

## Login, seleção e entrada no mundo

| Pacote / direção / opcode | Go T/B | Alan total | Layout e divergência | Teste necessário |
|---|---:|---:|---|---|
| AccountLogin C→S `020D` | 116/104 | 116 | senha[12]b0, conta[16]b12, reservado[52]b28, versão i32b80, force/save i32b84, adapter[4]i32b88. Alan envia 1758 em seleção e retorno do Field; Compose Go exige 12000 | igualdade byte a byte com credenciais sintéticas; versão incorreta; nenhum segredo em logs/storage/URL |
| CNFAccountLogin S→C `010A` | 2008/1996 | 1928 | SELCHAR@32; banco Go@872, Alan@936; Coin@1896 e AccountName@1900 coincidem apesar da divergência! Go escreve marcador@28=1; Alan reserva SecretCode[16]@12 | quatro slots e 128 itens; não concluir compatibilidade pelos campos finais |
| AccountSecure C→S `0FDE` | 32/20 | 32 | Go token[6]b0, reservado[10]b6, ChangeNumeric i32b16. Alan ItemPassWord[16]@12 + State char@28 + padding. Tradutor: token = 6 primeiros dígitos (teclado limita a 6; excesso recusado), ChangeNumeric = State; apagado após envio | teste unitário OK; criação/validação/rejeição reais pendentes. Atenção: verificação de conta sem PIN **define** o PIN digitado |
| CreateCharacter C→S `020F` | 36/24 | 36 | Slot i32b0, nome[16]b4, classe i32b20 | quatro classes, slot inválido, nome inválido |
| DeleteCharacter C→S `0211` | 44/32 | 48 | Slot i32b0, nome[16]b4, senha[12]b20; Alan senha[16] | falha de credencial e atualização da seleção |
| CNFNew/Delete S→C `0110/0112` | 856/844 | 920 | SELCHAR@16; 4 bytes padding após header | resultado confirmado, não antecipar criação/exclusão |
| CharacterLogin C→S `0213` | 20/8 | 36 | Slot i32b0, Force i32b4; Alan acrescenta SecretCode[16] | enviar tamanho canônico mesmo que decoder Go aceite bytes extras |
| CNFCharacterLogin S→C `0114` | 1832/1820 | 1728 | XY i16b0/2; MOB@16; Slot/ClientID/Weather Go@1040/1042/1044, Alan@1056/1058/1060; ShortSkill[16] Go@1046; extensões Alan diferentes | mapear cada campo efetivamente consumido; spawn real, equipamento, relogin |
| CharacterLogout C→S `0215`; confirmação S→C `0116` | confirmação 12/0 | consumidor a revisar | `character.go` responde sem body após salvar/cancelar estados | retorno à seleção, cancelamento de trade e relogin |
| Falhas S→C `0119/011A/011C/0FDF` | 12/0 | consumidor a revisar | `character.go`, `login.go`, `misc.go` enviam body nil; mapear recusas de personagem, sessão duplicada e PIN | não permanecer em UI de sucesso após erro |

## Mundo, combate e estado

| Pacote / direção / opcode | Go T/B | Alan total | Campos / divergência | Teste necessário |
|---|---:|---:|---|---|
| CreateMob S→C `0364` | 232/220 | 236 | XY@12/14, ID@16, nome[16]@18; Equip u16[16]@34 vs [18]; Affect[32]@66 vs70; Guild@130 vs134; Score@136 vs140; CreateType@184 vs188; anct[16]@186 vs equip2[18]@190 | jogador e NPC, classe, HP, guild/refino, ID ≥1000; nome de jogador contém PK em bytes12..15 |
| RemoveMob S→C `0165` | 16/4 | conferir consumidor | tipo i32b0; entidade no header.ID, ao contrário do spawn | morte, logout e saída de visão |
| Action C↔S `036C/0366/0368` | 52/40 | 52 | XY i16b0/2, Effect i32b4, Speed i32b8, Route[24]b12, TargetXY i16b36/38; Alan destino u16 | duas sessões, tick sincronizado, teleporte/ilusão; posição continua autoritativa |
| Motion C↔S `036A` | 20/8 | 20 | Go motion/parm u16b0/2, NotUsed i32b4 zero; Alan short/short + Direction float32b4 | distinguir broadcast de efeito e direção recebida; animação sem resultado de combate local |
| UpdateEquip S→C `036B` | 60/48 | 68 | Equip u16[16]b0, anct u8[16]b32 vs arrays18 | troca equipamento vista pela segunda sessão |
| UpdateScore S→C `0336` | 152/140 | 152 | SCORE b0; critical/save b48/49; affect u16[32]b50; guild b114/116; resist[4]b118; HP/MP i32b124/128; Go Magic i32b132, cauda[4]b136; Alan Magic u16 e LearnedSkill | não sobrescrever skills com 0xCC da cauda Go; limites e buffs |
| UpdateEtc S→C `0337` | 48/36 | 48 | Hold b0, Exp i64b4, Learn i64b12, bônus u16b20/22/24, Magic u16b26, Coin i32b28. Alan tem 2 máscaras u32 e padding no lugar de Magic | experiência >32 bits, gold e skill points |
| Attack C↔S `0367/039D/039E` | `60+8N` / `48+8N`, N≤13 | 168/72/80 | HP i32b4; Exp i64b12; XY b22..28; attacker u16b30; progress b32; motion b34; critical b36; MP i32b40; skill i16b44; ReqMp i16b46; Dam[N] {target i32,damage i32}b48. Alan chama @16 de ReqMp e não declara ReqMp@58 | HP, miss/block negativos, um/dois/13 alvos; não ecoar dano predito como confirmado |
| SetHpMp S→C `0181` | 28/16 | conferir consumidor | HP/MP/ReqHP/ReqMP i32b0/4/8/12 | dano, cura, morte e poção |
| SetHpDam S→C `018A` | 20/8 | conferir consumidor | HP i32b0, dano i32b4 | HoT/DoT e sinal |
| SendAffect S→C `03B9` | 268/256 | conferir consumidor | 32 entradas de 8 bytes em `affect.go` | tipo/valor/duração e expiração |
| ReqTeleport/ChangeCity/Restart C→S `0290/0291/0289` | 12/0 suficiente para handlers | consumidor a revisar | handlers ignoram body; teleporte usa posição autoritativa; ChangeCity chama `villageAt`, que atualmente sempre retorna -1 | custo, cidade persistida, morte e relogin; registrar ChangeCity inoperante |

## Itens, economia, chat e grupo

| Pacote / direção / opcode | Go T/B | Layout / diferença confirmada | Teste necessário |
|---|---:|---|---|
| SendItem S→C `0182` | 24/12 | lugar u16b0, slot u16b2, ITEM b4; Alan também 24 | slots equip/carry/cargo, remoção índice zero |
| UpdateCarry S→C `0185` | 528/516 | ITEM[64]b0 + Coin i32b512 | inventário completo e gold após relogin |
| UseItem C↔S `0373` | 34/22 | source/destination type/pos i32b0/4/8/12; XY u16b16/18; WarpID u16b20. Alan sizeof36 inclui cauda padding e nome ItemID. **Traduzido** 36↔34 ([ADR 007](decisions/007-inventory-dialect.md)); o eco S→C só existe ao equipar e o runtime o ignora | poção no Railway ([etapa 5](evidence/05-gameplay/README.md)) |
| TradingItem C↔S `0376` | 20/8 | destPlace/destSlot/srcPlace/srcSlot u8b0..3, WarpID i32b4. Troca simétrica e eco do payload: mapeamento **posicional** com o `MSG_SwapItem` (Sour/Dest), TargetID u16→WarpID i32; slots fora das grids do runtime recusados ([ADR 007](decisions/007-inventory-dialect.md)) | equipar/desequipar no Railway com B observando; cargo (fatia 3) |
| DropItem C→S `0272` | 28/16 | source type/pos/rotation i32b0/4/8, XY u16b12/14 | remover apenas após resposta válida |
| GetItem C→S `0270` | 24/12 | Go ItemID i32b0, destType/pos i32b4/8, marcado UNVERIFIED; Alan total28: destType/pos@12/16, ItemID u16@20, XY@22/24 | dependência de backend; validar contra legado/captura antes de codec final |
| CNFDrop/CNFGet S→C `0175/0171` | atual16/4 | `handler/item.go` envia apenas slot i32; Alan espera28 (source/pos/rotate/XY ou destType/pos/ITEM). Spawn do item no chão está explicitamente adiado; sem `0x026E` S→C | **bloqueado pelo servidor**: proposta de entrega separada na [ADR 007](decisions/007-inventory-dialect.md); `0272/0270/0175/0171/016F/026E` continuam descartados |
| DeleteItem/SplitItem C→S `02E4/02E5` | 20/8;24/12 | Slot i32b0, SIndex i32b4; Split acrescenta Num i32b8; consumidor Alan ainda a revisar | limites, quantidade e operação repetida |
| REQShopList C→S `027B` | mínimo14/2 aceito | handler lê Target u16b0; comentário do codec descreve total16 | distinguir mínimo aceito de layout canônico |
| ShopList S→C `017C` | 236/224 | shopType i32b0; ITEM[27]b4; tax i32b220. Mapeamento carry NPC (i%9)+(i/9)*27 | 3 abas e preços autoritativos; não usar RMBShopList de 39 itens |
| Buy/Sell C↔S `0379/037A` | mínimo18/6 aceito | target u16b0, posição NPC/tipo i16b2, posição própria i16b4; buy ecoa comprimento recebido e grava o ouro novo em b8 (@20). Runtime: `MSG_Buy` 24 (padding @18, Coin @20), `MSG_Sell` 20 (padding @18). **Buy traduzido por campo, Sell 20→18** ([ADR 008](decisions/008-shop-cargo-chat-dialect.md)) | **Railway:** venda, compra, recusa sem ouro e clique repetido conferidos com o log do servidor ([fatia 3](evidence/05-gameplay/2026-09-30-shop-bank-chat.md)) |
| Deposit/Withdraw C↔S `0388/0387` | 16/4 canônico | quantia i32b0 via StandardParm. **Repassados** com 16 bytes; o runtime aplica o eco como delta ([ADR 008](decisions/008-shop-cargo-chat-dialect.md)) | **Railway:** depósito/saque de 100 e saque acima do saldo conferidos com o log; interrupção não exercitada |
| UpdateCargoCoin S→C `0339` | atual57/45 | `cargo.go` escreve Coin i32b0 e marca offset UNVERIFIED. Header legado diz usar MSG_STANDARDPARM; 57 também é base decimal do opcode, não prova de tamanho. **Traduzido** 57 → `StandardParm` 16 com Coin @12 (hipótese, [ADR 008](decisions/008-shop-cargo-chat-dialect.md)) | provável divergência do backend; comparar o ouro do banco no cliente com o log do servidor |
| Trade C↔S `0383` | 154/142 | ITEM[15]b0; slots[15]b120 (0xFF = vazio); money i32b135; check u8b139; opponent u16b140. Runtime 156: money@148 vs Go@147, check@152 vs151, opponent@154 vs152. **Mapeado por campo 154↔156 com faixa**; o servidor só encaminha a oferta com o patch `patches/server/0001` ([ADR 010](decisions/010-server-trade-forwarding.md)) | duas sessões com o servidor corrigido publicado (pendente): confirmação, alteração, cancelamento, desconexão e conservação de saldos |
| QuitTrade C↔S `0384` | 12/0 | header só; repassado nos dois sentidos ([ADR 010](decisions/010-server-trade-forwarding.md)) | cancelamento por movimento/logout |
| CNFCheck S→C `0386` | 12/0 | header só; repassado; o runtime marca o próprio check (controle 617). Só existe com o patch `patches/server/0001` | primeira confirmação |
| MessageChat C↔S `0333` | canônico108/96 | Go repassa a fala como veio (140 do runtime) e envia avisos como texto cru terminado em NUL. **Saída repassada com 140; entrada 12..140 → 140 com `String[127]`=0** ([ADR 008](decisions/008-shop-cargo-chat-dialect.md)) | string terminada, limite e encoding legado: fase `chat` |
| MessageWhisper C↔S `0334` | `28+N` / `16+N` | decoder Go lê nome16 b0 e todo o restante como texto; handler encaminha payload original **sem trocar o nome** (lacuna do servidor). Runtime sizeof 160 (nome16 @12, texto128 @28, cor @156, padding @158). **Saída 160→158; entrada 28..158 → 160**. O memo de quem recebe exibe `&String[1]` ([ADR 008](decisions/008-shop-cargo-chat-dialect.md)) | destino inválido, encoding, NUL e cauda de cor; `/cidade` como teleporte |
| MessagePanel S→C `0101` | 140/128 | texto128, tamanho também disponível no Alan | erros legíveis, NUL e texto longo |
| SendReqParty C↔S `037F` | 48/36 | class/pos u8b0/1; level/maxHP/HP u16b2/4/6; party i16b8; nome16 b10; Unk i32b28; target i16b32, padding. Alan MSG_REQParty total44, TargetID i32@40 | convite válido/inválido, líder e limites de HP |
| AcceptParty C↔S `03AB` | 32/20 | líder i16b0, nome16 b2, padding2 final | convite expirado e aceitação duplicada |
| CNFAddParty S→C `037D` | 40/28 | leader/level/maxHP/HP/party u16b0/2/4/6/8, nome16 b10, target u16b26 | atualizar slots e identidade real da entidade |
| RemoveParty S→C `037E` | 16/4 | leader i16b0 + unk i16b2; C→S usa StandardParm | sair, expulsar e limpar UI de todos |
| SetShortSkill C→S `0378` | 32/20 mínimo | SkillBar[4]b0 e ShortSkill[16]b4; `skill.go` persiste/ecoará no login, sem resposta imediata | atualizar atalhos e relogar |
| ApplyBonus C→S `0277` | 18/6 | tipo i16b0, detalhe i16b2, target u16b4; Alan estrutura total20 com padding | atributos/mastery, saldo de pontos e alvo inválido |

## Cobertura restante e dependências

Também é necessário adaptar **formatos de assets**, não só pacotes: o loader original lê arrays crus de STRUCT_ITEMLIST(164)×6500 e STRUCT_SPELL(104)×248 e aplica XOR 0x5A. Os arquivos do operador têm 910.004 e 23.812 bytes, insuficientes para essas leituras. A correspondência exata com os registros 7662 e a conversão de campos estão pendentes; não completar o buffer com zeros para mascarar a incompatibilidade. Ver [preflight de assets](evidence/01-auditoria/assets-summary.json).

A matriz começa pelos fluxos do primeiro marco e expande os principais caminhos de gameplay, mas **não fecha ainda cada consumidor**. O inventário de opcodes e o dump completo de fields/sizeof permitem continuar sem perder os casos não mapeados. Permanecem revisão semântica/capturas de falhas, whisper, atalhos, teleporte, shop/party no Alan, autotrade, refinamentos e mensagens auxiliares visuais. Não habilitar um pacote só porque seu número aparece em ambos os inventários.

Dependências do servidor devem ser entregas separadas com testes: contrato de coleta e confirmações; spawn de item no chão; banco/UpdateCargoCoin; reconciliação entre padding legado e codecs atuais de trade/use/attack. A suspeita de tamanho57 confundido com opcode em CargoCoin é **hipótese fundamentada**, não correção aplicada.

As cenas fazem casts diretos de mensagens (`TMFieldScene::OnPacket`, `TMHuman::OnPacketUpdateScore`). A etapa 3 instalou a tradução antes desses consumidores (`client/dialect/WydDialect.cpp`, ganchos em `CPSock::SendDialect` e `NewApp.cpp`). A etapa 1 permanece **Em andamento**; nenhuma prova multiplayer foi produzida.

## Tradução instalada no cliente (etapa 3)

Qualquer opcode que não esteja abaixo é **descartado e contado** nas duas direções, e o page probe lista os opcodes descartados. O mesmo número de opcode nos dois dialetos não habilita um pacote.

| Direção | Opcode | Ação | Prova |
|---|---|---|---|
| S→C | `010A` CNFAccountLogin 2008 → runtime (SELCHAR 840→904, banco 128, SecretCode zerado) | traduz; Level fora de `short` recusa | Railway + roteirizado + unitário |
| S→C | `0110`/`0112` CNFNew/Delete 856 → 920 | traduz | unitário |
| S→C | `0114` CNFCharacterLogin 1832 → 1728 (MOB 816→1040 campo a campo; Coin@28→@24; Magic/Regen narrowing contado; Quest/Rsv/LearnedSkill[1]/Ext zerados — hipótese) | traduz | unitário |
| S→C | `0364` CreateMob 232 → 236 (Equip 16→18, AnctCode→Equip2, GuildMemberType→GuildLevel; cauda 202..231 contada se não zero) | traduz | unitário |
| S→C | `0165` 16, `036C/0366/0368` 52, `0101` 140, `0102` 16, header-only `0116/0119/011A/011B/011C/011D/0FDE/0FDF` | repassa se o tamanho for exato | unitário; `0101` no roteirizado |
| C→S | `020D` AccountLogin 116 (Version = ClientVersion do canal; TID zerado; senha apagada) | traduz | Railway + roteirizado + unitário |
| C→S | `0213` CharacterLogin 36 → 20; `0211` DeleteCharacter 48 → 44 (senha ≤ 12); `0FDE` AccountSecure 32 | traduz | unitário + decoders Go |
| C→S | `020F` 36, `036C/0366/0368` 52, `0215` 12, `03A0` 12 | repassa se o tamanho for exato | unitário; `03A0` no roteirizado |

## Tradução acrescentada na etapa 4

Decisões no [ADR 003](decisions/003-in-world-dialect-and-automation.md). As fixtures são independentes (`gen_fixtures.py`), iguais byte a byte aos encoders Go via overlay e conferidas campo a campo no teste C++ (364 verificações). A prova online está nas [evidências da etapa 4](evidence/04-login-mundo/README.md).

| Direção | Opcode | Ação | Prova |
|---|---|---|---|
| S→C | `0336` UpdateScore 152 | traduz: Level i32→short (recusa fora do intervalo); CurrHp/CurrMp@136/140 → ReqHp/ReqMp; Magic i32→u16 (overflow zerado e contado); Rsv/LearnedSkill@146/148 zerados em vez de `0xCC` | unitário + Railway (entrada no Field sem descarte) |
| S→C | `03B9` SendAffect 268 → `MSG_UpdateAffect` | traduz: {Type, Value u8, Level u16} → {Type, Level char, Value short}; Level > 127 zerado e contado | unitário |
| S→C | `036B` UpdateEquip 60 → 68 | traduz 16→18 slots | unitário |
| S→C | `0363` CreateMobTrade 252 → 260 | traduz como CreateMob + Desc[24]; Tab[26]→Nick é **hipótese** | unitário |
| S→C | `018A` SetHpDam 20 | traduz: Dam i32→short, overflow zerado e contado | unitário |
| S→C | `0102` MessageBoxOk 16 → `0101` MessagePanel 140 (ID 0) | traduz o código local de `notice.go` para texto fixo | unitário + Railway ("Senha incorreta.") |
| S→C | `0181` 28, `0182` 24, `0337` 48, `0166` 16, `018B` 16, `0185` 528 | repassa se o tamanho for exato (`static_assert` dos offsets) | unitário; `0181/0182/0337` no Railway (poção e loot) |
| C↔S | `0376` SwapItem 20 | posicional; TargetID u16↔WarpID i32 com padding zerado; place ≤2, equip <16, carry <60, cargo <120 | unitário + overlay Go (decoder/encoder reais); Railway |
| C→S | `0373` UseItem 36 → 34; S→C 34 → 36 | por campo; `Header.Size` reescrito; o eco de equipar é entregue e ignorado pelo runtime | unitário + overlay Go; Railway |
| C→S | `0290` ReqTeleport 16, `0291` ChangeCity 16 | repassa se o tamanho for exato; o servidor lê só o header | unitário; teleporte no Railway (ver evidências) |
| S→C | `0367/039D/039E` Attack `60+8N` (N 1..13, até a capacidade do opcode) → 168/72/80 | traduz: ReqMp i16@58→i32@16; CurrentHp@16 do atacante sem campo no runtime; TargetID i32→u16 (overflow zerado e contado); FakeExp 0. Contador `inAttack` ([ADR 004](decisions/004-combat-dialect.md)) | unitário + overlay Go; Railway em [etapa 5](evidence/05-gameplay/README.md) |
| C→S | `0367/039D/039E` Attack 168/72/80 → `60+8N` (N 13/1/2 pelo tamanho, opcode preservado) | traduz por offset; padding e `@16/@58` zerados, TargetID ampliado a i32. Contador `outAttack` | unitário + overlay Go (decoder real) |
| C→S | `027B` REQShopList 16, `0277` ApplyBonus 20 | passam com tamanho exato; layout idêntico (`static_assert`); o servidor lê o alvo u16 / BonusType, Detail, TargetID | unitário; Railway em [skills](evidence/05-gameplay/2026-09-29-skills.md) |
| C→S | `0379` Buy 24 (por campo, padding zerado); `037A` Sell 20→18, `0334` 160→158 (padding descartado); `0387/0388` 16, `0333` 140 | tamanho exato ([ADR 008](decisions/008-shop-cargo-chat-dialect.md)) | unitário + overlay Go |
| S→C | `0379` 24, `037A` 18, `0387/0388` 16 (ecos); `0339` 57 → 16; `0333` 12..140 → 140; `0334` 28..158 → 158 | ecos repassados; `0339`, fala e sussurro traduzidos com terminador garantido | unitário + overlay Go (encoders reais); Railway |
| S→C | `017C` ShopList 236, `036A` Motion 20 | passam com tamanho exato; o `NotUsed`=0 do Motion vira `Direction` 0,0 | unitário; Railway em [skills](evidence/05-gameplay/2026-09-29-skills.md) |
| C→S | `0289` Restart 12, `0369` ReqMobByID 16, `03AE` 16 | repassa se o tamanho for exato; `03AE` não tem rota no servidor (só log `routed=false`) | unitário |

Continuam descartados e contados: itens no chão (`0272/0270/0175/0171/016F/026E`, lacuna do servidor), split/delete `02E5/02E4` e os demais opcodes da matriz acima (etapa 5, fatias seguintes). O combate foi traduzido em 29/09 ([ADR 004](decisions/004-combat-dialect.md)); com isso `DEFERRED_INBOUND` ficou vazio e nenhum descarte é mais tolerado nas verificações.
