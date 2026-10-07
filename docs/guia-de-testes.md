# Guia de testes: o que conferir no celular e no computador

Marque o que passou. Se algo se comportar diferente, anote **em qual passo parou e o texto que apareceu na tela** (não cole
chaves nem senhas). O deploy é conferido pelo número da versão em *Configurações*.

## 0. Antes de tudo (uma vez)

- [ ] No Supabase, as **12 migrations** foram aplicadas em ordem e `supabase/conferir-passo-1.sql` (16 linhas) e
      `supabase/conferir-admin.sql` (10 linhas) dizem `OK`. (`supabase/README.md`)
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

- [ ] Configurações → **Administração**: Pessoas, Alterações e conflitos, Projetos dos técnicos.
- [ ] **Pessoas:** aprovar um pedido escolhendo o papel; recusar; desativar e reativar; mudar o papel (rebaixar administrador usa botão
      de perigo). O próprio cartão não tem ações. Sem internet aparece "Sem conexão".
- [ ] Editar um poste de um técnico (faixa "Você está alterando como administrador"); o técnico recebe e continua sendo o dono.
- [ ] **Alterações e conflitos:** a edição aparece como "Fulano alterou · Poste X · Identificação: A → B".
- [ ] **Ver trilha GPS** de uma atividade de técnico; conferir pontos, metros e "Esconder trilha".
- [ ] **Excluir atividade** de um técnico: a confirmação diz o que sai; depois some da tabela, do mapa e dos totais, e o técnico
      recebe na sincronização.

## 3. Escritório, no computador (painel)

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
