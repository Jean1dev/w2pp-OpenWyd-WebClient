# Cliente Windows 7662 fecha ao entrar no Field — 01/10/2026

## Sintoma

Relato do operador: abrindo o jogo pelo launcher (`wyd-plataforma/launcher`), o login, o PIN e a seleção funcionam; ao clicar em entrar, o jogo fecha. O mesmo já tinha acontecido antes.

## Evidências

**Confirmado em execução:**

- **Relatório de falhas do Windows** (log Application, eventos 1000/1001): `wyd.exe` (carimbo `0x5594c797`, pasta `Client-aws`) falhou às 12:59:21 (−03:00) no módulo `C:\Windows\System32\msmpeg2ac3dec.dll` 10.0.26100.9549, código `0xc0000602` (`STATUS_FAIL_FAST_EXCEPTION`), deslocamento `0x00053ebc`. A mesma assinatura aparece em 29/09 às 09:52, 09:52 e 12:20: é a recorrência citada pelo operador. Sistema: Windows 10.0.26300.
- **`WYD.log` do cliente:** termina em `>> Init Field Scene::End` às 12:59:20, um segundo antes da falha, sem erro do jogo. (`Error in Init Render Target Texture` aparece na inicialização, antes do login; não está ligado ao fechamento.)
- **tm-server no Railway** (deploy `2e532af`, 15:56–16:02 UTC, log consultado e não versionado por conter conta e IP): `account login: OK`, PIN (`0x0FDE`), `character login request slot=2`, `CNFCharacterLogin path=template class=3` (caminho normal), depois `0x0336`, `0x0166` e 24 `0x0364`. Às 15:59:26 UTC, `connection drop reason err=EOF`, sem WARN, ERROR ou panic. O servidor só viu o fim da conexão.
- **Deploy do dia:** `98286fdf` → `2e532af` (PRs #358 e #359) muda apenas troca, recusa de exclusão e fim de sessão; não toca login nem visão do mundo.
- **Launcher:** inicia `wyd.exe` na pasta configurada (`gameDirectory` = `Client-aws`) e faz proxy TCP `127.0.0.1:8281` → servidor apenas com `pipe`. A linha `connection sent no data` do servidor é a sondagem do launcher antes de iniciar o jogo.

## Causa

**Confirmado em execução:** o processo é encerrado pelo decodificador de áudio do Windows, não pelo servidor nem pelo launcher.

**Hipótese (fonte decompilada OpenWyd `beb9f69b`, não verificada no executável):** ao entrar no Field, `TMFieldScene.cpp:6946-6952` destrói o `DS_SOUND_MANAGER` e cria outro para tocar a música da cidade. A limpeza do grafo (`DS_SOUND_CHANNEL::CleanGraph`, `DirShow.cpp:196-201`) remove cada filtro e chama `Release()` em loop até a contagem de referências chegar a zero, mesmo com o DirectShow ainda referenciando o objeto. O decodificador `msmpeg2*` atual detecta o uso inválido e aplica fail-fast. Isso explica por que a música de login toca e a falha vem na primeira troca de música.

## Contorno aplicado

`NewApp.cpp:601` só cria o gerenciador de música com `m_nMusic = Config.Config[3] > 0`, e `TMFieldScene.cpp:6946` pula a troca sem ele. No `Config.bin` do cliente do operador (`SaveUpdatAndConfig`: `short Version; short Config[14]`, 30 bytes), `Config[3]` (offset 8) estava em 20 e foi alterado para 0. Apenas esse byte mudou (`cmp`); o original ficou em `Config.bin.bak-2026-10-01` na mesma pasta. Equivale a zerar o volume de música nas opções do jogo.

**Confirmado em execução (13:10, −03:00):** com a música em 0, o operador entrou no jogo pelo launcher com o mesmo personagem (slot 2, classe 3). O `WYD.log` registra `Init Field Scene::End` às 13:10:51; o tm-server enviou a entrada no mundo e 102 frames (50 `0x0364`, 44 `0x0165`), e a sessão terminou às 16:11:15 UTC por EOF, sem nova falha no log Application do Windows (a última continua sendo a das 12:59:21). A música na troca ao entrar no Field é a causa. O mecanismo exato (liberação excessiva vs. falha própria do decodificador ao montar o grafo) segue como hipótese.

## Correção definitiva (não feita)

No cliente Windows: hook em `ClientPatch_v7662.dll` para `CleanGraph` não liberar além da própria referência, ou trocar a reprodução de música. Exige análise do executável e é entrega separada. O cliente web não é afetado: toca a música pelo navegador (`wyd_audio_play_music_file`).
