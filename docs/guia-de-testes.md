# Guia de testes: o que conferir no celular e no computador

Marque o que passou. Se algo se comportar diferente, anote **em qual passo parou e o texto que apareceu na tela** (não cole
chaves nem senhas). O deploy é conferido pelo número da versão em *Configurações*.

## 0. Antes de tudo (uma vez)

- [ ] No Supabase, as **15 migrations** foram aplicadas em ordem e `supabase/conferir-passo-1.sql` (16 linhas),
      `supabase/conferir-admin.sql` (10 linhas), `supabase/conferir-projetos.sql` (6 linhas) e `supabase/conferir-desenho.sql`
      (3 linhas, migration 14 do desenho) e `supabase/conferir-fibras.sql` (3 linhas, migration 15 das fibras) dizem `OK`.
      (`supabase/README.md`)
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

**Fibras, ligação de cabos e rota (guia em `docs/fibras.md`)**
- [ ] *Configurações → Cores das fibras*: ABNT vem marcado; trocar para Internacional e reabrir o app mantém. Ao **lançar um cabo** vem
      marcado o padrão das Configurações e dá para trocar só naquele cabo.
- [ ] Ficha do cabo: **"Fibras (24) · cores ABNT · 2 tubos"**, tubos que abrem/fecham, cada fibra com bolinha e nome da cor (fibra 1 =
      Verde; fibra 13 = Verde do tubo 2 Amarelo). *Editar* troca o padrão (Internacional: fibra 1 = Azul).
- [ ] **Ligar cabos:** na ficha de um CEO (ou poste/CTO) onde passam 2+ cabos, "Cabos que passam aqui": marque os que continuam um no outro e
      *Salvar ligações* ("Rota: N cabos ligados"). Marcar só 1 avisa; desmarcar desliga. Na ficha de um dos cabos aparece "Ligado a" e
      "Rota toda".
- [ ] **Fibra da CTO:** na CTO, *Editar* → "Fibra de entrada": escolher o cabo e a fibra (em cabo de 48 fibras, o tubo colorido primeiro).
      A ficha mostra "Fibra 19 · Marrom · Tubo 2 Amarelo". Escolher uma fibra que outra CTO já usa avisa. Na ficha do cabo a fibra aparece
      marcada com a CTO.
- [ ] **Rota acesa (celular, ao ar livre):** tocar em qualquer parte de um cabo acende a rota toda (halo amarelo, o resto esmaece) e abre
      a folha "Rota: N cabos · metros · N CTOs" com a fibra de cada CTO. Dá para abrir um cabo ou uma CTO da lista. *Fechar* ou tocar no
      vazio apaga. Legível no sol? Os botões e linhas têm tamanho bom para o dedo?
- [ ] Sem internet tudo isso funciona (é do aparelho). Depois de sincronizar, **outro celular** e o **painel** veem as ligações, as
      cores e as fibras das CTOs.
- [ ] **Painel (escritório):** clicar num cabo no mapa (ou achar na busca) acende a rota; a ficha mostra "Rota" e as CTOs com a fibra; "Mostrar
      no mapa" enquadra a rota inteira; a ficha de uma CTO mostra "Fibra de entrada". *Exportar* (KML) traz o padrão de cores e a fibra da CTO.

