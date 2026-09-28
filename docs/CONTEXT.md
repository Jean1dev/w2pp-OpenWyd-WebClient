# Contexto técnico e decisões iniciais

Atualização de execução em 28/09/2026: a continuidade do OpenWyd foi confirmada pelo usuário. Servidor-alvo `98286fdf`, Emscripten6.0.0 compilado/linkado localmente e incompatibilidades adicionais de assets identificadas. O [ADR001](decisions/001-client-architecture.md), a [matriz](compatibility.md) e as [evidências](evidence/01-auditoria/README.md) complementam/superam hipóteses históricas abaixo; não há gameplay validado.

## Objetivo e escopo

Ter nossa versão jogável de WYD no navegador, ligada ao servidor Go existente. Primeiro desktop web; depois melhorias de experiência e mobile. Electron, novos sistemas de economia, automação Idle e mudança de regras não fazem parte do primeiro marco.

O backend possui `tmserver` (mundo/CPSock), `dbserver` (PostgreSQL/pgx), `binserver` (billing), `webserver` (contas/API), `internal` compartilhado, `Source` legado de servidor e `Release` com dados. `Source/Code/ClientPatch_v7662` é um patcher: não é o código-fonte gráfico do cliente.

Topologia proposta, a confirmar na auditoria:

```text
navegador -- HTTPS --> app + assets
    |
    +-- WSS --> gateway -- TCP privado --> tmserver:8281
                                           | gRPC
                                           +--> dbserver / binserver
portal web -- API existente de contas ------> webserver
```

Não suponha que a API web já ofereça login de jogo, tickets ou retomada: inspecione contratos reais. Se faltar uma capacidade, registre a mudança no backend necessária, sem simular sucesso. O gateway pode ser implementado separadamente; escolha a linguagem na etapa 1 considerando manutenção, backpressure e integração.

## Baseline de protocolo

Confirmado por leitura do checkout do servidor em `8a14bcc52bbe1636886e0e7e25a7ed735d5570dc`:

| Elemento | Valor / referência relativa ao servidor |
|---|---|
| Header | 12 bytes, `tmserver/internal/protocol/header.go` |
| Handshake | `0x1F11F311`, bytes `11 F3 11 1F` |
| Limite de pacote | 8192 bytes, incluindo header |
| Campos header | Size u16 @0, KeyWord u8 @2, CheckSum u8 @3, Type u16 @4, ID u16 @6, Tick u32 @8 |
| Transformação | Tabela estática CPSock; primeiros 4 bytes não ofuscados |
| Versão padrão | `AppVersion=7640`; `tmserver/cmd/tmserver/main.go` permite `-client-version` / `W2PP_CLIENT_VERSION` |
| Variante em uso | Comentários e session primer mencionam cliente enviando 12000; verificar configuração efetiva |
| Seleção | `STRUCT_SELCHAR=840`; confirmação de login total 2008 bytes (`selchar.go`) |
| Item / score | 8 / 48 bytes; Level int32 no codec de seleção |

Builders Go frequentemente retornam apenas BODY; `Encode` acrescenta header. Não comparar tamanho de body com pacote completo. Índices `[0,1000)` são jogadores; mobs/NPCs compartilham o espaço de índices acima desse limite. Alinhamento legado é natural MSVC x86, não `pack(1)`.

## Rota de implementação

Investigar porte do runtime C++ de `alanpetry/OpenWyd`, compilado via Emscripten para WASM/WebGL. Preserva lógica de apresentação e formatos existentes e concentra mudanças na plataforma e no protocolo. Não é conexão plug-and-play.

A análise histórica reportou no upstream 18 equipamentos, 120 slots de cargo e Level short, contra 16, 128 e Level int no nosso dialeto. Reportou também diferenças em seleção/login/CreateMob. Revalidar **cada estrutura consumida ou emitida**; não considerar a lista exaustiva. Os 60/68 opcodes coincidentes são apenas uma comparação histórica de números, não prova de semântica compatível.

A auditoria deve distinguir caminhos do upstream: o app web de inspeção de assets e o runtime `startup_harness` podem ter dependências diferentes. Não assumir que uma API de assets é obrigatória para todo build.

Se o reaproveitamento não for viável, registrar alternativa de implementação própria (por exemplo TypeScript/WebGL), custo, parsers necessários e marco mínimo. Não iniciar duas engines em paralelo. Trabalhos independentes de código externo, como fixtures e gateway próprio, podem avançar enquanto uma dependência está pendente.

## O que sabemos do Valthera em 28/09/2026

O site `wyd.vektar.tech` passou a usar o nome Valthera. HTML/JS públicos indicam porte OpenWyd, grupos, toque, retomada de WebSocket e atualização de versão; identificadores observados principalmente de 17–18/09. Não testamos gameplay nem confirmamos implementação do backend. Não localizamos fonte correspondente ou licença das alterações. Não é base disponível para importar.

O upstream público do Alan permanece em `beb9f69bdea6d81f70af14b5ce85ed064575bb26` (04/08/2026). API retornou licença null e zero forks públicos; README menciona intenção GPL-3.0+. Registrar proveniência sem assumir conclusão jurídica a partir desses metadados. Não atribuir licença nova a código de terceiros.

## Cuidados com documentação histórica

Os snapshots incluídos preservam achados, mas também conclusões antigas e estimativas. A afirmação de que transporte está comprovado end-to-end era baseada em inspeção estática. O conselho de usar submodule como solução de licença não deve ser seguido. A pesquisa de junho que negava existência de fonte gráfica antecede o OpenWyd. O session primer usa 12000, enquanto o protocolo define padrão 7640. A etapa 1 resolve essas diferenças com fontes fixadas e testes.
