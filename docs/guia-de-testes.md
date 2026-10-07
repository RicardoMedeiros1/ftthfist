# Guia de testes: o que conferir no celular e no computador

Marque o que passou. Se algo se comportar diferente, anote **em qual passo parou e o texto que apareceu na tela** (não cole
chaves nem senhas). O deploy é conferido pelo número da versão em *Configurações*.

## 0. Antes de tudo (uma vez)

- [ ] No Supabase, as **13 migrations** foram aplicadas em ordem e `supabase/conferir-passo-1.sql` (16 linhas),
      `supabase/conferir-admin.sql` (10 linhas) e `supabase/conferir-projetos.sql` (6 linhas) dizem `OK`. (`supabase/README.md`)
- [ ] Existe pelo menos **um administrador ativo** (README, passo 5). Recomendado: aumentar a validade do token (JWT expiry).
- [ ] No GitHub, as **Variables** `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` estão preenchidas (chave **publicável**) e o deploy
      do Pages passou.

## 1. Técnico, no celular (campo)

**Instalar e abrir**
- [ ] Abrir o endereço do app com internet, aceitar "Pronto para usar sem internet" e instalar na tela inicial.
- [ ] Pedir acesso (nome, e-mail, senha); o administrador aprova; "Verificar agora" mostra "Acesso aprovado".

**Sem internet (modo avião) — tudo deve funcionar**
- [ ] Iniciar atividade (implantação) com título e OS.
- [ ] Marcar poste: GPS bom (≤ 15 m) salva direto; GPS ruim (> 15 m) avisa e oferece ajustar arrastando sobre o satélite.
- [ ] Marcar CTO, CEO, reserva e ocorrência; abrir um elemento e **editar**, **mover** e **excluir** (pede confirmação).
- [ ] Lançar cabo poste a poste ("Marcar poste aqui e ligar"), ver os metros crescerem, **Reserva**, **Finalizar** e **Salvar cabo**.
- [ ] Tirar **foto** de um poste (câmera traseira) e ver a miniatura.
- [ ] **Trilha GPS:** iniciar, andar, pausar/retomar, encerrar. Conferir que **não** vira cabo.
- [ ] Concluir a atividade; reabrir; editar título/OS/descrição/materiais.
- [ ] Os botões ficam fáceis de tocar com uma mão, ao sol.

**Projetos que o administrador designou** (precisa de internet uma vez para receber; depois funciona sem)
- [ ] Ao abrir o app, no mapa, aparece **"Você tem N projetos para fazer"** (com 1 projeto, o nome dele). "Depois" esconde o aviso até
      abrir o app de novo; "Ver" abre a lista (ou o próprio projeto, se for um só). Com o app aberto **sem internet** o aviso também aparece.
- [ ] **Meus projetos** (também em Atividades): o atrasado vem primeiro; tocar abre as instruções, o prazo, o endereço e as atividades
      já feitas. O projeto que tem ponto mostra um **pino amarelo** no mapa; "Ver no mapa" centraliza nele e "Como chegar" abre a rota
      no aplicativo de mapas do celular.
- [ ] **Iniciar este projeto**: a atividade nasce com o nome, o tipo e a OS do projeto, aberta, e o projeto passa a "Em andamento".
      Com uma atividade já aberta o app avisa e não deixa iniciar outra. Concluída a atividade, dá para "Iniciar outra atividade neste
      projeto". Na atividade aparece "Projeto: …" com "Abrir projeto".
- [ ] O administrador **passa o projeto a outro técnico** ou **cancela**: na próxima sincronização ele some da lista de quem perdeu e
      aparece na de quem recebeu (cancelado vai para "Encerrados", sem botão de iniciar). O que já foi feito continua.
- [ ] **Concluir a atividade do projeto:** o app pergunta "Este projeto está concluído?". **Voltar** não conclui; **Não, ainda falta
      fazer** conclui só a atividade (o projeto segue "Em andamento"); **Sim** conclui e o projeto passa a "Concluído" (some do aviso e
      da lista de "Para fazer"). Errou? Em Atividades → Abrir, a atividade concluída tem "Com esta atividade o projeto terminou? Sim / Não".
- [ ] Iniciar um projeto **sem internet** e, nesse meio tempo, o administrador cancelar o projeto: o trabalho sobe normalmente.

**Voltar a internet**
- [ ] O indicador vai de "Offline" a "Online" e tudo sobe sozinho (sem pendências) em poucos segundos.
- [ ] Marcar um poste **com o envio em andamento**: ele sobe logo depois, sem ficar "pendente".
- [ ] (Android/Chrome) Deixar pendências, fechar o app e voltar a internet: o envio acontece sozinho. No iPhone isso não existe;
      o envio acontece ao abrir o app.

**Segurança dos dados**
- [ ] Backup: gerar e salvar o arquivo; restaurar em outro aparelho.
- [ ] Exportar KMZ/GeoJSON da atividade e abrir no Google Earth/QGIS. "Só os meus" e "rede inteira" funcionam.
- [ ] Sair da conta **não** apaga nada do aparelho.

**Dos colegas**
- [ ] Ver atividades e elementos dos outros técnicos (marcados como de outra pessoa); **não** conseguir editá-los.
- [ ] Receber uma correção feita pelo administrador: aparece "Alterado pelo administrador em …".

