import 'fake-indexeddb/auto';
import { liveQuery } from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { setActingUser } from '../../lib/ownership';
import { Device, fieldWork, pole } from './testDevice';
import { TestServer } from './testServer';

// O indicador "N pend." depende do liveQuery do Dexie enxergar as tabelas lidas por engine.counts / blockedList.
// (Uma funcao async nativa no meio da cadeia faz o Dexie perder o rastro: a contagem ficava parada em 0.)

afterEach(() => setActingUser(null));
const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const server = new TestServer();
  server.addUser('ana');
  const d = await new Device(server.client('ana'), 'ana').open();
  const seen: Array<{ pending: number; blocked: number }> = [];
  const sub = liveQuery(() => d.engine.counts(d.who)).subscribe({ next: (c) => seen.push(c) });
  await pause(50);
  return { server, d, seen, last: () => seen.at(-1)!, stop: () => sub.unsubscribe() };
}

it('a contagem reage a gravações locais', async () => {
  const { d, seen, last, stop } = await setup();
  expect(seen[0]).toEqual({ pending: 0, blocked: 0 });
  await fieldWork(d, 'Ana');
  await pause();
  expect(last()).toEqual({ pending: 7, blocked: 0 });
  stop();
});

it('a contagem cai para zero quando o envio termina', async () => {
  const { d, last, stop } = await setup();
  await fieldWork(d, 'Ana');
  await d.sync();
  await pause();
  expect(last()).toEqual({ pending: 0, blocked: 0 });
  stop();
});

it('um registro recusado passa de "pendente" para "recusado" na contagem', async () => {
  const { d, last, stop } = await setup();
  await fieldWork(d, 'Ana');
  const bad = await d.as(() => d.els.create(pole(9), 'Ana'));
  await d.db.elements.update(bad.id, { lat: 999 });
  await d.sync();
  await pause();
  expect(last()).toEqual({ pending: 0, blocked: 1 });
  await d.engine.clearBlocked();
  await pause();
  expect(last()).toEqual({ pending: 1, blocked: 0 });
  stop();
});

it('a lista de recusados (tela de sincronização) também atualiza sozinha', async () => {
  const { d, stop } = await setup();
  stop();
  const lists: number[] = [];
  const sub = liveQuery(() => d.engine.blockedList(d.who)).subscribe({ next: (l) => lists.push(l.length) });
  await pause(50);
  await fieldWork(d, 'Ana');
  const bad = await d.as(() => d.els.create(pole(9), 'Ana'));
  await d.db.elements.update(bad.id, { lat: 999 });
  await d.sync();
  await pause();
  expect(lists.at(-1)).toBe(1);
  await d.engine.clearBlocked();
  await pause();
  expect(lists.at(-1)).toBe(0);
  sub.unsubscribe();
});
