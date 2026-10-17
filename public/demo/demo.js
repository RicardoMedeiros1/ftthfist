// Como usar o RotaFibra: passo a passo com telas de exemplo (dados de exemplo; nada real).
// Funciona sem internet: a página vem do service worker do app e as telas (img/) entram no cache ao serem vistas ou pelo botão "Guardar".
import { PAPEIS, CAPITULOS } from './conteudo.js';
import { HOTSPOTS } from './hotspots.js';

const app = document.getElementById('app');
const topTitle = document.getElementById('top-title');
const IMG_CACHE = 'demo-img';
const AUTO_MS = 6000;
let auto = null; // intervalo da reprodução automática
const lastRole = () => { try { return localStorage.getItem('rf-demo-papel'); } catch { return null; } };
const saveRole = (r) => { try { localStorage.setItem('rf-demo-papel', r); } catch { /* sem armazenamento: tudo bem */ } };

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('aria-') && typeof v === 'boolean') { n.setAttribute(k, String(v)); continue; } // aria-pressed="true"/"false"
    if (v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};
const list = (tag, items) => el(tag, {}, items.map((t) => el('li', {}, t)));

// ---------- rota (#/papel/capitulo/passo) ----------
function parse() {
  const m = /^#\/([\w-]+)(?:\/([\w-]+))?(?:\/(\d+))?/.exec(location.hash);
  const papel = PAPEIS.find((p) => p.id === m?.[1])?.id ?? (PAPEIS.find((p) => p.id === lastRole())?.id ?? PAPEIS[0].id);
  const cap = CAPITULOS.find((c) => c.papel === papel && c.id === m?.[2]) ?? null;
  const passo = cap && m?.[3] ? Math.max(1, Math.min(cap.passos.length + 1, Number(m[3]))) : 1;
  return { papel, cap, passo };
}
const go = (hash, replace = false) => { if (replace) history.replaceState(null, '', hash); else location.hash = hash; if (replace) render(); };
const hashFor = (papel, cap, passo) => `#/${papel}${cap ? `/${cap.id}` : ''}${cap && passo ? `/${passo}` : ''}`;

function stopAuto() { if (auto) { clearInterval(auto); auto = null; } }

// ---------- início: papéis e capítulos ----------
function renderHome({ papel }) {
  stopAuto(); saveRole(papel);
  topTitle.textContent = 'Como usar o RotaFibra';
  const caps = CAPITULOS.filter((c) => c.papel === papel);
  const papelInfo = PAPEIS.find((p) => p.id === papel);
  app.replaceChildren(
    el('section', { class: 'hero' },
      el('h2', {}, 'Passo a passo com telas de exemplo'),
      el('p', {}, 'Toque no destaque da tela, como faria no app, ou use os botões para avançar. Os dados e nomes são de exemplo.'),
    ),
    el('div', { class: 'roles', role: 'group', 'aria-label': 'Quem vai usar' },
      PAPEIS.map((p) => el('button', { class: 'role', type: 'button', 'aria-pressed': p.id === papel, onclick: () => go(`#/${p.id}`) }, el('b', {}, p.titulo), el('span', {}, p.sub))),
    ),
    el('p', { class: 'count' }, `${papelInfo.titulo}: ${caps.length} capítulos`),
    el('div', { class: 'chapters' },
      caps.map((c, i) => el('a', { class: 'chapter', href: hashFor(papel, c, 1) },
        el('span', { class: 'num', 'aria-hidden': 'true' }, i + 1),
        el('span', {}, el('h3', {}, c.titulo), el('p', {}, c.resumo), el('small', {}, `${c.passos.length} passos · cerca de ${Math.max(1, Math.round((c.passos.length * 25) / 60))} min`)),
      )),
    ),
    offlineCard(),
  );
}

