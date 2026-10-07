# Projetos designados

O **administrador** cria um projeto (um serviço a fazer) e o entrega a um **técnico**. Quando o técnico abre o app, vê que tem
projeto para ele; ao iniciar, a atividade nasce já preenchida e **ligada ao projeto**. O escritório acompanha tudo pelo painel.

> No app, "atividade" é o que o técnico faz em campo (elementos, cabos, fotos, trilha). "Projeto" é o serviço que o
> administrador designa; um projeto pode ter várias atividades (uma obra de vários dias, por exemplo).

## Quem faz o quê

| Papel | O que faz com projetos |
|---|---|
| Administrador | cria, edita, passa para outro técnico, marca concluído, cancela, reabre, exclui e restaura (precisa de internet) |
| Técnico | recebe os **dele**, vê as instruções e o local, inicia e conclui atividades; não altera o projeto |
| Escritório | só consulta: tabela **Projetos** no painel, com o que já foi feito em cada um; não altera nada |

## Administrador (Configurações → Administração → Projetos)

- **Novo projeto:** nome, tipo (implantação ou manutenção), técnico responsável, nº da OS, instruções, endereço, ponto no mapa e
  prazo (os três últimos são opcionais). O ponto no mapa se cola do Google Maps em qualquer formato (`-23.5505, -46.6333`,
  `-23,5505; -46,6333` ou o link do local); o app mostra "Entendi: …" e um link para conferir.
- **Lista:** mostra a situação de cada um, "Atrasado" quando o prazo passou, e filtra por situação, técnico e busca
  (nome, OS, endereço, técnico). Os atrasados aparecem primeiro.
- **Abrir um projeto:** edita os campos, **passa para outro técnico** (o app avisa que as atividades já feitas continuam com o
  anterior), **marca como concluído**, **cancela**, **reabre**, **exclui** (lógico) e **restaura**. Lista as atividades ligadas.
- Tudo isso exige internet e um administrador ativo. O servidor confere de novo (RLS).

## Técnico (no celular)

- **Aviso ao abrir o app:** no mapa, "Você tem N projetos para fazer". Com um só, "Ver" abre direto o projeto. "Depois" esconde até
  abrir o app de novo (ou chegar um projeto novo). Funciona sem internet: os projetos ficam no aparelho depois de sincronizar.
- **Meus projetos** (também em Atividades): os atrasados primeiro; os concluídos e cancelados ficam em "Encerrados". Há também
  "Fazer atividade avulsa" para trabalho sem projeto.
- **Detalhe:** situação, tipo, OS, prazo, endereço, instruções, atividades já feitas. Com ponto: pino amarelo no mapa, "Ver no mapa"
  e "Como chegar" (abre a rota no aplicativo de mapas do celular).
- **Iniciar este projeto:** cria a atividade aberta com o nome, o tipo e a OS do projeto, ligada a ele. Só uma atividade aberta por
  vez: com uma aberta, o app avisa e não deixa iniciar outra. Concluída a atividade, dá para "Iniciar outra atividade neste projeto".
- **Concluir a atividade de um projeto** pergunta **"Este projeto está concluído?"**:
  **Sim** (a atividade conclui e termina o projeto), **Não, ainda falta fazer** (conclui só a atividade) ou **Voltar** (não conclui).
  Errou? Em *Atividades → Abrir*, a atividade concluída tem "Com esta atividade o projeto terminou? Sim / Não".
- Projeto passado a outro técnico some da lista de quem perdeu (na próxima sincronização) e aparece na de quem recebeu. Projeto
  cancelado vai para "Encerrados". O que o técnico já fez continua, e **o trabalho de campo nunca é recusado**: se o administrador
  cancelar, excluir ou reatribuir o projeto enquanto o técnico trabalha sem internet, o que ele fez sobe normalmente.

## Escritório (painel → Projetos)

- Tabela com projeto, técnico, tipo, situação, prazo, **atividades** e **metros de cabo** feitos nele; filtros (situação, técnico,
  "só os atrasados"), busca (inclui as instruções e o nome das atividades), ordenação por coluna e **CSV** para o Excel.
- **Ficha:** técnico, instruções, o que já foi feito (atividades, elementos, cabos, metros), **"Ver o ponto no mapa"** (abre o mapa do
  painel com o pino do projeto) e a lista de atividades, cada uma abrindo na tabela de Atividades.
- A **Visão geral** conta os projetos por situação e os atrasados.
- O nome do técnico vem do cadastro (guardado quando há internet) ou do nome que ele usa nas atividades.

## Como a situação é calculada

A situação **não é gravada pelo técnico**: sai do que o administrador marcou e das atividades ligadas ao projeto.

1. **Cancelado** ou **Concluído** marcado pelo administrador vale sempre.
2. Senão, **Concluído** se alguma atividade ligada (não excluída e **concluída**) disser que terminou o projeto.
3. Senão, **Em andamento** se há alguma atividade ligada (não excluída).
4. Senão, **Pendente**.

**Atrasado** = tem prazo, o prazo já passou (o próprio dia do prazo ainda não conta) e o projeto não está concluído nem cancelado.
Reabrir um projeto concluído por atividade = responder "Não" na atividade que o terminou (o administrador também pode).

## Limites conhecidos

- Criar e alterar projeto exige internet (é feito pelo administrador); o técnico só consome, inclusive sem internet.
- O aviso aparece ao abrir o app; **não há notificação com o app fechado** (seria uma etapa à parte).
- O servidor não recusa a atividade de quem trabalhou sem internet por causa de mudança no projeto; por isso o vínculo é
  informativo (a atividade guarda de qual projeto veio, mesmo que ele tenha mudado de mãos).
- Um projeto tem um técnico responsável por vez (não há equipe). Reatribuir é possível a qualquer momento.
- Se o servidor ainda não tem a migration 13, o app **continua sincronizando o resto**; só os projetos não chegam.

## Onde está o código

`src/features/projects/` (lógica pura e testada: `projectState`, `projectForm`, `projectRows`, `myProjects`, `peopleNames`,
`finishQuestion`; telas do administrador `ProjetosScreen`/`ProjetoScreen`; do técnico `MeusProjetosScreen`/`MeuProjetoScreen`,
`ProjectNotice`, `ProjectPinsLayer`, `FinishProjectDialog`), `src/features/panel/` (`projectTable`, `ProjectsTableSection`,
`ProjectInfo`), a sincronização em `src/features/sync/engine.ts` (projetos só descem) e o banco em
`supabase/migrations/20261006150600_projetos.sql` (explicação em `supabase/README.md`).