**Lançar a rede toda de uma vez: tronco e ramais (guia em `docs/fibras.md`)**
- [ ] *Lançar cabo* (AS-120, 48 fibras) e andar: **"Marcar poste aqui e ligar"** num poste, depois toque em **CEO** (o botão vira "Marcar CEO aqui e
      ligar") e marque a CEO: o ícone laranja nasce no lugar e o tipo **volta para Poste** sozinho. O mesmo vale para **CTO** (ícone verde).
- [ ] Na CEO, **Derivar**: a tela diz "Saindo de CEO", abre com o tipo e as fibras do cabo de origem (na 2ª vez, com o **último ramal usado**) e
      os botões estão sempre à vista, sem rolar. Confirmar: o painel mostra **Ramal** e o tipo/fibras do ramal.
- [ ] Marque 1–2 postes e uma **CTO** no ramal, toque em **Terminar ramal**: o painel volta a **Tronco**. Marque o próximo poste do tronco: a
      linha do tronco segue **da CEO**, sem pular. (*Terminar ramal* fica apagado enquanto o ramal não tem nenhum ponto.)
- [ ] **Desfazer** em sequência: tira o último ponto (e o poste/CEO/CTO que ele criou do mapa), depois o "terminar ramal" (volta para dentro do
      ramal) e por fim a própria derivação. Poste que já existia no mapa **não** some.
- [ ] Derivar de um ponto **solto** (toque no mapa fora de qualquer ícone) avisa "Derive de um poste, CEO ou CTO" e não abre nada.
- [ ] Fechar o app (ou recarregar a página) **no meio de um ramal**: ao abrir, o lançamento volta de onde parou, ainda dentro do ramal.
- [ ] Repita o desenho do mapa: tronco com **2 CEOs**, de cada uma um ramal até uma **CTO**. O mapa mostra tronco e ramais, cada um na
      espessura/cor da sua quantidade de fibras. O painel cabe na tela e os botões do mapa ficam acima dele (no tronco e no ramal).
- [ ] **Finalizar**: o resumo lista "Tronco · … / Ramal 1 · … sai de CEO / Ramal 2 · …" com os metros e a soma; abaixo, uma caixa por **CTO**
      (código opcional e **Escolher fibra**: tubo e cor no padrão do cabo; "fim do …" ou "no meio do …"). Escolha a fibra de uma CTO e deixe a
      outra em branco. **Salvar tudo**: aviso "3 cabos salvos".
- [ ] Depois de salvar, toque num dos cabos: a **rota acesa** mostra os 3 cabos e as 2 CTOs, a de fibra escolhida com "Fibra 3 · Branco…" e a
      outra com "fibra de entrada não informada". Na ficha da CTO, *Editar* mostra a fibra e o código.
- [ ] Lançar **um cabo só**, sem derivar, continua igual a antes ("Finalizar cabo" → "Salvar cabo").
- [ ] Sem internet tudo isso funciona; depois de sincronizar, **outro celular** e o **painel** veem os 3 cabos já ligados e as fibras das CTOs.

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
- [ ] **Desenhar o projeto (celular e computador):** no projeto, o cartão "Desenho no mapa" mostra "Sem desenho". *Desenhar no mapa* →
      **Traçado**: toque 4 pontos e *Terminar traçado* (o resumo mostra os metros). **Selecionar**: arraste uma bolinha, crie um ponto
      tocando na bolinha pequena entre duas, apague um ponto e o traçado. **Ponto**: coloque uma CTO e escreva "CTO-03"; troque o
      tipo depois. **Desfazer/Refazer**. Os botões têm tamanho bom para o dedo e o mapa tem tamanho útil no celular. **Salvar
      desenho**, voltar e abrir de novo: volta igual. Sair com mudanças pede confirmação; **Apagar tudo** pede confirmação e dá para
      Desfazer. Sem internet a tela avisa e bloqueia o salvar. Um técnico abrindo `#/projeto/<id>/desenho` vê "só para administradores".
- [ ] **Importar KML/KMZ no desenho:** escolha um arquivo seu com linhas e pontos: "Importado: N traçados e M pontos…" e o mapa enquadra.
      Os pontos entram como "Outro" com o nome do arquivo como código. Áreas (polígonos) **não** entram e o aviso diz quantas. Com desenho
      na tela, pergunta *Acrescentar* ou *Substituir* (Desfazer volta tudo de uma vez). Arquivo que não é KML dá aviso e não muda nada.
- [ ] **Pessoas:** aprovar um pedido escolhendo o papel; recusar; desativar e reativar; mudar o papel (rebaixar administrador usa botão
      de perigo). O próprio cartão não tem ações. Sem internet aparece "Sem conexão".
- [ ] Editar um poste de um técnico (faixa "Você está alterando como administrador"); o técnico recebe e continua sendo o dono.
- [ ] **Alterações e conflitos:** a edição aparece como "Fulano alterou · Poste X · Identificação: A → B".
- [ ] **Projetado no mapa do técnico (celular):** depois de sincronizar, no projeto aparece o cartão "Desenho do projeto" com o resumo e
      *Ver desenho no mapa*. No mapa: traçado **tracejado** e pontos com anel tracejado (não confundem com cabo e elemento de verdade), botão
      **Projetado** liga e desliga (e lembra depois de fechar o app). Tocar num ponto mostra "Poste projetado / código / projeto" e
      *Abrir o projeto*; tocar no traçado mostra os metros. Tocar no vazio fecha. **Sem internet** (modo avião) o desenho continua lá.
      Ao marcar um elemento ou lançar cabo, o desenho fica só de fundo e o botão some; ao terminar, volta. Nada vira poste ou cabo
      sozinho. Se o administrador mudar ou apagar o desenho, o aparelho acompanha **depois de sincronizar**. Projeto concluído ou
      cancelado sai do mapa (o cartão com o resumo continua, sem o botão de ver no mapa).
- [ ] **Ver trilha GPS** de uma atividade de técnico; conferir pontos, metros e "Esconder trilha".
- [ ] **Excluir atividade** de um técnico: a confirmação diz o que sai; depois some da tabela, do mapa e dos totais, e o técnico
      recebe na sincronização.

## 3. Escritório, no computador (painel)

- [ ] **Projetos:** a seção fica entre Atividades e Totais. Por padrão mostra o que falta fazer; "Situação" troca. Conferir técnico,
      tipo, prazo, atividades e **metros de cabo** de um projeto que o técnico já trabalhou (batem com a atividade dele). Busca
      (inclui instruções), "Só os atrasados", ordenar pelas colunas (terceiro clique volta à ordem padrão), **Exportar CSV** (abre
      no Excel com acentos e vírgula decimal). A ficha tem "Ver o ponto no mapa" (pino no mapa do painel; "Tirar a marca" remove)
      e abre cada atividade na tabela de Atividades. O escritório **não** tem "Editar projeto". A Visão geral conta os projetos.
- [ ] **Desenho do projeto no painel:** a ficha de um projeto com desenho mostra o resumo e **Ver o desenho no mapa**: o mapa do painel
      enquadra o desenho (tracejado) com a faixa "Desenho do projeto: …"; clicar num ponto mostra tipo e código (sem botão de abrir o
      projeto); **Tirar o desenho** limpa. Dá para ver junto com a marca do ponto do projeto. Projeto sem desenho não mostra o cartão.

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