// ---------- guardar as telas para usar sem internet ----------
const allImages = () => [...new Set(CAPITULOS.flatMap((c) => c.passos.map((p) => p.img)).filter(Boolean))];
async function cachedCount() {
  try { if (!('caches' in window)) return 0; const c = await caches.open(IMG_CACHE); const keys = await c.keys(); const have = new Set(keys.map((r) => new URL(r.url).pathname.split('/').pop().replace('.webp', ''))); return allImages().filter((i) => have.has(i)).length; } catch { return 0; }
}
function offlineCard() {
  const total = allImages().length;
  const status = el('p', {}, 'Conferindo as telas guardadas…');
  const bar = el('div', { class: 'bar', hidden: true }, el('i'));
  const btn = el('button', { class: 'btn', type: 'button' }, 'Guardar tudo para usar sem internet');
  const refresh = async () => {
    const n = await cachedCount();
    if (n >= total) { status.textContent = `Pronto: as ${total} telas estão guardadas neste aparelho. Dá para usar sem internet.`; btn.hidden = true; }
    else { status.textContent = `${n} de ${total} telas guardadas neste aparelho. As que você já viu abrem sem internet; para ter todas, guarde com internet (uns poucos MB).`; btn.hidden = false; }
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true; bar.hidden = false; let done = 0;
    const queue = allImages().slice();
    const worker = async () => { for (let img = queue.shift(); img; img = queue.shift()) { try { await fetch(`img/${img}.webp`); } catch { /* sem internet: segue */ } done++; bar.firstChild.style.width = `${(done / total) * 100}%`; status.textContent = `Guardando… ${done} de ${total}`; } };
    await Promise.all([worker(), worker(), worker()]);
    // o service worker termina de gravar no cache um instante depois da resposta: espera todas aparecerem
    status.textContent = 'Conferindo as telas guardadas…';
    for (let i = 0; i < 20 && (await cachedCount()) < total; i++) await new Promise((r) => setTimeout(r, 500));
    bar.hidden = true; btn.disabled = false; await refresh();
  });
  refresh();
  return el('section', { class: 'offline-card', 'aria-label': 'Usar sem internet' }, el('b', {}, 'Sem internet no campo?'), status, bar, btn);
}

// ---------- um capítulo, passo a passo ----------
function shotFor(passo, papelDevice) {
  const hs = passo.img ? HOTSPOTS[passo.img] : null;
  if (!passo.img) return null;
  const device = hs?.device ?? papelDevice;
  return { id: passo.img, device, tap: hs?.tap ?? null };
}

