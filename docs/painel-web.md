# Painel web (escritório / NOC)

Para acompanhar a rede e o histórico no computador. É a **mesma aplicação** do celular, aberta em `#/painel`
(Configurações → **Painel** → "Abrir o painel"). Só **leitura**: quem precisa corrigir usa as telas de sempre.

## Quem abre

| Papel | Painel | Observação |
|---|---|---|
| Escritório | sim, só leitura | vê tudo, não altera nem exclui nada |
| Administrador | sim | pode também editar e excluir pelas telas e fichas |
| Técnico | não | usa o app de campo |
| Pendente, desativado, sem conta | não | a tela diz o motivo |

## O que tem

- **Visão geral:** técnicos, atividades (e quantas em aberto), elementos por tipo, cabos, metros e fotos da rede que o navegador conhece.
- **Mapa da rede:** todos os técnicos no mesmo mapa, com filtros (técnico, tipo e situação da atividade, período, tipos de elemento,
  nº de fibras, elementos/cabos), busca (código, OS, atividade, técnico), ficha de leitura com fotos e "Abrir ficha completa".
  Com mais de 1500 pontos na tela eles viram bolinhas leves; aproximando, voltam os símbolos.
- **Atividades:** tabela ordenável (técnico, tipo, situação, início, duração, elementos, cabos, metros, fotos), filtros, busca que
  também acha pelo que há *dentro* da atividade (código de poste, tipo de cabo), rodapé com a soma do que está filtrado e ficha
  com materiais, totais e lista de elementos e cabos.
- **Totais:** por técnico e período — atividades, cabos, traçado, reservas, total de cabo e elementos por tipo; **CSV** para o
  Excel brasileiro; **Conferir com o servidor** (soma os cabos no servidor e compara).
- **Exportar** e **Sincronização:** abrem as telas de sempre (KMZ, GeoJSON e KML, por atividade ou da rede toda).

## Regras que valem em todo o painel

1. **Trabalha com o que já foi sincronizado neste navegador** (inclusive sem internet). Para trazer o mais novo: "Sincronizar agora".
   Só a *conferência dos totais* e a *trilha GPS* precisam de internet.
2. **Período:** nas atividades vale pelo **início**; nos totais, pela **data em que o cabo ou o elemento foi registrado**
   (a mesma regra da função `cable_totals` do servidor). O dia final entra inteiro.
3. **Excluído não conta:** registros excluídos, e o que sobrou de uma atividade excluída, ficam fora de mapa, tabelas e totais.
4. **Totais de cabo** = traçado + reservas, os mesmos números que o técnico viu no celular.
5. **A trilha GPS não vira cabo.** "Ver trilha GPS" (administrador e escritório) baixa a trilha da atividade só quando pedida,
   guarda só na memória e desenha em azul tracejado.

## Excluir atividade (dono e administrador)

Exclusão **lógica** (nunca `DELETE`). Leva junto elementos, cabos, fotos e trilha da atividade, com a mesma hora, numa transação.
Confirmação diz o que sai. Detalhes e limites (trilha de técnico excluída pelo administrador) em `supabase/README.md`.

## Limites conhecidos

- Os números vêm do navegador; se um técnico acabou de enviar algo e o painel não mostra, sincronize (ou use "Conferir").
- Primeira carga baixa a rede inteira; com dezenas de milhares de elementos o mapa passa a desenhar só a área visível, mas a
  memória do navegador ainda é o limite. Se isso acontecer, o próximo passo é consultar o servidor por região.
- Fotos de colegas aparecem na ficha depois de baixadas (precisa de internet na primeira vez).
- Sem relatório em PDF nem impressão.

## Onde está o código

`src/features/panel/` (lógica pura e testada: `mapFilters`, `activityRows`, `totals`, `serverTotals`, `csv`, `viewport`;
estado que sobrevive a abrir uma ficha e voltar: `panelMapStore`, `panelTableStore`, `panelTotalsStore`; telas `*Section.tsx`).
O servidor só é usado por `serverTotals.ts` (`cable_totals`) e pela trilha (`src/features/admin/`).
