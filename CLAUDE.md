# RotaFibra — app de campo para documentar rotas de fibra

## Contexto
Provedor de internet (FTTH, EPON/GPON) no Brasil. Os técnicos de estrutura usam o app no celular, em campo, para documentar por onde o cabo de fibra passa (implantação) e o que foi feito em cada atendimento (manutenção). O escritório/NOC usa um painel web para ver a rede e o histórico.

Idioma: interface 100% em português do Brasil. Código (variáveis, funções, tabelas) em inglês. Comentários podem ser em português.

## Princípios (não negociáveis)
1. **Offline-first.** Tudo é salvo primeiro no aparelho (IndexedDB). Nenhuma ação de campo pode depender de internet.
2. **O cabo é desenhado poste a poste**, ligando elementos marcados. A trilha GPS é um registro separado de deslocamento e nunca vira traçado de cabo automaticamente.
3. **Precisão visível.** Todo ponto capturado por GPS guarda a precisão em metros. Acima de 15 m, o app avisa e oferece ajustar o ponto arrastando sobre o satélite.
4. **Feito para campo:** mobile-first, botões com no mínimo 48 px, alto contraste (legível no sol), uso com uma mão, poucos toques por ação, confirmação antes de excluir.
5. **Nunca colocar credenciais no frontend** (service key do Supabase, tokens da OLT). No app, só a anon key do Supabase, protegida por RLS.
6. **Exclusão sempre lógica** (`deleted = true`), para não quebrar a sincronização.

## Stack
- Vite + React + TypeScript (strict)
- Leaflet + react-leaflet; camadas OpenStreetMap (ruas) e satélite (Esri World Imagery), com atribuição
- Dexie.js (IndexedDB) para persistência local
- vite-plugin-pwa (Workbox): app instalável, offline, cache dos tiles já visitados com limite de entradas
- Turf.js (`@turf/length`, `@turf/distance`) para medidas
- `@tmcw/togeojson` para importar KML; JSZip para KMZ; geração de KML própria
- `@vitejs/plugin-basic-ssl` no dev, para testar no celular via HTTPS na rede local (geolocalização exige HTTPS)
- Fase 2: Supabase (Auth, Postgres + PostGIS, Storage)
- Fase 3: coletor Node.js + TypeScript rodando dentro da rede da empresa
- Testes: Vitest para a lógica (metragem, filtro da trilha, KML, sincronização)

## Modelo de dados
Todos os registros têm: `id` (UUID gerado no aparelho), `createdAt`, `updatedAt`, `createdBy`, `deleted`, `syncStatus` (`'pending' | 'synced'`).

### Activity (atividade)
- `kind`: `'implantacao' | 'manutencao'`
- `title`, `osNumber` (opcional), `technician`
- `startedAt`, `endedAt`, `status`: `'aberta' | 'concluida'`
- `description`, `materials`: `[{ item, quantity, unit }]`
- `projectId?`, `completesProject?`: de qual projeto designado ela veio e se, com ela, o técnico terminou o projeto
- Elementos, cabos, fotos e trilha GPS pertencem a uma atividade.

### Project (projeto designado)
- Criado só pelo administrador (pela internet); no aparelho é uma **cópia só de leitura** do servidor (nunca é enviada; não é `BaseRecord`).
- `title`, `kind`, `osNumber?`, `description` (instruções), `address`, `lat?`/`lng?`, `dueDate?` (`AAAA-MM-DD`), `assignedTo` (técnico), `status`: `'aberto' | 'concluido' | 'cancelado'`, `deleted`
- A situação mostrada (pendente, em andamento, concluído, cancelado) sai de `status` + atividades ligadas (`projectState`); o técnico nunca grava o projeto. Guia em `docs/projetos.md`.