function renderPlayer({ papel, cap, passo }) {
  topTitle.textContent = cap.titulo;
  const n = cap.passos.length;
  const papelInfo = PAPEIS.find((p) => p.id === papel);
  const idx = passo - 1;
  const caps = CAPITULOS.filter((c) => c.papel === papel);
  const capIdx = caps.indexOf(cap);

  const crumbs = el('div', { class: 'crumbs' }, el('a', { href: `#/${papel}` }, `← ${papelInfo.titulo}`), el('span', { class: 'count' }, `Capítulo ${capIdx + 1} de ${caps.length}`));

  if (passo > n) { // fim do capítulo
    stopAuto();
    const next = caps[capIdx + 1];
    app.replaceChildren(crumbs, el('section', { class: 'end' },
      el('h2', {}, 'Capítulo concluído'), el('p', {}, `Você viu ${n} passos de “${cap.titulo}”.`),
      next ? el('a', { class: 'btn btn-primary', href: hashFor(papel, next, 1) }, `Próximo: ${next.titulo}`) : null,
      el('a', { class: 'btn', href: hashFor(papel, cap, 1) }, 'Rever este capítulo'),
      el('a', { class: 'btn', href: `#/${papel}` }, 'Todos os capítulos'),
      popBlock(cap, true),
    ));
    return;
  }

  const step = cap.passos[idx];
  const shot = shotFor(step, papelInfo.device);
  const advance = () => go(hashFor(papel, cap, passo + 1));
  const back = () => go(hashFor(papel, cap, Math.max(1, passo - 1)));

  let stage;
  if (shot) {
    const img = el('img', { src: `img/${shot.id}.webp`, alt: `Tela de exemplo: ${step.titulo}`, decoding: 'async' });
    const box = el('div', { class: 'shot' }, img);
    img.addEventListener('error', () => { box.className = 'shot missing'; box.replaceChildren(document.createTextNode('Esta tela ainda não foi guardada neste aparelho. Conecte-se à internet e abra de novo.')); });
    if (shot.tap) {
      const pad = shot.device === 'phone' ? 0.006 : 0.004;
      const { x, y, w, h } = shot.tap;
      box.append(el('button', { class: 'hot', type: 'button', 'aria-label': step.acao ? `${step.acao} (toque aqui para avançar)` : 'Toque aqui para avançar', onclick: advance,
        style: `left:${(x - pad) * 100}%;top:${(y - pad) * 100}%;width:${(w + 2 * pad) * 100}%;height:${(h + 2 * pad) * 100}%` }));
    }
    stage = el('div', { class: 'stage' }, el('div', { class: `frame ${shot.device}` }, el('div', { class: 'chrome', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), box));
  }

  const dots = el('div', { class: 'dots', role: 'group', 'aria-label': 'Passos do capítulo' },
    cap.passos.map((_, i) => el('button', { type: 'button', 'aria-label': `Ir para o passo ${i + 1}`, 'aria-current': i === idx ? 'step' : null, class: i < idx ? 'done' : '', onclick: () => go(hashFor(papel, cap, i + 1)) })));
  const playBtn = el('button', { class: 'btn', type: 'button', onclick: () => { if (auto) { stopAuto(); playBtn.textContent = '▶ Reproduzir'; } else { auto = setInterval(() => { const cur = parse(); if (cur.passo > n) return stopAuto(); go(hashFor(papel, cap, cur.passo + 1)); }, AUTO_MS); playBtn.textContent = '❚❚ Pausar'; } } }, auto ? '❚❚ Pausar' : '▶ Reproduzir');
  const text = el('div', { class: `text-card${shot ? '' : ' only'}` },
    el('span', { class: 'count' }, `Passo ${passo} de ${n}`),
    el('h2', { class: 'step-title' }, step.titulo),
    el('p', { class: 'step-text' }, step.texto),
    step.acao ? el('p', { class: 'action' }, `👉 ${step.acao}`) : null,
    step.dica ? el('p', { class: 'note' }, `Dica: ${step.dica}`) : null,
    step.atencao ? el('p', { class: 'note warn' }, `Atenção: ${step.atencao}`) : null,
    dots,
    el('div', { class: 'tools' }, playBtn),
  );
  const nav = el('nav', { class: 'nav', 'aria-label': 'Passos' },
    el('button', { class: 'btn', type: 'button', disabled: passo === 1, onclick: back }, '← Voltar'),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: advance }, passo === n ? 'Concluir ✓' : 'Próximo →'),
  );
  // no celular o texto vem antes da tela (o que fazer, depois onde); no computador a tela fica ao lado do texto
  app.replaceChildren(crumbs, el('div', { class: `player ${shot?.device === 'phone' ? 'is-phone' : ''}${shot ? '' : ' no-shot'}` },
    el('div', { class: 'a-text' }, text), stage ? el('div', { class: 'a-stage' }, stage) : null, el('div', { class: 'a-nav' }, nav), el('div', { class: 'a-pop' }, popBlock(cap))));
  // pré-carrega a tela do próximo passo
  const nextImg = cap.passos[idx + 1]?.img; if (nextImg) fetch(`img/${nextImg}.webp`).catch(() => undefined);
}

// ---------- o POP do capítulo (o mesmo conteúdo do documento) ----------
function popBlock(cap, open = false) {
  const p = cap.pop; if (!p) return el('span');
  return el('details', { class: 'pop', open: open || null },
    el('summary', {}, `Procedimento (POP): ${cap.titulo}`),
    el('div', { class: 'pop-body' },
      el('p', {}, el('b', {}, 'Objetivo: '), p.objetivo),
      el('p', {}, el('b', {}, 'Quem faz: '), p.quem),
      p.antes?.length ? [el('h4', {}, 'Antes de começar'), list('ul', p.antes)] : null,
      el('h4', {}, 'Passo a passo'), list('ol', cap.passos.map((s) => s.acao ?? s.titulo)),
      p.conferir?.length ? [el('h4', {}, 'Como conferir que deu certo'), list('ul', p.conferir)] : null,
      p.seDerErrado?.length ? [el('h4', {}, 'Se der errado'), list('ul', p.seDerErrado)] : null,
    ));
}

function render() {
  const r = parse();
  if (!r.cap) return renderHome(r);
  saveRole(r.papel); renderPlayer(r); window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', render);
window.addEventListener('keydown', (e) => {
  const r = parse(); if (!r.cap) return;
  if (e.key === 'ArrowRight') go(hashFor(r.papel, r.cap, Math.min(r.cap.passos.length + 1, r.passo + 1)));
  else if (e.key === 'ArrowLeft') go(hashFor(r.papel, r.cap, Math.max(1, r.passo - 1)));
  else if (e.key === 'Escape') go(`#/${r.papel}`);
});
// o "← App" volta para onde o app estava (Ajustes) e, sem histórico do app, abre as Configurações
document.getElementById('back-app').setAttribute('href', new URL('../#/config', location.href).href);
render();
