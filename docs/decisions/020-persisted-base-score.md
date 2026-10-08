# ADR 020: base de atributos persistida no servidor

Data: 08/10/2026. Estado: **em produção desde 08/10 (servidor `cd5839c8`, db-server `34a6aa7d`, tm-server `ae9d13e3`); migração 0027 aplicada e base gravada no relogin, confirmado em execução**. PR [#378](https://github.com/Jean1dev/w2pp-OpenWYD/pull/378), espelhado em `patches/server/0012-persist-base-score.patch` (sobre o `main` do servidor em `0b9a6774`).

## Contexto

Um jogador mandou uma print da versão web com **FOR −88 e INT −88**, num personagem mortal de nível 399 da classe Caçadora ([evidência](../evidence/05-gameplay/2026-10-08-trash-delete.md#print-do-jogador-08102026)).

Leitura somente leitura no banco de produção (transação `READ ONLY`):

- o personagem tem `str = int = -88`, `dex = 2412` e `con = 760` gravados;
- nenhum item equipado dá FOR, INT, DES ou CON, nem no catálogo nem na instância;
- outra Caçadora de nível 399 tem `12/12/3360/12` (soma 3396). A soma do personagem é **3396 − 400**: **exatamente 100 a menos em cada um dos quatro atributos**, a partir de `12/12/2512/860`.

Confirmado em fonte, servidor `b8488a56`:

- a tabela `character` guarda o **CurrentScore** (base + equipamento) em `str/int/dex/con` e `max_hp/max_mp`;
- no login, `deriveBaseScore` (`handler/item.go:2264`) reconstrói a base como **salvo − bônus do equipamento calculado com as regras daquele momento**;
- qualquer mudança dessas regras entre um save e o login seguinte desloca a base de vez;
- a escala de refino de 17/08 (`51574996`, ADR do servidor #282) dobrou a **Pedra Amunra +9** de +100 para **+200** em cada atributo. Um personagem salvo com ela a +100 e carregado a +200 perde 100 em cada atributo, e a perda continua depois que a pedra sai.

Que o personagem usou uma Amunra +9 é **hipótese**: o padrão −100 × 4 bate exatamente com ela, mas o banco não guarda o equipamento de antes. O defeito em si, a base dependente das regras do momento, está **confirmado em fonte e em teste**.

## Decisão (do usuário, 08/10)

- Corrigir a causa e garantir que não volte. **Não** corrigir os dados gravados: o servidor está em alfa e os jogadores sabem.
- Base persistida, no mesmo modelo da maestria (`special` = `BaseScore.Special`, já persistida):
  - a migração **0027** cria `base_str/int/dex/con` e `base_max_hp/mp`, com NULL significando "ainda não salva";
  - o mundo sempre salva a base que simula, e o login a usa como foi salva. O `refreshScore` do login recalcula o CurrentScore com as regras de hoje: uma mudança de regra move o CurrentScore, nunca a base;
  - uma linha anterior à 0027 deriva a base uma última vez, e o próximo save a grava;
  - um save que não traz a base (tm-server antigo, por exemplo num rollback) **limpa** a base gravada. Assim uma base desatualizada nunca é usada, e as duas ordens de deploy são seguras;
  - uma base derivada negativa gera log `derived base score is negative`.

## Garantias (testes)

- `TestBaseScoreSurvivesItemRuleChange`: o caso relatado (salvo a +100, carregado a +200), uma segunda mudança de regra e a retirada da pedra. Sem a correção, mostra 112 em vez de 212.
- `TestBaseScoreLegacyRowDerivesOnceThenPersists`.
- Mapeamento do proto nos dois sentidos (`dbclient` e `dbserver`).
- `TestBaseScoreColumns` (`-tags=integration`, Postgres 16): ida e volta, NULL numa linha anterior à 0027 e limpeza num save sem base.

Os testes de unidade rodam na CI do servidor; o de integração exige Postgres e não roda na CI hoje.

## Consequências

- O personagem do relato continua com −88 até o operador decidir corrigir os dados. Depois do deploy, a base dele passa a ser gravada como está (−88/−88/2412/760) e deixa de mudar.
- Um personagem que ainda use uma Amunra +9 salva no tempo de +100 terá a base derivada uma última vez no primeiro login depois do deploy, como hoje.
- O alerta no log mostra quando isso produz base negativa.

## Deploy (08/10/2026)

- O #378 foi mergeado em `cd5839c8`. O db-server (`34a6aa7d`) e o tm-server (`ae9d13e3`) foram implantados com SUCCESS, e o tm-server subiu limpo.
- No banco (leitura `READ ONLY`): as 6 colunas `base_*` existem. Antes de qualquer login, nenhuma linha tinha base.
- Relogin do personagem de teste A (`verify_world.mjs --phases login,enter`, ok): `base 12/12/12/12` gravada, igual ao CurrentScore, porque a arma inicial não dá atributo. Na mesma leitura, outra linha também já tinha base (um jogador que logou).
- Log do tm-server desde o deploy: nenhum `derived base score is negative`, nenhum erro.
