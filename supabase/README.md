# Supabase — banco do RotaFibra (Fase 2)

Esta pasta guarda o banco do servidor. **O app ainda não fala com ele** (isso vem nos próximos passos);
aqui está só o esquema, as regras de acesso (RLS) e os testes que provam que elas funcionam.

```
supabase/
  migrations/   8 arquivos SQL pequenos, aplicar em ordem
  conferir-passo-1.sql   diz, item por item, se o banco ficou completo
  tests/        testes do banco (Postgres local) e o script de verificação direto na API
```

## O que o banco faz

- **Mesmas tabelas do app** (atividades, elementos, cabos, fotos, trilha), com geometria PostGIS calculada no servidor
  a partir de `lat`/`lng` e dos `vertices` do cabo.
- **Quem pode o quê:** técnico lê a rede toda e cria/edita **só o que é dele**; escritório lê tudo e não edita dados
  de campo; admin gerencia perfis. A trilha GPS de um técnico só é lida por ele, pelo escritório e pelo admin.
- **Ninguém apaga linha.** A exclusão é lógica (`deleted = true`), como no app.
- **Reenviar nunca duplica:** o envio é um *upsert* por `id` (UUID gerado no aparelho).
- **Conflito:** vence o `updated_at` mais recente; o envio atrasado e diferente vai para `sync_conflicts` (só o admin lê).
  Relógio adiantado é limitado a "agora + 5 min".
- **Fotos:** bucket privado `fotos`, caminho `<id-do-dono>/<id-da-foto>.jpg`, só JPEG, até 3 MB.

## Preparar o projeto (uma vez)

1. No [supabase.com](https://supabase.com), crie um projeto (plano gratuito). Guarde a senha do banco.
2. **Desligue o cadastro público:** *Authentication → Sign In / Providers* e desmarque *Allow new users to sign up*.
   (Os nomes dos menus mudam de vez em quando; o que importa é: ninguém de fora pode criar conta.)
3. **Aplique as migrations, em ordem** (cada uma **uma vez só**). `supabase db push` nao e um arquivo: e um comando do
   Supabase CLI, que so vale a pena se voce tiver o repositorio no seu computador. O caminho simples nao instala nada:
   - *SQL Editor:* no painel do Supabase, **SQL Editor -> New query**, cole o conteudo de **um arquivo de
     `supabase/migrations/` por vez, na ordem do nome**, e clique em **Run**. Sao 8 arquivos (`...150000_perfis`,
     `...150100_tabelas_atividades_elementos`, `...150110_tabelas_cabos_fotos`, `...150120_tabelas_trilha_indices`,
     `...150130_regras_de_conflito`, `...150140_permissoes_e_rls`, `...150200_fotos`, `...150300_painel`).
     Cada um termina com uma linha `-- fim: ...`: **confira no editor se ela esta la** antes de rodar. Os arquivos tem
     menos de 100 linhas de proposito: um colar a partir de um visualizador que corta em 100 linhas ja chegou truncado
     ao editor (erro de sintaxe no fim do texto), e as migrations sao so ASCII porque o editor ja reescreveu um script
     com acentos e o quebrou. Se o editor perguntar sobre "Row Level Security", o nosso SQL ja liga a RLS em todas as
     tabelas: qualquer botao serve (se der erro de sintaxe, use "Run without RLS").
   - **Confira o resultado:** rode `supabase/conferir-passo-1.sql`. Todas as 12 linhas devem dizer `OK`; `FALTA` indica
     qual parte nao foi aplicada ate o fim.
   - *CLI* (com o repositorio no computador, dentro da pasta do projeto): `npx supabase init`, `npx supabase login`,
     `npx supabase link --project-ref <ref>` e `npx supabase db push`. O `<ref>` e o trecho da URL do projeto
     (`https://<ref>.supabase.co`). Nao misture: se aplicou pelo SQL Editor, nao use `db push` depois para as mesmas migrations.
4. **Crie os usuários:** *Authentication → Users → Add user → Create new user*, com e-mail e senha
   (marque *Auto Confirm User*). O perfil nasce sozinho como `tecnico`; ajuste o nome em *Table Editor → profiles → full_name*.
5. **Defina os papéis.** O primeiro admin você faz no *SQL Editor*:
   ```sql
   update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'voce@empresa.com');
   ```
   Os demais (`escritorio`, `admin`) podem ser alterados em *Table Editor → profiles → role*.
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

## Testes do banco (para quem for mexer no SQL)

Precisam de um Postgres 16 com PostGIS. Com Docker:

```bash
docker run -d --name rf-pg -p 5433:5432 -e POSTGRES_PASSWORD=postgres postgis/postgis:16-3.4
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npm run test:db
```

Cada arquivo de teste cria um banco novo, aplica um *stub* do Supabase (`tests/support/supabase-stub.sql`, **só para
teste**, nunca aplicar no projeto real) e as migrations de verdade, e personifica cada usuário como o PostgREST faz.
Sem `TEST_DATABASE_URL` esses testes são pulados e `npm test` segue normal.

## Contrato com o app (para o passo de sincronização)

Descobertas dos testes que o app precisa respeitar:

- Enviar com `POST /<tabela>?on_conflict=id` e `Prefer: resolution=merge-duplicates`. **Qualquer 2xx é sucesso**:
  o servidor responde 200 quando descarta um reenvio igual ou atrasado.
- **403 num envio é permanente** para aquele registro (é de outro técnico, ou aponta para atividade alheia): não repetir;
  registrar no log local.
- **Não enviar** `owner_id`, `geom` nem `server_updated_at` (o servidor define). Enviar `lat`/`lng` (elementos, fotos,
  trilha) e `vertices` (cabos).
- **Ordem de envio:** atividades → elementos e cabos → fotos → pontos da trilha (as chaves estrangeiras exigem).
- **Cursor do "puxar":** guardar `server_updated_at` **como texto** (o servidor tem microssegundos; um `Date` do
  JavaScript os perde e a última linha voltaria) e puxar com ~5 minutos de sobreposição.
- A trilha dos colegas **não** chega ao celular (RLS); fotos chegam só como registro, sem o arquivo.
