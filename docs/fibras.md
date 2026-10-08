# Fibras, ligação de cabos e rota

O app guarda **qual fibra é qual (cor e tubo)**, **quais cabos continuam um no outro** e **qual fibra cada CTO pegou**. Tudo ligado:
tocar num cabo acende a rota inteira, com as CTOs e a fibra de cada uma.

## Cores das fibras (ABNT e internacional)

Cada cabo guarda o **seu** padrão de cores. O padrão inicial é a **ABNT**; o **internacional (TIA-598)** já está pronto para o dia em
que chegar um cabo com essas cores. Escolha: ao lançar o cabo (vem marcado o padrão das Configurações), e troca na ficha do cabo
(Editar). Em *Configurações → Cores das fibras* está o padrão dos cabos **novos** (não muda os que já existem). Cabo antigo, sem
padrão gravado, vale ABNT.

| Posição | ABNT | Internacional (TIA-598) |
|---|---|---|
| 1 | Verde | Azul |
| 2 | Amarelo | Laranja |
| 3 | Branco | Verde |
| 4 | Azul | Marrom |
| 5 | Vermelho | Cinza |
| 6 | Violeta | Branco |
| 7 | Marrom | Vermelho |
| 8 | Rosa | Preto |
| 9 | Preto | Amarelo |
| 10 | Cinza | Violeta |
| 11 | Laranja | Rosa |
| 12 | Água | Água |

- **Tubos:** cabo de até 12 fibras não tem tubo. Acima disso, cada tubo leva **12 fibras** (24 = 2 tubos, 48 = 4, 144 = 12) e a cor
  do tubo segue a mesma sequência (tubo 1 = 1ª cor). Exemplo ABNT: fibra 19 = **Marrom do tubo 2 (Amarelo)**.
- Se um cabo vier com outra quantidade de fibras por tubo, é uma constante (`FIBERS_PER_TUBE`, em `src/features/cables/fibers.ts`).
- A cor **nunca aparece sozinha**: sempre com o nome ao lado (legível no sol).
- A ficha do cabo mostra as fibras com bolinha e nome, em tubos que abrem e fecham; as que já alimentam uma CTO aparecem marcadas.

## Ligar cabos (a emenda)

Na ficha de um **elemento** (CEO, poste ou CTO) onde passam **2 ou mais cabos** aparece **"Cabos que passam aqui"**: o técnico marca os
que **continuam um no outro** naquele ponto e toca em **Salvar ligações**. Cabos que só se cruzam no poste ficam sem marcar.

- Marcar 3 cabos liga todos com todos. Marcar só 1 avisa; desmarcar tira as ligações daquele cabo no ponto.
- A ligação fica guardada no **cabo de quem a fez** (o meu, se houver). Desfazer uma ligação guardada no cabo de outra pessoa só o dono
  dele (ou o administrador) consegue; o app explica.
- A ligação **só vale enquanto os dois cabos existem e passam pelo elemento**: se um cabo é excluído ou deixa de passar por ali, a
  rota o ignora (e volta se isso for desfeito). Nada é apagado sozinho.
- Na ficha do cabo: **"Ligado a"** (cabo, elemento e metros), **"Rota toda: N cabos ligados · X m"** e o botão **"Ver a rota no mapa"**.

## Fibra de cada CTO

Na CTO (ao criar ou em **Editar**), **"Fibra de entrada"**: o técnico escolhe o **cabo** que a alimenta e a **fibra** (em cabo com tubos,
primeiro o tubo colorido, depois as 12 fibras, cada uma com bolinha, número e nome da cor).

- Os cabos oferecidos são os que **passam pela CTO** e, depois, os que têm um ponto a **até 30 m** dela.
- Fibra que **já alimenta outra CTO** aparece marcada com o nome da CTO e a tela avisa ao escolhê-la (não proíbe).
- Trocar o cabo limpa a fibra. Cabo sem fibra não é guardado (os dois valem juntos). Desmarcar o cabo apaga os dois.
- A ficha da CTO mostra "Fibra 19 · Marrom · Tubo 2 Amarelo" e o cabo, com o atalho "Abrir o cabo". Se o cabo foi excluído, diz
  "cabo não encontrado" e **mantém o dado**.
- Fica nos atributos da CTO (`feedCableId` e `feedFiber`).

## Rota acesa

**Tocar em qualquer parte de um cabo** (no mapa do app) acende a **rota toda**: os cabos ligados direta ou indiretamente, com um halo
amarelo; o cabo tocado ganha um contorno branco; os pontos de ligação ficam marcados; o resto do mapa esmaece. Abre uma folha embaixo:

- **"Rota: 3 cabos · 380,0 m · 2 CTOs"**, a lista dos cabos (com quantas fibras já estão em uso) e das CTOs, cada uma com a **fibra de
  entrada** ("CTO-1 · Fibra 7 · Marrom") ou "fibra de entrada não informada".
- **Abrir este cabo** (ficha), tocar num cabo ou numa CTO da lista (abre a ficha) e **Fechar**. Abrir uma ficha encerra a rota.
- Tocar no vazio do mapa apaga a rota; ao marcar um elemento ou lançar cabo ela também some. Se o mapa não mostra a rota inteira, ele
  enquadra.

No **painel do escritório** o mesmo vale no mapa da rede: clicar num cabo (ou achá-lo na busca) acende a rota; a ficha mostra a rota e as
CTOs com a fibra de cada uma, e o "Mostrar no mapa" enquadra a rota inteira. A ficha de uma CTO mostra a "Fibra de entrada".

A **exportação** leva o padrão de cores e a rota do cabo e a fibra de entrada da CTO (KML e GeoJSON).

## Limites e cuidados

- Só os dois padrões de cores (ABNT e TIA-598) e 12 fibras por tubo, por enquanto.
- **Emenda por fibra** (qual fibra do cabo A emenda com qual do cabo B) **não existe ainda**: as ligações são entre cabos. Por isso a CTO
  guarda a fibra **do cabo escolhido** (normalmente a derivação que chega nela), não a fibra do tronco que a alimenta lá atrás.
- Até 200 ligações por cabo (igual ao banco).
- O app não impede duas CTOs na mesma fibra: avisa.

## Onde está o código

`src/features/cables/`: `fibers.ts` (cores e tubos), `routes.ts` (ligações e rota), `feed.ts` (fibra da CTO), `routeSummary.ts` (resumo da
rota), `linkData.ts`, `routeStore.ts`; telas `ElementCableLinks`, `CtoFeedFields`, `CtoFeedInfo`, `FiberList`, `FiberPicker`,
`RouteSheet`, `RouteSummaryView`, `CablesLayer` (rota acesa). Banco: `supabase/migrations/20261006150800_cabos_fibras.sql` (colunas
`color_standard` e `links`; pode ser colada de novo sem erro) e `supabase/conferir-fibras.sql`.
