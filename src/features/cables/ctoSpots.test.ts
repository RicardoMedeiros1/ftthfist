import { afterEach, describe, expect, it } from 'vitest';
import type { NetworkElement } from '../../db/types';
import { setActingUser } from '../../lib/ownership';
import type { CableDraft, DraftCable } from './cableDraft';
import { ctoSpots } from './ctoSpots';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const el = (id: string, type: NetworkElement['type'], extra: Partial<NetworkElement> = {}): NetworkElement =>
  ({ id, type, lat: 0, lng: 0, code: '', notes: '', attrs: {}, deleted: false, ownerId: undefined, ...extra }) as NetworkElement;
const v = (elementId?: string) => ({ ...(elementId ? { elementId } : {}), lat: 0, lng: 0 });
const cable = (cableId: string, ids: (string | undefined)[], parentId?: string): DraftCable => ({
  cableId,
  cableType: 'drop',
  fiberCount: 12,
  vertices: ids.map(v),
  ...(parentId ? { parentId } : {}),
});
const draft = (...cables: DraftCable[]): CableDraft => ({ cables, actions: [], startedAt: 0 });
const map = (...els: NetworkElement[]) => new Map(els.map((e) => [e.id, e] as const));

afterEach(() => setActingUser(null));

describe('CTOs para dizer a fibra, ao finalizar', () => {
  it('a CTO onde o cabo termina e a que ele só atravessa entram, na ordem do lançamento', () => {
    const d = draft(cable('t', ['p1', 'c1', 'p2', 'c2']));
    const spots = ctoSpots(d, map(el('p1', 'poste'), el('c1', 'cto'), el('p2', 'poste'), el('c2', 'cto')));
    expect(spots.map((s) => [s.element.id, s.cable.cableId, s.end])).toEqual([
      ['c1', 't', false],
      ['c2', 't', true],
    ]);
  });

  it('o ponto onde o ramal começa é do cabo de onde ele saiu: derivar numa CTO não a entrega ao ramal', () => {
    // tronco passa pela CTO c1 (e deriva dela); o ramal termina na CTO c2
    const d = draft(cable('t', ['p1', 'c1', 'p2']), cable('r', ['c1', 'p3', 'c2'], 't'));
    const spots = ctoSpots(d, map(el('c1', 'cto'), el('c2', 'cto')));
    expect(spots.map((s) => [s.element.id, s.cable.cableId, s.end])).toEqual([
      ['c1', 't', false],
      ['c2', 'r', true],
    ]);
  });

  it('se o ramal não vira cabo (sem pontos), a CTO da derivação volta a valer para o cabo que sobra', () => {
    const d = draft(cable('t', ['p1', 'c1']), cable('r', ['c1'], 't'));
    expect(ctoSpots(d, map(el('c1', 'cto'))).map((s) => [s.cable.cableId, s.end])).toEqual([['t', true]]);
  });

  it('se o tronco não é salvo, o ramal que começa numa CTO fica com ela', () => {
    const d = draft(cable('t', ['c1']), cable('r', ['c1', 'p2'], 't'));
    expect(ctoSpots(d, map(el('c1', 'cto'))).map((s) => [s.cable.cableId, s.end])).toEqual([['r', false]]);
  });

  it('CTO que um cabo termina e outro só atravessa: fica com o que termina', () => {
    const d = draft(cable('t', ['p1', 'c1', 'p2']), cable('r', ['p2', 'c1'], 't'));
    const spots = ctoSpots(d, map(el('c1', 'cto')));
    expect(spots).toHaveLength(1);
    expect([spots[0]!.cable.cableId, spots[0]!.end]).toEqual(['r', true]);
  });

  it('ignora o que não é CTO, ponto solto, elemento que sumiu ou excluído', () => {
    const d = draft(cable('t', [undefined, 'e1', 'x', 'c9', 'c1']));
    const spots = ctoSpots(d, map(el('e1', 'ceo'), el('c9', 'cto', { deleted: true }), el('c1', 'cto')));
    expect(spots.map((s) => s.element.id)).toEqual(['c1']);
  });

  it('CTO que já tem fibra de entrada não é perguntada de novo', () => {
    const feed = { feedCableId: UUID(1), feedFiber: 3 };
    const d = draft(cable('t', ['p1', 'c1', 'c2']));
    expect(ctoSpots(d, map(el('c1', 'cto', { attrs: feed }), el('c2', 'cto', { attrs: { capacity: 8 } }))).map((s) => s.element.id)).toEqual(['c2']);
  });

  it('CTO de outra pessoa não entra (eu não posso alterá-la)', () => {
    setActingUser('eu');
    const d = draft(cable('t', ['p1', 'c1', 'c2']));
    const spots = ctoSpots(d, map(el('c1', 'cto', { ownerId: 'outra' }), el('c2', 'cto', { ownerId: 'eu' })));
    expect(spots.map((s) => s.element.id)).toEqual(['c2']);
  });

  it('cabo com menos de 2 pontos não será salvo e não conta', () => {
    const d = draft(cable('t', ['c1']));
    expect(ctoSpots(d, map(el('c1', 'cto')))).toEqual([]);
  });
});
