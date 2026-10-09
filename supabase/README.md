# Supabase — banco do RotaFibra (Fase 2)

Esta pasta guarda o banco do servidor. **O app ainda não fala com ele** (isso vem nos próximos passos);
aqui está só o esquema, as regras de acesso (RLS) e os testes que provam que elas funcionam.

```
supabase/
  migrations/   15 arquivos SQL pequenos, aplicar em ordem
  conferir-passo-1.sql   diz, item por item, se o banco ficou completo
  tests/        testes do banco (Postgres local) e o script de verificação direto na API
```

## O que o banco faz

- **Mesmas tabelas do app** (atividades, elementos, cabos, fotos, trilha), com geometria PostGIS calculada no servidor
  a partir de `lat`/`lng` e dos `vertices` do cabo.
- **Quem pode o quê:** técnico lê a rede toda e cria/edita **só o que é dele**; escritório lê tudo e não edita dados
  de campo; admin gerencia perfis. A trilha GPS de um técnico só é lida por ele, pelo escritório e pelo admin.
- **Cadastro com aprovação:** quem pede acesso pelo app nasce **pendente** (`active = false`): não lê nem grava nada,
  só enxerga o próprio perfil. O admin aprova marcando `active = true`; o banco registra quem aprovou e quando
  (`reviewed_by`, `reviewed_at`). Papel e "ativo" digitados no cadastro são ignorados: só o nome vale.
- **Ninguém apaga linha.** A exclusão é lógica (`deleted = true`), como no app.
- **Reenviar nunca duplica:** o envio é um *upsert* por `id` (UUID gerado no aparelho).
- **Conflito:** vence o `updated_at` mais recente; o envio atrasado e diferente vai para `sync_conflicts` (só o admin lê).
  Relógio adiantado é limitado a "agora + 5 min".
- **Fotos:** bucket privado `fotos`, caminho `<id-do-dono>/<id-da-foto>.jpg`, só JPEG, até 3 MB.

## Preparar o projeto (uma vez)