## 2. Administrador (celular ou computador)

- [ ] Configurações → **Administração**: Projetos, Pessoas, Alterações e conflitos, Atividades dos técnicos.
- [ ] **Projetos (etapa 2):** *Novo projeto* com nome, tipo, técnico, OS, instruções, endereço, ponto no mapa (cole coordenadas do Google
      Maps, em qualquer formato, e confira o "Entendi: …") e prazo. Sem nome ou sem técnico mostra o erro e não cria. O projeto aparece
      na lista como Pendente (e Atrasado se o prazo passou). Abrir, editar, **passar para outro técnico**, marcar concluído, cancelar,
      reabrir e excluir (cada um pede confirmação). Filtros "Para fazer / Pendentes / …", busca e filtro por técnico. Sem internet a
      tela avisa e bloqueia "Novo projeto". (O técnico só passa a ver os projetos na etapa 3.)
- [ ] **Projetos (concluir):** abrir um projeto concluído por uma atividade: aparece "Concluído porque uma atividade do técnico terminou o
      projeto" e como reabrir (abrir a atividade e responder "Não" em "Com esta atividade o projeto terminou?"). Fazer isso e ver o
      projeto voltar para "Em andamento" (depois de sincronizar). "Marcar como concluído" à mão continua valendo sobre as atividades.
- [ ] **Pessoas:** aprovar um pedido escolhendo o papel; recusar; desativar e reativar; mudar o papel (rebaixar administrador usa botão
      de perigo). O próprio cartão não tem ações. Sem internet aparece "Sem conexão".
- [ ] Editar um poste de um técnico (faixa "Você está alterando como administrador"); o técnico recebe e continua sendo o dono.
- [ ] **Alterações e conflitos:** a edição aparece como "Fulano alterou · Poste X · Identificação: A → B".
- [ ] **Ver trilha GPS** de uma atividade de técnico; conferir pontos, metros e "Esconder trilha".
- [ ] **Excluir atividade** de um técnico: a confirmação diz o que sai; depois some da tabela, do mapa e dos totais, e o técnico
      recebe na sincronização.

## 3. Escritório, no computador (painel)

- [ ] **Projetos:** a seção fica entre Atividades e Totais. Por padrão mostra o que falta fazer; "Situação" troca. Conferir técnico,
      tipo, prazo, atividades e **metros de cabo** de um projeto que o técnico já trabalhou (batem com a atividade dele). Busca
      (inclui instruções), "Só os atrasados", ordenar pelas colunas (terceiro clique volta à ordem padrão), **Exportar CSV** (abre
      no Excel com acentos e vírgula decimal). A ficha tem "Ver o ponto no mapa" (pino no mapa do painel; "Tirar a marca" remove)
      e abre cada atividade na tabela de Atividades. O escritório **não** tem "Editar projeto". A Visão geral conta os projetos.

- [ ] Configurações → **Painel** → "Abrir o painel"; o técnico **não** vê esse cartão; abrir `#/painel` como técnico mostra o aviso.
- [ ] **Visão geral** bate com o que os técnicos registraram; "Sincronizar agora" atualiza.
- [ ] **Mapa da rede:** filtrar por técnico/período/tipo; buscar um código de poste; tocar num símbolo e num cabo; ver a ficha com
      foto; "Abrir ficha completa" e voltar (filtros e ficha continuam); alternar Ruas/Satélite.
- [ ] Numa área com **muitos pontos** (afaste o zoom): aparecem bolinhas e o aviso; aproximando, voltam os símbolos.
- [ ] **Atividades:** ordenar por Metros de cabo e por Início; filtrar; buscar por um código que está *dentro* da atividade;
      "Mostrar mais"; ficha com materiais e totais; "Ver no mapa".
- [ ] **Ver trilha GPS** de um técnico (aparece no mapa do painel) e "Esconder trilha".
- [ ] **Totais:** período e técnico; **Exportar CSV** e abrir no Excel (acentos e vírgula decimal certos); **Conferir agora** dá
      "Confere" quando tudo está sincronizado e aponta a diferença quando falta sincronizar.
- [ ] O escritório **não** tem Editar, Excluir nem Concluir em lugar nenhum.
- [ ] Sem internet, o painel continua mostrando e filtrando o que já foi sincronizado.
- [ ] No celular o painel é usável (tabelas viram cartões, sem rolagem lateral).

## 4. Atualizações do app

- [ ] Depois de um deploy novo, aparece "Nova versão disponível — Atualizar"; tocar atualiza sem perder nada digitado.
- [ ] A versão em *Configurações* muda.

## Como foi testado aqui (e o que **não** foi)

Testes automáticos (`npm test`; com `TEST_DATABASE_URL` e `POSTGREST_BIN` também os de banco, ver `supabase/README.md`),
mutação nos módulos novos e e2e em navegador real contra um Postgres + PostgREST de verdade (só a autenticação e o
armazenamento de fotos são simulados). **Não** foi possível testar: o Supabase real, GPS e câmera reais, iPhone, e o Background
Sync real do Chrome Android. Esses são os itens acima que só você consegue confirmar.
