// Gera o POP (procedimentos operacionais padrão) a partir do mesmo texto do "Como usar" (public/demo/conteudo.js).
//   node scripts/gerar-pop.mjs                      -> docs/pop/POP-RotaFibra.md
//   node scripts/gerar-pop.mjs --html saida.html --img pasta --ext jpg   -> versão para imprimir/PDF (ver docs/pop/README.md)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { PAPEIS, CAPITULOS } = await import(pathToFileURL(resolve(RAIZ, 'public/demo/conteudo.js')).href);
const { HOTSPOTS } = await import(pathToFileURL(resolve(RAIZ, 'public/demo/hotspots.js')).href);
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const htmlOut = arg('--html'); const imgDir = arg('--img'); const ext = arg('--ext') ?? 'webp';
const HOJE = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const larg = (img) => (HOTSPOTS[img]?.device === 'desktop' ? 560 : 230);
const ORDEM = PAPEIS.map((p) => p.id);
const caps = [...CAPITULOS].sort((a, b) => ORDEM.indexOf(a.papel) - ORDEM.indexOf(b.papel));

// ------------------------------------------------------------------ Markdown
function markdown() {
  const L = [];
  L.push('# POP: como usar o RotaFibra', '');
  L.push('Procedimentos operacionais padrão (POP) do app **RotaFibra**, para o técnico de campo e para o administrador e o escritório. Cada procedimento diz quem faz, o que precisa ter antes, o passo a passo (com a tela de exemplo), como conferir que deu certo e o que fazer se der errado.', '');
  L.push('> As telas são de exemplo (dados e nomes inventados). Há também o passo a passo interativo, no próprio app: **Ajustes › Como usar**.', '');
  L.push(`Versão de ${HOJE}. Gerado a partir de \`public/demo/conteudo.js\` (o mesmo texto do “Como usar”); para atualizar, veja [README](README.md).`, '');
  L.push('## Sumário', '');
  for (const p of PAPEIS) {
    L.push(`**${p.titulo}**`, '');
    for (const c of caps.filter((x) => x.papel === p.id)) L.push(`- [${c.pop.codigo} · ${c.titulo}](#${c.pop.codigo.toLowerCase()})`);
    L.push('');
  }
  for (const p of PAPEIS) {
    L.push('---', '', `# ${p.titulo}`, '', p.sub, '');
    for (const c of caps.filter((x) => x.papel === p.id)) {
      L.push(`<a id="${c.pop.codigo.toLowerCase()}"></a>`, '', `## ${c.pop.codigo} · ${c.titulo}`, '');
      L.push(`**Quem faz:** ${c.pop.quem}`, '', `**Objetivo:** ${c.pop.objetivo}`, '');
      L.push('**Antes de começar**', '', ...c.pop.antes.map((t) => `- ${t}`), '');
      L.push('**Passo a passo**', '');
      c.passos.forEach((s, i) => {
        L.push(`${i + 1}. **${s.titulo}.** ${s.texto}`);
        if (s.acao) L.push(`   - 👉 ${s.acao}`);
        if (s.dica) L.push(`   - Dica: ${s.dica}`);
        if (s.atencao) L.push(`   - Atenção: ${s.atencao}`);
        if (s.img) L.push('', `   <img src="../../public/demo/img/${s.img}.webp" width="${larg(s.img)}" alt="Tela de exemplo: ${esc(s.titulo)}">`);
        L.push('');
      });
      L.push('**Como conferir que deu certo**', '', ...c.pop.conferir.map((t) => `- ${t}`), '');
      L.push('**Se der errado**', '', ...c.pop.seDerErrado.map((t) => `- ${t}`), '');
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ------------------------------------------------------------------ HTML para imprimir (PDF)
function html() {
  const src = (img) => `${imgDir}/${img}.${ext}`;
  const lista = (a) => `<ul>${a.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  const passos = (c) => c.passos.map((s, i) => `<tr><td class="n">${i + 1}</td><td class="t"><b>${esc(s.titulo)}.</b> ${esc(s.texto)}${s.acao ? `<div class="acao">👉 ${esc(s.acao)}</div>` : ''}${s.dica ? `<div class="nota">Dica: ${esc(s.dica)}</div>` : ''}${s.atencao ? `<div class="nota aviso">Atenção: ${esc(s.atencao)}</div>` : ''}</td><td class="i">${s.img ? `<img class="${HOTSPOTS[s.img]?.device}" src="${src(s.img)}" alt="">` : ''}</td></tr>`).join('');
  const sec = (c) => `<section class="pop"><h2><span>${c.pop.codigo}</span> ${esc(c.titulo)}</h2>
<table class="ficha"><tr><th>Quem faz</th><td>${esc(c.pop.quem)}</td></tr><tr><th>Objetivo</th><td>${esc(c.pop.objetivo)}</td></tr></table>
<h3>Antes de começar</h3>${lista(c.pop.antes)}<h3>Passo a passo</h3><table class="passos">${passos(c)}</table>
<h3>Como conferir que deu certo</h3>${lista(c.pop.conferir)}<h3>Se der errado</h3>${lista(c.pop.seDerErrado)}</section>`;
  const sumario = PAPEIS.map((p) => `<h3>${esc(p.titulo)}</h3><ul>${caps.filter((c) => c.papel === p.id).map((c) => `<li>${c.pop.codigo} · ${esc(c.titulo)}</li>`).join('')}</ul>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>POP: como usar o RotaFibra</title><style>
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; } body { font: 10.5pt/1.4 system-ui, 'Segoe UI', Roboto, sans-serif; color: #15191e; margin: 0; }
h1 { font-size: 26pt; margin: 0 0 6mm; } h2 { font-size: 17pt; margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 2.5px solid #7aa51c; } h2 span { display: inline-block; background: #111418; color: #b6f23c; padding: 1mm 3mm; border-radius: 3mm; margin-right: 3mm; font-size: 12pt; }
h3 { font-size: 11.5pt; margin: 5mm 0 1.5mm; color: #4a6a0a; } ul { margin: 0 0 0 5mm; padding: 0; } li { margin: 0.8mm 0; }
.capa { page-break-after: always; padding-top: 30mm; } .capa p { max-width: 150mm; } .capa .sub { color: #4a5560; }
.role { page-break-before: always; font-size: 22pt; margin: 0 0 3mm; } .role + p { margin: 0 0 6mm; color: #4a5560; }
.pop { page-break-before: always; } .pop.primeiro { page-break-before: avoid; }
table { border-collapse: collapse; width: 100%; } .ficha th { text-align: left; width: 28mm; vertical-align: top; padding: 1.5mm 3mm 1.5mm 0; color: #4a5560; } .ficha td { padding: 1.5mm 0; }
.passos td { vertical-align: top; padding: 2.5mm 2mm; border-top: 1px solid #d5dbe1; } .passos tr { break-inside: avoid; } .passos .n { width: 8mm; font-weight: 800; color: #4a6a0a; font-size: 13pt; } .passos .i { width: 46mm; text-align: right; }
.passos img.phone { width: 40mm; border: 1.2mm solid #2b3138; border-radius: 5mm; } .passos img.desktop { width: 46mm; border: 0.6mm solid #2b3138; border-radius: 1.5mm; }
.acao { margin-top: 1.5mm; padding: 1.2mm 2.5mm; background: #e9f7c4; border-radius: 2mm; font-weight: 700; } .nota { margin-top: 1.5mm; padding: 1mm 2.5mm; border-left: 1.2mm solid #7aa51c; background: #f1f3f5; } .nota.aviso { border-left-color: #d98a00; }
</style></head><body>
<section class="capa"><h1>POP: como usar o RotaFibra</h1><p class="sub">Procedimentos operacionais padrão do app RotaFibra, para o técnico de campo e para o administrador e o escritório.</p>
<p>Cada procedimento diz quem faz, o que ter antes, o passo a passo (com a tela de exemplo), como conferir que deu certo e o que fazer se der errado. As telas são de exemplo, com dados e nomes inventados. No app, o passo a passo interativo fica em <b>Ajustes › Como usar</b>.</p><p class="sub">Versão de ${HOJE}.</p>${sumario}</section>
${PAPEIS.map((p) => { const lista2 = caps.filter((c) => c.papel === p.id); return `<h1 class="role">${esc(p.titulo)}</h1><p>${esc(p.sub)}</p>` + lista2.map((c, i) => sec(c).replace('class="pop"', i === 0 ? 'class="pop primeiro"' : 'class="pop"')).join(''); }).join('')}
</body></html>`;
}

if (htmlOut) { writeFileSync(resolve(htmlOut), html()); console.log('HTML para PDF:', htmlOut); }
else { mkdirSync(resolve(RAIZ, 'docs/pop'), { recursive: true }); writeFileSync(resolve(RAIZ, 'docs/pop/POP-RotaFibra.md'), markdown()); console.log('docs/pop/POP-RotaFibra.md:', caps.length, 'procedimentos,', caps.reduce((a, c) => a + c.passos.length, 0), 'passos'); }