### Element (elemento de rede)
- `type`: `'poste' | 'cto' | 'ceo' | 'reserva' | 'ocorrencia' | 'outro'`
- `lat`, `lng`, `accuracy`, `positionSource`: `'gps' | 'manual'`
- `code` (identificação/plaqueta), `notes`, `activityId`
- `attrs` por tipo:
  - poste: `owner` (`'concessionaria' | 'proprio' | 'outro'`), `ownerCode`
  - cto: `capacity` (8, 16…), `splitter` (`'1:8' | '1:16'`…), `oltName?`, `ponPort?` (usados na Fase 3)
  - ceo: `trays`, `splices`
  - reserva: `meters`, `cableId`
  - ocorrencia: `problem` (`'rompimento' | 'atenuacao' | 'poste_caido' | 'caixa_danificada' | 'outro'`), `actionTaken`

### Cable (cabo)
- `cableType`: `'drop' | 'AS-80' | 'AS-120' | 'outro'` (lista editável nas Configurações)
- `fiberCount`: 1 | 2 | 4 | 6 | 12 | 24 | 36 | 48 | 72 | 144
- `vertices`: lista ordenada de `{ elementId?, lat, lng }`; normalmente cada vértice é um poste, CTO ou CEO
- `lengthMeters` (calculado do traçado), `reserveMeters` (soma das reservas ligadas), `totalMeters`
- `activityId`, `notes`

### Photo
- `blob` (local, JPEG comprimido para ~1600 px no maior lado, qualidade ~0.7), `remoteUrl` (Fase 2)
- `lat`, `lng`, `takenAt`, `elementId?`, `activityId`

### TrackPoint (trilha GPS)
- `activityId`, `lat`, `lng`, `accuracy`, `timestamp`, `speed?`
- Filtro: descartar pontos com precisão pior que 30 m e pontos a menos de 5 m do anterior.

## Organização do código (sugerida)
```
src/
  db/          Dexie, schema, migrações locais
  features/    map, activities, elements, cables, tracking, photos, export, settings, sync, panel
  lib/         geo.ts, kml.ts, image.ts
  components/  UI compartilhada
supabase/migrations/   (Fase 2)
collector/             (Fase 3)
```

## Papéis e painel web
- Papéis (`profiles.role`): `tecnico` (campo; só altera o que é dele), `escritorio` (só leitura, abre o painel) e `admin` (altera e exclui tudo, aprova pessoas). Só perfil **ativo** vale; o servidor (RLS) é quem garante, o app só esconde o que não serviria.
- Painel web (escritório/NOC): mesma aplicação, rota `#/painel` (`src/features/panel/`), só leitura, trabalha com o que o navegador já sincronizou. Guia em `docs/painel-web.md`.
- Projetos designados: o admin cria e entrega a um técnico (`#/projetos`, `src/features/projects/`); o técnico vê "Você tem N projetos para fazer" ao abrir o app, inicia (a atividade nasce ligada) e, ao concluir, responde se o projeto terminou; o escritório os acompanha na seção Projetos do painel. O servidor nunca recusa trabalho de campo por mudança no projeto. Guia em `docs/projetos.md`.
- Excluir atividade (dono e admin) é lógico e em cascata (elementos, cabos, fotos, trilha). Admin edita registros de outros pelo envio normal; o servidor registra quem alterou (`admin_edits`).
- Lista do que testar no celular/computador: `docs/guia-de-testes.md`.

## Comandos
- `npm run dev`: servidor HTTPS na rede local (acessar pelo celular no mesmo Wi-Fi)
- `npm run build` / `npm run preview`
- `npm test`
- `npm run test:db`: testes do banco (RLS, migrations, sincronização e painel contra Postgres + PostgREST de verdade); precisa de `TEST_DATABASE_URL` e `POSTGREST_BIN`, ver `supabase/README.md`

## Forma de trabalhar
- Antes de cada fase, apresente um plano curto e espere confirmação.
- Commits pequenos e descritivos ao fim de cada etapa.
- Ao terminar uma etapa, liste o que testar no celular.
- Se faltar informação (ex.: formato de resposta de uma API), pergunte em vez de inventar.