1. No [supabase.com](https://supabase.com), crie um projeto (plano gratuito). Guarde a senha do banco.
2. **Cadastro com aprovacao** (*Authentication -> Sign In / Providers*; os nomes dos menus mudam de vez em quando):
   - **Ligue** *Allow new users to sign up*: o tecnico pede acesso pelo proprio app. Ele nasce pendente e nao ve nada ate voce aprovar.
   - **Desligue** *Confirm email*: o e-mail embutido do Supabase so entrega para a equipe do projeto, entao a confirmacao
     por e-mail nao chegaria aos tecnicos. Como o e-mail nao e verificado, **aprove so quem voce conhece** (confira o
     nome e o e-mail do pedido por outro canal).
   - Em *Password* (ou *Password security*), defina a **senha minima em 8 caracteres** ou mais.
3. **Aplique as migrations, em ordem** (cada uma **uma vez só**). `supabase db push` nao e um arquivo: e um comando do
   Supabase CLI, que so vale a pena se voce tiver o repositorio no seu computador. O caminho simples nao instala nada:
   - *SQL Editor:* no painel do Supabase, **SQL Editor -> New query**, cole o conteudo de **um arquivo de
     `supabase/migrations/` por vez, na ordem do nome**, e clique em **Run**. Sao 15 arquivos (`...150000_perfis`,
     `...150100_tabelas_atividades_elementos`, `...150110_tabelas_cabos_fotos`, `...150120_tabelas_trilha_indices`,
     `...150130_regras_de_conflito`, `...150140_permissoes_e_rls`, `...150200_fotos`, `...150300_painel`, `...150400_aprovacao_de_acesso`,
     `...150500_admin_auditoria`, `...150510_admin_edita_tudo`, `...150520_admin_pessoas`, `...150600_projetos`, `...150700_projetos_desenho`, `...150800_cabos_fibras`).
     Cada um termina com uma linha `-- fim: ...`: **confira no editor se ela esta la** antes de rodar. Os arquivos tem
     menos de 100 linhas de proposito: um colar a partir de um visualizador que corta em 100 linhas ja chegou truncado
     ao editor (erro de sintaxe no fim do texto), e as migrations sao so ASCII porque o editor ja reescreveu um script
     com acentos e o quebrou. Se o editor perguntar sobre "Row Level Security", o nosso SQL ja liga a RLS em todas as
     tabelas: qualquer botao serve (se der erro de sintaxe, use "Run without RLS").
   - **Confira o resultado:** rode `supabase/conferir-passo-1.sql` (arquivos 1 a 9: as 16 linhas devem dizer `OK`) e
     `supabase/conferir-admin.sql` (arquivos 10 a 12, do administrador: as 10 linhas devem dizer `OK`) e
     `supabase/conferir-projetos.sql` (arquivo 13, dos projetos designados: as 6 linhas devem dizer `OK`) e
     `supabase/conferir-desenho.sql` (arquivo 14, do desenho do projeto: as 3 linhas devem dizer `OK`) e
     `supabase/conferir-fibras.sql` (arquivo 15, das fibras e ligacoes de cabos: as 3 linhas devem dizer `OK`). `FALTA` indica
     qual parte nao foi aplicada ate o fim. Os arquivos 14 e 15 (e o de aprovacao de acesso) **podem ser colados de novo sem erro**: so cria
     o que ainda nao existe, entao serve tambem para completar uma colagem cortada. Os outros dao "already exists" se repetidos:
     isso quer dizer que ja estavam aplicados (confira com o `conferir-...` correspondente).
   - *CLI* (com o repositorio no computador, dentro da pasta do projeto): `npx supabase init`, `npx supabase login`,
     `npx supabase link --project-ref <ref>` e `npx supabase db push`. O `<ref>` e o trecho da URL do projeto
     (`https://<ref>.supabase.co`). Nao misture: se aplicou pelo SQL Editor, nao use `db push` depois para as mesmas migrations.
4. **Como as pessoas entram:** pelo app (passo 2 da Fase 2) elas pedem acesso com nome, e-mail e senha. Quem for criado
   direto em *Authentication -> Users -> Add user* tambem nasce pendente.
5. **Aprovar e definir papeis.** Depois que existir um administrador, **tudo isso se faz no proprio app**: *Configuracoes ->
   Administracao -> Pessoas* (aprovar, recusar, desativar, reativar e mudar o papel, com confirmacao). Sem o app, vale o
   *Table Editor -> profiles*: a fila de pendentes e `active = false` e `reviewed_at` vazio; para aprovar, mude `active`
   para `true`; ajuste `role` (`tecnico`, `escritorio` ou `admin`) se precisar.
   O **primeiro admin** voce faz no *SQL Editor* (a conta dele precisa existir):
   ```sql
   update public.profiles set role = 'admin', active = true
   where id = (select id from auth.users where email = 'voce@empresa.com');
   ```
   Limite conhecido: sem e-mail configurado (SMTP proprio), "esqueci minha senha" nao funciona. Se alguem esquecer, o admin
   apaga o usuario em *Authentication -> Users* e a pessoa pede acesso de novo.
6. **Guarde a URL e a chave publica** (*Project Settings*): a **Project URL** fica em *Data API* (ou na pagina inicial do
   projeto) e a chave em *API Keys*, na secao **Publishable key** (linha `default`, comeca com `sb_publishable_`). E o
   novo nome da antiga *anon key* e foi feita para ficar no app. Coloque as duas em `.env.local` (que nao vai para o Git)
   e, para o app publicado, como **variaveis do repositorio** no GitHub (*Settings -> Secrets and variables -> Actions ->
   Variables*):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...      # o nome da variavel e antigo; o valor e a Publishable key (ou a anon key legada)
   ```
   **Nunca** use a **Secret key** (a antiga `service_role`, comeca com `sb_secret_`) no app, no GitHub nem em conversa:
   ela ignora todas as regras de acesso.

## Verificar direto na API (critério de aceite)

Depois de aplicar as migrations, crie **2 usuários técnicos de teste** (e, se quiser, 1 de escritório) e rode:

```bash
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=sb_publishable_... \
USER_A_EMAIL=a@teste.com USER_A_PASSWORD=... \
USER_B_EMAIL=b@teste.com USER_B_PASSWORD=... \
[USER_C_EMAIL=c@teste.com USER_C_PASSWORD=...]   # escritório (opcional) \
node supabase/tests/api-check.mjs
```

O esperado é `TUDO OK`. O script tenta, pela API e como o usuário B: editar, sobrescrever, apagar e criar em nome de A,
promover a si mesmo, ler sem login, enviar foto para a pasta de A. **Se alguma linha disser `FALHA`, não siga em frente.**
Ele deixa registros marcados `[verificação RLS]` (já como excluídos) e uma foto de 1 pixel no bucket.

## O administrador (migrations 10, 11 e 12)

O administrador **ativo** pode alterar qualquer atividade, elemento, cabo, foto e ponto de trilha de qualquer tecnico
(inclusive "excluir", que e sempre logico: continua nao existindo DELETE para ninguem). O que garante o resto:

- **O dono nunca muda** (gatilho `sync_guard`): nem o administrador troca o `owner_id`.
- **Quem alterou fica gravado:** `updated_by` (preenchido pelo servidor a partir do login) e, quando quem altera nao e o dono,
  uma linha em `admin_edits` com quem, quando, **como era e como ficou**. So o administrador le; ninguem escreve nessa
  tabela pela API (so o gatilho `log_admin_edit`).
- **Nao cria registro em nome de um tecnico nem dentro da atividade dele.** O envio do app e um
  `INSERT ... ON CONFLICT DO UPDATE` e o Postgres confere a politica de INSERT na linha proposta antes de decidir que e uma
  alteracao; por isso o administrador tem politica de insert, so para linhas em nome dele, e o gatilho
  `check_child_owner` (so dispara em insercao de verdade) exige que registro NOVO entre em atividade do mesmo dono.
- **Conflito com o tecnico:** vale a alteracao mais recente (`updated_at`); a atrasada vai para `sync_conflicts`, como sempre.
- Escritorio continua so leitura; administrador desativado perde tudo na hora (`my_role()` fica nulo).
- **Pessoas (migration 12):** `admin_list_people()` devolve o cadastro com e-mail (o e-mail vem de `auth.users`, que a API
  nao expoe) **so para administrador ativo**; para os demais, lista vazia. O gatilho `keep_one_admin` impede desativar ou
  rebaixar o **ultimo administrador ativo** (erro `23514`), ate pelo SQL Editor: antes, torne outra pessoa administradora.
  Aprovar ou mudar papel registra `reviewed_by` e `reviewed_at`.

### O que o app faz com isso (so administrador, so com internet)

- **Pessoas:** pendentes, com acesso e desativados; aprovar (escolhendo o papel), recusar, desativar, reativar e mudar papel.
  O administrador nao altera o proprio acesso pela tela.
- **Alteracoes e conflitos:** `admin_edits` (quem alterou o que de quem, antes -> depois, em portugues) e `sync_conflicts`
  (a edicao atrasada que o servidor recusou: "ficou ..." / "chegou ..."), das mais novas para as mais antigas, em paginas.
- **Trilha GPS de um tecnico** (administrador **e escritorio**; o RLS ja deixava ler): em *Atividade -> Ver trilha GPS*, tambem na ficha do painel (a trilha aparece no mapa do painel). Baixa os `track_points` da atividade em paginas de 500
  (ate 20 mil pontos), so quando pedido, guarda **so na memoria** (nada vai para o IndexedDB do administrador) e desenha no
  mapa em azul tracejado, com "Esconder trilha". A trilha continua um registro de deslocamento: nunca vira cabo.

### Excluir uma atividade

Excluir uma atividade e **logico** (`deleted = true`, nunca ha DELETE) e leva junto os elementos, cabos, fotos e a trilha dela,
tudo com a mesma hora, numa so transacao do aparelho. Pode o **dono** e o **administrador** (o escritorio nao); o dono do registro
nao muda e cada linha excluida pelo administrador entra em `admin_edits` (quem, quando, antes/depois). Limites conhecidos:

- O administrador nunca baixa a trilha GPS dos outros, entao a trilha de um tecnico excluida por ele **continua guardada** no
  servidor (`track_points`); so deixa de aparecer em qualquer tela. Excluida pelo proprio dono, a trilha sobe como excluida.
- Se um aparelho que ainda nao sabia da exclusao enviar um registro novo para essa atividade, ele chega ao servidor; o painel
  ignora tudo o que pertence a uma atividade excluida.

## Projetos designados (migration 13)

O administrador cria um **projeto** (titulo, tipo, nº da OS, instrucoes, endereco, ponto no mapa e prazo opcionais) e o designa a
um tecnico; o tecnico o ve ao abrir o app e, ao iniciar, a atividade nasce **ligada** a ele (`activities.project_id`). Regras:

- **Quem escreve:** so o administrador ativo (e pela internet). Quem le: administrador e escritorio, todos; o tecnico, **so os
  designados a ele** (inclusive os excluidos, para a exclusao chegar ao celular). Ninguem apaga linha: excluir e `deleted = true`.
- **Designar:** so a tecnico ou administrador **ativo** (`23514` para escritorio ou conta desativada). Reatribuir e alterar `assigned_to`.
- **O servidor manda no relogio** (`updated_at`, `server_updated_at`) e registra quem gravou (`updated_by`); o dono nao muda.
- **O tecnico nao altera o projeto.** O andamento vem das atividades ligadas: `activities.completes_project = true` diz que, com
  aquela atividade, o projeto terminou (so vale com `project_id`, regra `activities_completes_needs_project`).
- **Trabalho de campo nunca e recusado:** o servidor confere so que o projeto existe (chave estrangeira). Se o administrador
  cancelar, excluir ou reatribuir o projeto enquanto o tecnico trabalha sem internet, a atividade dele sobe normalmente.

### O desenho do projeto (migration 14)

O administrador desenha no mapa o **tracado** (linhas) e os **pontos projetados** (poste, CTO, CEO, reserva, outro) de um projeto; o
tecnico responsavel ve isso como guia. Fica na coluna `projects.plan` (jsonb, nula = sem desenho), no formato
`{"lines": [{"id", "points": [[lat, lng], ...]}], "points": [{"id", "type", "lat", "lng", "code"?}]}`.

- **Quem escreve e quem le** e o mesmo do projeto: so o administrador grava; o tecnico responsavel, o escritorio e o administrador leem.
- **O banco recusa desenho malformado** (erro `23514`, regra `projects_plan_valid`, funcao `plan_is_valid`): forma errada, tracado com
  menos de 2 pontos, coordenada fora do mundo ou nao numerica, tipo de ponto invalido (ocorrencia nao entra), codigo com mais de
  60 letras, mais de 200 tracados, 2000 pontos, 5000 pontos num tracado ou 20000 no total, e mais de 400 mil caracteres.
  O app confere os mesmos limites antes de enviar (`src/features/projects/plan.ts`, um pouco mais folgado no tamanho).
- **O tracado projetado nunca vira cabo sozinho**: e so um guia; o cabo continua sendo lancado poste a poste no campo.
- Editar o nome, o prazo etc. do projeto **nunca apaga o desenho** (o formulario comum nem manda a coluna).

### Fibras e ligacao de cabos (migration 15)

O cabo passa a guardar o **padrao de cores das fibras** e as **ligacoes** com outros cabos (guia em `docs/fibras.md`):

- `cables.color_standard` (texto, nulo = ABNT): so aceita `abnt` ou `tia598` (erro `23514`, regra `cables_color_standard_valid`).
- `cables.links` (jsonb, padrao `[]`): lista de `{"elementId", "cableId"}` (uuid dos dois), ate 200 por cabo (regra `cables_links_valid`, funcao
  `cable_links_valid`). Sao **so referencias**, sem chave estrangeira: cabo ou elemento que some deixa a ligacao sem efeito no app.
- Quem grava e quem le e o mesmo do cabo (RLS: o dono, ou o administrador). A fibra de entrada de uma CTO fica nos `attrs` dela
  (`feedCableId`, `feedFiber`): nao precisa de coluna.
- O app **so manda as colunas novas quando o cabo as usa**: um servidor sem esta migration continua recebendo os cabos de sempre
  (so o padrao de cores e as ligacoes nao sobem ate aplicar o arquivo).

## Painel web do escritorio (so leitura)

O painel (`#/painel`, para escritorio e administrador) trabalha com o que o navegador ja sincronizou, inclusive sem internet. Do
servidor ele usa so a funcao `cable_totals(p_from, p_to)` (migration 8): na secao **Totais**, o botao *Conferir com o servidor*
soma os cabos la e compara com a tabela daqui. O periodo e meio aberto, `[de, ate)`: o ultimo dia entra inteiro e o instante
seguinte nao. Se nao bater, falta sincronizar. O teste `tests/panel-totals.test.ts` garante que as duas somas sao a mesma conta.

## Testes do banco (para quem for mexer no SQL)

Precisam de um Postgres 16 com PostGIS. Com Docker:

```bash
docker run -d --name rf-pg -p 5433:5432 -e POSTGRES_PASSWORD=postgres postgis/postgis:16-3.4
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npm run test:db
```

Cada arquivo de teste cria um banco novo, aplica um *stub* do Supabase (`tests/support/supabase-stub.sql`, **só para
teste**, nunca aplicar no projeto real) e as migrations de verdade, e personifica cada usuário como o PostgREST faz.
Sem `TEST_DATABASE_URL` esses testes são pulados e `npm test` segue normal.

O teste `tests/project-plan.test.ts` cobre o desenho do projeto (formato, limites e quem grava).
O teste `tests/projects.test.ts` cobre os projetos designados (quem le, quem escreve, designacao, vinculo da atividade).
O teste `tests/admin-api.test.ts` roda as **ferramentas do administrador do app** (Pessoas, Alteracoes, trilha) do mesmo jeito.
O teste `tests/sync-engine.test.ts` roda o **motor de sincronização do app** contra esse banco, atrás de um PostgREST de
verdade e do cliente `supabase-js`/`postgrest-js`. Ele sobe o próprio PostgREST (um por execução, num banco novo) e só
roda se `POSTGREST_BIN` apontar para o binário ([download](https://github.com/PostgREST/postgrest/releases)):

```bash
POSTGREST_BIN=/caminho/para/postgrest TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npm run test:db
```

## Contrato com o app (a sincronização, passo 3)

Descobertas dos testes que o app respeita (`src/features/sync`):

- Enviar com `POST /<tabela>?on_conflict=id`, `Prefer: resolution=merge-duplicates,return=representation` e `select=id`:
  a resposta traz **só as linhas realmente gravadas**. Uma linha que **não** volta foi descartada pelo servidor (reenvio
  igual ou envio atrasado): o app busca a versão do servidor, e se ela for mais nova passa a mostrá-la (alteração
  "substituída"); se for igual, só marca como enviado. Reenviar nunca duplica.
- **403 num envio é permanente** para aquele registro (é de outro técnico, ou aponta para atividade alheia): o app não
  repete; o registro fica **"recusado"** (visível na tela *Sincronização*), com o restante da fila seguindo normalmente.
  Um lote recusado é dividido ao meio até achar o registro culpado. Depois de 5 recusados no mesmo ciclo, para.
- **Atenção:** quando a atividade-pai não existe no servidor, quem responde é a RLS (**403**), não a chave estrangeira
  (409): o app só chega a esse caso se a atividade foi recusada, e então já segura os registros dela (esperam).
- **Não enviar** `owner_id`, `geom` nem `server_updated_at` (o servidor define). Enviar `lat`/`lng` (elementos, fotos,
  trilha) e `vertices` (cabos).
- **Ordem de envio:** atividades → elementos e cabos → fotos → pontos da trilha (as chaves estrangeiras exigem).
- **Cursor do "puxar":** guardar `server_updated_at` **como texto** (o servidor tem microssegundos; um `Date` do
  JavaScript os perde e a última linha voltaria) e puxar com ~5 minutos de sobreposição.
- A trilha dos colegas **não** chega ao celular (RLS) e o app **nem pede** a trilha: ela só sobe.
- **Fotos:** o **arquivo** sobe primeiro para o bucket privado `fotos` no caminho `<dono>/<id>.jpg` (com `upsert`, então
  repetir é inofensivo; o app anota o caminho no aparelho para não reenviar o arquivo se só o registro falhar) e **depois**
  o registro em `photos` com `storage_path`. Nunca existe registro apontando para arquivo que não subiu. Lotes de 10 fotos.
  Foto excluída sobe só como registro `deleted = true` (o arquivo fica no bucket: não há política de apagar). Arquivo recusado
  (grande demais, formato) bloqueia só aquela foto. **Baixar:** o registro das fotos dos colegas chega com a sincronização,
  mas o **arquivo só é baixado quando o elemento é aberto** (com internet), para poupar dados e espaço no celular; o
  backup e o KMZ só levam as fotos que estão no aparelho. Foto cujo elemento ainda não está no servidor responde 409 (chave
  estrangeira): a foto **espera**, não é recusada.
- Puxar: `order=server_updated_at,id` com continuação por `or=(server_updated_at.gt.X,and(server_updated_at.eq.X,id.gt.Y))`
  (páginas de 500) e piso `server_updated_at >= cursor - 5 min`. O cursor de cada tabela só avança quando a tabela termina;
  uma queda no meio não refaz o que já foi baixado.
- **Regra de conflito no aparelho:** vale a versão com `updatedAt` mais recente. Registro de **outro técnico** nunca é
  enviado (só baixado) e só o dono altera. Escritório só baixa.

### Quando o app sincroniza

Em segundo plano, sem nunca atrapalhar o campo: ao abrir o app com conta ativa; quando a internet volta; quando o app volta
para a tela; a cada 2 minutos com o app aberto; e ~4 s depois de gravar algo (junta gravações seguidas, no máximo um ciclo
automático a cada 30 s: a trilha grava a cada poucos segundos). Falhas do servidor repetem com espera crescente
(15 s, 30 s, 1 min, 2 min, 5 min); **sem internet não insiste** (espera o aparelho voltar à rede).

**Editou o registro enquanto ele subia:** o ciclo só marca como enviado o que não mudou durante o envio, então a versão nova
continua pendente (a contagem de pendentes não aumenta, por isso nada disparava). Agora, se o ciclo enviou algo e ainda sobrou
pendente que não está só esperando outro registro, o app abre outro ciclo ~4 s depois, em vez de esperar o relógio de 2 minutos.
No máximo 5 acompanhamentos seguidos, e só enquanto cada ciclo realmente envia algo (registro recusado ou esperando dependência
não faz o app repetir à toa).

### Envio com o app fechado (Chrome/Edge, Android e computador)

O service worker (`src/sw.ts`) usa o **Background Sync**: se o app ficou com pendências sem internet (ou o envio falhou
por rede/servidor, ou o app foi para segundo plano com algo pendente), ele pede ao navegador para acordar o envio quando a
internet voltar, **mesmo com o app fechado**. O service worker roda um ciclo **só de envio** (arquivos e registros), com a
mesma trava (Web Locks) do app: nunca dois ciclos ao mesmo tempo.

- **Sessão:** o service worker não enxerga o `localStorage`, então o app copia para o IndexedDB (`authMirror`) só o token de
  **acesso**, o endereço do servidor e a chave **pública**. O token de **renovação** nunca sai do `supabase-js`: se o service
  worker renovasse a sessão, o app perderia o login (cada token de renovação só vale uma vez).
- **Token vencido:** o token de acesso vale o tempo configurado em *Authentication → JWT expiry* (padrão **1 hora**). Passado
  isso, o service worker **não envia**: mostra a notificação "N registros aguardando envio. Abra o app para enviar." e o app
  renova a sessão e envia quando for aberto. Se quiser que o envio com o app fechado funcione por mais tempo, aumente o
  *JWT expiry* (por exemplo, para 24 h = 86400 s): é uma troca entre conveniência e o tempo em que um token vazado vale.
- **Notificações:** exigem permissão (tela Sincronização → *Ativar avisos*). Sem permissão, o envio continua valendo, só não
  há aviso.
- **iPhone/Safari não têm Background Sync**: ali os dados ficam salvos e sobem na próxima vez que o app for aberto com
  internet (a tela Sincronização avisa isso).

## Login no app (passo 2 da Fase 2)

O app so liga a conta quando o build recebe as duas variaveis (`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, a
**Publishable key**). Sem elas, nada muda: o app abre direto, so no aparelho, e o cartao "Conta" nem aparece nas Configuracoes.

- **Tela de acesso (com as variaveis):** o app **so abre (mapa, barra, GPS) para quem tem o acesso aprovado**. O primeiro acesso do
  aparelho cai em *Pedir acesso* (nome, e-mail e senha de 8+ caracteres); quem ja teve conta ve *Entrar*. Rotas como `#/config`
  e `#/painel` tambem ficam atras dela. Fica **na frente de tudo**: nenhuma parte do app e montada por tras.
- **Estados:** *aguardando aprovacao* (pediu e o admin ainda nao aprovou), *acesso desativado* e *verificando* (logado, mas sem
  internet para confirmar) ficam numa tela so de aviso, com *Verificar agora* e *Sair*; ela confere sozinha a cada 20 s e abre o app
  quando o admin aprova. Depois de aprovado o nome do tecnico passa a ser o do cadastro e fica travado.
- **Sem internet:** depois de aprovado vale o ultimo estado conhecido, sem esperar o servidor: **reabrir sem internet abre direto**.
  Entrar, pedir acesso e trocar a senha precisam de internet (o app avisa). Sair da conta **nunca apaga dados do aparelho**, mas
  volta para a tela de acesso (para entrar de novo e preciso internet uma vez).
- **Limite de tentativas no aparelho:** 5 erros seguidos (senha errada, e-mail ja cadastrado...) travam *Entrar* e *Pedir acesso*
  por **5 min**; as proximas travas duram **15 min** e depois **30 min**. O botao mostra a contagem regressiva e recarregar a pagina
  **nao destrava**. Falta de rede, e-mail digitado errado, senha curta e e-mail nao confirmado **nao** contam. Se o servidor
  responder "muitas tentativas" (429), o aparelho espera 2 min. Mais de 24 h sem erro zera o historico. E so conforto: quem protege
  de verdade e o limite do Supabase (*Authentication -> Rate Limits*), que continua valendo.
- **Limite do que isto protege:** a tela e logica do navegador (quem sabe mexer nele consegue abri-la), mas **os dados da rede continuam
  protegidos no servidor** (login, aprovacao e RLS): sem conta ativa nao ha o que ler. Dados que ja estejam no proprio aparelho ficam
  nele.
- **Seguranca do build:** se alguem colar a **Secret key** (`sb_secret_...` ou `service_role`) numa variavel, o build **falha**
  com mensagem clara (nada e publicado) e o app recusa usa-la. Testes vigiam o codigo e o workflow contra segredos; o
  workflow le as chaves de **variaveis** do repositorio, nunca de segredos.

Descoberta importante (testada com o `supabase-js` de verdade): com o **token vencido e sem internet**, `getSession()` leva
cerca de **25 segundos** (8 tentativas) e devolve "sem sessao". O app nao espera por isso: usa o ultimo estado guardado,
limita a espera a 10 s e so trata como "saiu" o evento `SIGNED_OUT`.

### Para testar no celular

1. Cadastre as 2 variaveis no GitHub (*Settings -> Secrets and variables -> Actions -> Variables*) e publique.
2. Abra o app: a primeira tela e **Pedir acesso** (sem mapa). Peca acesso com um e-mail de teste: deve ficar *Aguardando aprovacao*.
3. No Supabase (*Table Editor -> profiles*), marque `active = true` para esse e-mail. No app, **Verificar agora**:
   o app abre sozinho, e o nome do tecnico passa a ser o do cadastro.
4. Ative o modo aviao e reabra o app: a conta continua ativa, na hora.
5. **Sair da conta** (Ajustes -> Conta): volta para a tela de acesso; os dados (atividades, elementos, fotos) continuam no aparelho.
6. Erre a senha 5 vezes: o botao trava com a contagem (5 min) e continua travado ao recarregar.
