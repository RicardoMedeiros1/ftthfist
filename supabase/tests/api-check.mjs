#!/usr/bin/env node
// Verificação DIRETO NA API (HTTP), sem passar pela interface do app: prova que um técnico não consegue
// editar nem apagar o registro de outro, nem criar em nome dele. Roda contra o seu projeto Supabase
// com 2 usuários de teste (técnicos) e, opcionalmente, um 3º de escritório. Veja supabase/README.md.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=sb_publishable_...  (a Publishable key; nunca a Secret) \
//   USER_A_EMAIL=... USER_A_PASSWORD=... USER_B_EMAIL=... USER_B_PASSWORD=... \
//   [USER_C_EMAIL=... USER_C_PASSWORD=...]   (escritorio, opcional) \
//   [USER_P_EMAIL=... USER_P_PASSWORD=...]   (cadastro PENDENTE, opcional: alguem que pediu acesso pelo app e ainda nao foi aprovado) \
//   node supabase/tests/api-check.mjs
//
// Cria alguns registros marcados "[verificação RLS]" e os marca como excluídos no fim (ninguém apaga linha).
// A foto de teste (1 pixel) permanece no bucket: o app também não apaga fotos.

import { randomUUID } from 'node:crypto';

const env = process.env;
const REST = env.REST_URL ?? (env.SUPABASE_URL ? `${env.SUPABASE_URL}/rest/v1` : null);
const STORAGE = env.STORAGE_URL ?? (env.SUPABASE_URL ? `${env.SUPABASE_URL}/storage/v1` : null);
const AUTH = env.AUTH_URL ?? (env.SUPABASE_URL ? `${env.SUPABASE_URL}/auth/v1` : null);
const APIKEY = env.SUPABASE_ANON_KEY ?? '';
if (!REST) {
  console.error('Defina SUPABASE_URL (ou REST_URL). Veja o cabeçalho deste arquivo.');
  process.exit(2);
}

let failures = 0;
const check = (cond, msg) => {
  if (!cond) failures++;
  console.log(`${cond ? 'OK   ' : 'FALHA'} ${msg}`);
};

const decodeSub = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;

