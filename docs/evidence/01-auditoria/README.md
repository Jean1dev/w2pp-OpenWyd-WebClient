# Evidências da etapa 1 — 28/09/2026

## Estado observado

**Confirmado em execução:** o código original do Alan compila localmente para WASM, com os 114 objetos certificados na segunda tentativa, link estrito sem símbolos indefinidos e módulo válido com exports de ciclo de vida. Isso comprova viabilidade inicial da rota de continuidade; não comprova uma cena renderizada ou integração com o servidor Go.

**Confirmado em fonte:** o `main` remoto do servidor observado é `98286fdf01202f503523e89d3e50b2183f00c36c`; OpenWyd é `beb9f69bdea6d81f70af14b5ce85ed064575bb26`. Servidor tem apenas main no resultado da API de branches consultada. Os checkouts isolados estão em `external/server` e `external/OpenWyd`, sem modificações em arquivos versionados; nenhum outro worktree foi alterado.

Cliente próprio começou em `b60db820aa84e3ded322a64ebdd2d99e14b9b6f2`. Os diretórios external/cache estão ignorados pelo Git. Não houve commit, push, fork remoto ou publicação.

## Artefatos pequenos versionados

- [source-inventory.json](source-inventory.json): SHAs e hashes das fontes, opcodes, 61 atribuições diretas de rotas e diff do baseline. São 102 constantes Go e 69 declarações upstream, sem afirmar correspondência semântica entre elas.
- [upstream-layouts.json](upstream-layouts.json): offsets/tipos/tamanhos obtidos do compilador para 135 records em cada alvo; nenhum difere entre wasm32 e o modelo Clang MSVC x86 nesse header. As divergências com o servidor são outra comparação, descrita na matriz.
- [verification.json](verification.json): resultados, skips, primeira falha de certificação, segunda compilação, link e validação estrutural do WASM.
- [assets-summary.json](assets-summary.json): ausências, arquivos vazios e incompatibilidades de tamanho, sem bytes dos assets. O manifesto completo de 7.092 arquivos fica em `.cache/operator-assets-with-layouts.json`; tamanho/hash/localização estão no resumo.

## Comandos e resultados

Reprodução detalhada: [setup](../../setup.md).

| Verificação | Resultado observado | Limite da prova |
|---|---|---|
| `git ls-remote`, API GitHub e `git diff 8a14bcc HEAD` | main atualizado, 74 arquivos alterados; nenhum codec Go alterado | não comprova equivalência de gameplay |
| `tools/audit_sources.py` | inventário gerado; rejeita HEAD diferente do lock e alterações tracked | não mede execução dos handlers |
| `tools/probe_upstream_layouts.py` | 135 layouts/alvo, 0 diferenças entre os dois alvos | Clang não é cl.exe, nem captura do cliente Windows |
| Go `test -json ./tmserver/internal/protocol` | pacote PASS; 111 pass incluindo subtestes, 2 skips, 0 fail | sem race, stack real ou vetores de captura válidos |
| Python `test_wasm_socket_bridge.py` | 6/6 pass | contratos estáticos da bridge, não socket real |
| Python `test_wasm_link_freshness.py` | 16/16 pass | testes isolados usam mock de compilação |
| Builder de objetos, tentativa 1 | 114 compilados, saída2, fingerprint mudou, não certificado | resultado recusado, não tratado como build aprovado |
| Builder de objetos, tentativa 2 | 114/114, 109.997 ms, saída0, contrato certificado | sem assets ou browser |
| Linker `--dev --jobs 4 --link-opt-level O2` | saída0, 114 objetos incrementais + bridge/entrypoint, 0 símbolos indefinidos | assets externos ainda não montados |
| Node `tools/verify_wasm.mjs` | WASM de 1.893.013 bytes válido, 896 exports, quatro exports essenciais presentes | módulo compilado pelo Node; runtime não instanciado |
| `tools/audit_assets.py` com a pasta fornecida | saída2; 7.092 hashes; 318.725.705 bytes; 20 padrões ausentes e 2 derivados upstream ausentes | não importa assets; não prova compatibilidade de formatos |

Revisão final: inventário de fontes regenerado com hash idêntico; sintaxe dos três scripts Python verificada por `py_compile`; saída do preflight dentro da pasta de assets foi recusada com código2 e nenhum arquivo criado; `git diff --check` passou. Git exibiu apenas aviso de normalização LF/CRLF em `.gitignore`.

Skips Go: `TestAuthGameLayout` (billing interno não validado) e `TestTransportVectors/_schema_example.json` (hex vazio). O teste-pai de transporte pode passar mesmo sem executar vetor real: não usar seu PASS como prova de paridade CPSock.

O primeiro download Go via Invoke-WebRequest foi interrompido sem progresso; curl baixou o arquivo oficial, hash foi conferido e Go executou com versão1.25.13. Uma chamada exploratória a em++.bat falhou porque a distribuição instalada oferece em++.exe; os builders usaram o executável correto. Os warnings de includes com capitalização Windows/D3D9 permanecem registrados nos logs locais. Comandos exploratórios com globs incompatíveis com PowerShell foram corrigidos nas consultas seguintes.

## Lacunas reais

1. **Assets:** ItemList e SkillData são menores que os arrays lidos pelo Alan. Faltam fontes no diretório fornecido, derivados optimized-hd e outros padrões do manifesto. Parte das ausências é redundante/opcional; é preciso ligar cada uma ao consumidor antes de definir o pacote mínimo. Env/AttributeMap.dat já existe e é a localização aberta pelo runtime.
2. **Atlas GDI:** o gerador usa um layout portátil MSVC14.29/SDK específico ausente. Visual Studio BuildTools existe em outro local, mas não foi adaptado nem executado para gerar atlas.
3. **Protocolo:** há divergências explícitas de login, snapshots, capacidades, chat, trade e combate. A matriz ainda tem consumidores a revisar. Capturas controladas e testes da futura adaptação não foram executados.
4. **Backend:** GetItem/acks de coleta/drop, spawn de item no chão, CargoCoin e ChangeCity têm implementação provisória/ausente ou divergências de layout. Corrigir em entrega separada, com evidência Windows, sem alterar o servidor para acomodar o Alan.
5. **Segurança de integração:** harness persistindo credenciais/query e proxy com alvo livre devem ser substituídos antes de uso. O framer Go também inclui bytes iniciais em erro de handshake; não capturar sessões com credenciais reais por esse caminho antes de revisar sanitização em entrega separada.
6. **Distribuição:** declarações de autoria/licença e materiais históricos têm escopos distintos. A auditoria não autoriza redistribuição integral. Nenhum asset, binário ou fonte de terceiros foi adicionado ao Git do cliente.

**Não executado:** login, criação de contas, conexão a terceiros, renderização, duas sessões, comparação Windows7662, relogin, persistência, benchmarks, browsers ou deploy. A etapa1 permanece Em andamento e a etapa2 não foi validada por um artefato sem cena.
