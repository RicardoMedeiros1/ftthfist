# POP e "Como usar"

Esta pasta guarda os **procedimentos operacionais padrão (POP)** do RotaFibra, para treinar a equipe:

- [`POP-RotaFibra.md`](POP-RotaFibra.md): o POP em texto, com as telas de exemplo (abre direto no GitHub).
- `POP-RotaFibra.pdf`: o mesmo POP em PDF, para imprimir ou mandar.
- No app, o mesmo passo a passo é **interativo**: *Ajustes › Como usar* (página `demo/`, publicada junto do app).

## De onde vem o texto

Um texto só serve aos três: [`public/demo/conteudo.js`](../../public/demo/conteudo.js). Cada capítulo tem os **passos**
(com a tela de exemplo) e o **procedimento** (`pop`: quem faz, objetivo, antes de começar, como conferir, se der errado).
As telas ficam em `public/demo/img/` e o destaque do próximo toque em `public/demo/hotspots.js` (gerado pelas capturas).

## Como atualizar

1. **Texto**: edite `public/demo/conteudo.js` (português, com acento). `npm test` confere que cada passo tem a sua tela, que nenhuma
   tela sobra, que os destaques estão dentro da imagem e que cada capítulo tem o POP completo.
2. **Markdown do POP**: `node scripts/gerar-pop.mjs` (reescreve `POP-RotaFibra.md`).
3. **PDF**: gere a versão de imprimir e converta com o Chromium (a mesma que o Playwright usa):

   ```bash
   node scripts/gerar-pop.mjs --html /tmp/pop.html --img <pasta com as telas em .jpg> --ext jpg
   chromium --headless --no-sandbox --print-to-pdf=docs/pop/POP-RotaFibra.pdf --no-pdf-header-footer /tmp/pop.html
   ```

   (as telas em .jpg são cópias pequenas das .webp de `public/demo/img/`, só para o PDF não pesar.)
4. **Telas novas**: quando uma tela do app mudar, refaça as capturas (roteiro com dados de exemplo, nada real) e converta para
   `public/demo/img/*.webp`; o `hotspots.js` é gerado junto.

## Regras

- Os dados e nomes das telas são **de exemplo**. Nunca coloque captura de dado real.
- O "Como usar" é público (o site publicado é aberto) e não tem login; por isso só leva telas de exemplo.