async function login(prefix) {
  if (env[`${prefix}_TOKEN`]) return { token: env[`${prefix}_TOKEN`], id: decodeSub(env[`${prefix}_TOKEN`]) };
  const email = env[`${prefix}_EMAIL`];
  const password = env[`${prefix}_PASSWORD`];
  if (!email || !password) return null;
  const r = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: APIKEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login de ${prefix} falhou (HTTP ${r.status}): ${await r.text()}`);
  const j = await r.json();
  return { token: j.access_token, id: j.user.id };
}

const call = (who, method, path, body, headers = {}) =>
  fetch(`${REST}${path}`, {
    method,
    headers: {
      ...(APIKEY ? { apikey: APIKEY } : {}),
      ...(who ? { authorization: `Bearer ${who.token}` } : {}),
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const UPSERT = { prefer: 'resolution=merge-duplicates,return=minimal' };
const NOW = Date.now();
const iso = (offsetMs = 0) => new Date(NOW + offsetMs).toISOString();

const A = await login('USER_A');
const B = await login('USER_B');
const C = await login('USER_C'); // opcional (escritório)
const P = await login('USER_P'); // opcional (cadastro pendente, ainda nao aprovado)
if (!A || !B) {
  console.error('Preciso de USER_A_* e USER_B_* (e-mail+senha, ou _TOKEN).');
  process.exit(2);
}

const base = (owner) => ({ created_by: owner, created_at: iso(-60000), updated_at: iso(-60000) });
const actId = randomUUID();
const elId = randomUUID();
const activity = { id: actId, ...base('Teste A'), kind: 'implantacao', title: '[verificação RLS]', technician: 'Teste A', started_at: iso(-60000), status: 'aberta' };
const element = { id: elId, ...base('Teste A'), activity_id: actId, type: 'poste', lat: -23.55, lng: -46.63, position_source: 'manual', code: 'RLS-A', notes: 'original' };

console.log(`\nVerificando ${REST}\n`);

// ---- A cria o que é dela ----
let r = await call(A, 'POST', '/activities?on_conflict=id', activity, UPSERT);
check(r.status === 201 || r.status === 204, `A cria a atividade dela (HTTP ${r.status})`);
r = await call(A, 'POST', '/elements?on_conflict=id', element, UPSERT);
check(r.status === 201 || r.status === 204, `A cria o elemento dela (HTTP ${r.status})`);

// ---- reenviar não duplica ----
r = await call(A, 'POST', '/elements?on_conflict=id', element, UPSERT);
// o servidor descarta a escrita repetida e responde 200: para o app, qualquer 2xx é sucesso
check(r.ok, `A reenvia o mesmo elemento (internet caiu antes da resposta) (HTTP ${r.status})`);
r = await call(A, 'GET', `/elements?id=eq.${elId}&select=id,owner_id,notes`);
let rows = await r.json();
check(rows.length === 1 && rows[0].owner_id === A.id, `continua 1 só registro, e o dono gravado pelo servidor é A (${rows.length} linha)`);

// ---- B (outro técnico) ----
r = await call(B, 'GET', `/elements?id=eq.${elId}&select=id,notes`);
rows = await r.json();
check(r.ok && rows.length === 1, 'B LÊ o elemento de A (o técnico lê a rede toda)');

r = await call(B, 'PATCH', `/elements?id=eq.${elId}`, { notes: 'alterado por B', updated_at: iso() }, { prefer: 'return=representation' });
rows = r.ok ? await r.json() : [];
check(rows.length === 0, `B NÃO edita o registro de A: PATCH não alcança nenhuma linha (HTTP ${r.status}, ${rows.length} linhas)`);

r = await call(B, 'POST', '/elements?on_conflict=id', { ...element, notes: 'sequestrado por B' }, UPSERT);
check(r.status === 403 || r.status === 401, `B NÃO sobrescreve o registro de A reaproveitando o id: recusado (HTTP ${r.status})`);

r = await call(B, 'POST', '/elements', { ...element, id: randomUUID(), owner_id: A.id, activity_id: actId }, { prefer: 'return=minimal' });
check(r.status === 403 || r.status === 401, `B NÃO cria registro em nome de A (owner_id alheio): recusado (HTTP ${r.status})`);

r = await call(B, 'POST', '/elements', { ...element, id: randomUUID(), activity_id: actId }, { prefer: 'return=minimal' });
check(r.status === 403 || r.status === 401, `B NÃO pendura elemento na atividade de A: recusado (HTTP ${r.status})`);

r = await call(B, 'DELETE', `/elements?id=eq.${elId}`, undefined, { prefer: 'return=representation' });
check(r.status === 403 || r.status === 401, `B NÃO apaga o registro de A: recusado (HTTP ${r.status})`);

r = await call(A, 'DELETE', `/elements?id=eq.${elId}`, undefined, { prefer: 'return=representation' });
check(r.status === 403 || r.status === 401, `nem A apaga linha (a exclusão é lógica): recusado (HTTP ${r.status})`);

r = await call(A, 'PATCH', `/elements?id=eq.${elId}`, { owner_id: B.id, updated_at: iso() }, { prefer: 'return=minimal' });
check(r.status === 403 || r.status === 401, `A NÃO passa o registro para B (trocar owner_id): recusado (HTTP ${r.status})`);

// ---- o dono edita; o envio atrasado perde ----
r = await call(A, 'PATCH', `/elements?id=eq.${elId}`, { notes: 'editado por A', updated_at: iso() }, { prefer: 'return=representation' });
rows = r.ok ? await r.json() : [];
check(rows.length === 1 && rows[0].notes === 'editado por A', `A edita o que é dela (HTTP ${r.status})`);

r = await call(A, 'POST', '/elements?on_conflict=id', { ...element, notes: 'versão velha (outro aparelho)', updated_at: iso(-3600000) }, UPSERT);
r = await call(A, 'GET', `/elements?id=eq.${elId}&select=notes`);
rows = await r.json();
check(rows[0]?.notes === 'editado por A', `envio atrasado NÃO sobrescreve a versão mais nova (ficou: "${rows[0]?.notes}")`);

// ---- sem login ----
r = await call(null, 'GET', '/elements?select=id');
check(r.status === 401 || r.status === 403, `sem login (só a chave pública): nada é lido (HTTP ${r.status})`);
r = await call(null, 'POST', '/elements', { ...element, id: randomUUID() }, { prefer: 'return=minimal' });
check(r.status === 401 || r.status === 403, `sem login: nada é criado (HTTP ${r.status})`);

// ---- perfis ----
r = await call(B, 'PATCH', `/profiles?id=eq.${B.id}`, { role: 'admin' }, { prefer: 'return=representation' });
rows = r.ok ? await r.json() : [];
check(rows.length === 0, `B NÃO se promove a admin (HTTP ${r.status}, ${rows.length} linhas)`);

// ---- escritório (opcional) ----
if (C) {
  r = await call(C, 'GET', `/elements?id=eq.${elId}&select=id`);
  rows = r.ok ? await r.json() : [];
  check(rows.length === 1, 'escritório LÊ a rede');
  r = await call(C, 'POST', '/elements', { ...element, id: randomUUID(), activity_id: actId }, { prefer: 'return=minimal' });
  check(r.status === 403 || r.status === 401, `escritório NÃO cria dados de campo (HTTP ${r.status})`);
  r = await call(C, 'PATCH', `/elements?id=eq.${elId}`, { notes: 'alterado pelo escritório', updated_at: iso() }, { prefer: 'return=representation' });
  rows = r.ok ? await r.json() : [];
  check(rows.length === 0, `escritório NÃO edita dados de campo (HTTP ${r.status}, ${rows.length} linhas)`);
} else {
  console.log('(sem USER_C: etapa do escritório pulada)');
}

// ---- cadastro pendente (opcional): pediu acesso pelo app e ainda nao foi aprovado ----
if (P) {
  r = await call(P, 'GET', '/profiles?select=id,active');
  rows = r.ok ? await r.json() : [];
  check(rows.length === 1 && rows[0].id === P.id && rows[0].active === false, `o pendente enxerga SO o proprio perfil, marcado como inativo (${rows.length} perfil)`);
  r = await call(P, 'GET', `/elements?id=eq.${elId}&select=id`);
  rows = r.ok ? await r.json() : [];
  check(rows.length === 0, 'o pendente NAO le a rede (elementos)');
  r = await call(P, 'GET', '/activities?select=id');
  rows = r.ok ? await r.json() : [];
  check(rows.length === 0, 'o pendente NAO le atividades');
  r = await call(P, 'POST', '/activities', { ...activity, id: randomUUID(), owner_id: P.id }, { prefer: 'return=minimal' });
  check(r.status === 403 || r.status === 401, `o pendente NAO cria nada (HTTP ${r.status})`);
  r = await call(P, 'PATCH', `/profiles?id=eq.${P.id}`, { active: true, role: 'admin' }, { prefer: 'return=representation' });
  rows = r.ok ? await r.json() : [];
  check(rows.length === 0, `o pendente NAO se aprova nem se promove (HTTP ${r.status}, ${rows.length} linhas)`);
} else {
  console.log('(sem USER_P: etapa do cadastro pendente pulada)');
}

// ---- Storage (só no Supabase de verdade) ----
if (STORAGE && env.SUPABASE_URL) {
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const up = (who, path) =>
    fetch(`${STORAGE}/object/fotos/${path}`, { method: 'POST', headers: { apikey: APIKEY, authorization: `Bearer ${who.token}`, 'content-type': 'image/jpeg' }, body: jpeg });
  const photoId = randomUUID();
  r = await up(A, `${A.id}/${photoId}.jpg`);
  check(r.ok, `A envia foto para a PRÓPRIA pasta (HTTP ${r.status})`);
  r = await up(B, `${A.id}/${randomUUID()}.jpg`);
  check(!r.ok, `B NÃO envia foto para a pasta de A (HTTP ${r.status})`);
  r = await fetch(`${STORAGE}/object/authenticated/fotos/${A.id}/${photoId}.jpg`, { headers: { apikey: APIKEY, authorization: `Bearer ${B.token}` } });
  check(r.ok, `B LÊ a foto de A (rede toda) (HTTP ${r.status})`);
  r = await fetch(`${STORAGE}/object/public/fotos/${A.id}/${photoId}.jpg`);
  check(!r.ok, `o bucket é privado: o link público não funciona (HTTP ${r.status})`);
  r = await fetch(`${STORAGE}/object/fotos/${A.id}/${photoId}.jpg`, { method: 'DELETE', headers: { apikey: APIKEY, authorization: `Bearer ${A.token}` } });
  r = await fetch(`${STORAGE}/object/authenticated/fotos/${A.id}/${photoId}.jpg`, { headers: { apikey: APIKEY, authorization: `Bearer ${A.token}` } });
  check(r.ok, 'ninguém apaga foto: o arquivo continua lá depois do DELETE');
} else {
  console.log('(sem SUPABASE_URL: etapa do Storage pulada)');
}

// ---- limpeza: exclusão lógica ----
await call(A, 'PATCH', `/elements?id=eq.${elId}`, { deleted: true, updated_at: iso(1000) }, { prefer: 'return=minimal' });
await call(A, 'PATCH', `/activities?id=eq.${actId}`, { deleted: true, status: 'concluida', updated_at: iso(1000) }, { prefer: 'return=minimal' });

console.log(failures === 0 ? '\nTUDO OK: as regras de acesso valem direto na API.' : `\n${failures} FALHA(S): NÃO publique antes de entender por quê.`);
process.exit(failures === 0 ? 0 : 1);
