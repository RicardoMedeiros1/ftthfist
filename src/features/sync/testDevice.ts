import { RotaFibraDB, newBase } from '../../db/db';
import type { TrackPoint } from '../../db/types';
import { setActingRole, setActingUser } from '../../lib/ownership';
import { activityRepo } from '../activities/activityRepo';
import { cableRepo } from '../cables/cableRepo';
import { elementRepo } from '../elements/elementRepo';
import { createSyncEngine, type CycleReport, type Role, type SyncEngine, type Tuning } from './engine';
import type { RemoteApi } from './remote';

// Um "aparelho" para testes: banco local proprio + motor ligado a um servidor (falso ou de verdade),
// agindo como uma pessoa. Usado pelos testes do motor e pelo teste contra o Postgres/PostgREST reais.

export class Device {
  db = new RotaFibraDB(`sync-${crypto.randomUUID()}`);
  engine: SyncEngine;
  acts = activityRepo(this.db);
  els = elementRepo(this.db);
  cables = cableRepo(this.db);

  constructor(
    readonly remote: RemoteApi,
    readonly userId: string,
    readonly role: Role = 'tecnico',
    tuning: Partial<Tuning> = {},
  ) {
    this.engine = createSyncEngine({ db: this.db, remote, now: Date.now }, tuning);
  }
  async open() {
    await this.db.open();
    return this;
  }
  get who() {
    return { userId: this.userId, role: this.role };
  }
  /** Executa como esta pessoa (o dono dos novos registros vem de quem esta agindo). */
  as<T>(fn: () => Promise<T>): Promise<T> {
    setActingUser(this.userId);
    setActingRole(this.role);
    return fn();
  }
  sync(): Promise<CycleReport> {
    return this.engine.runCycle(this.who);
  }
  counts() {
    return this.engine.counts(this.who);
  }
}

export const pole = (n = 0) =>
  ({ type: 'poste', lat: -23.55 - n * 0.0003, lng: -46.63 - n * 0.0003, accuracy: 4, positionSource: 'gps' }) as const;

/** Atividade aberta + 2 postes + 1 cabo + 3 pontos de trilha, tudo feito offline. */
export async function fieldWork(d: Device, name = d.userId) {
  return d.as(async () => {
    const act = await d.acts.create({ kind: 'implantacao', title: `Rua de ${name}` }, name);
    const p1 = await d.els.create(pole(0), name);
    const p2 = await d.els.create(pole(1), name);
    const cable = await d.cables.create(
      { cableType: 'AS-80', fiberCount: 12, vertices: [{ elementId: p1.id, lat: p1.lat, lng: p1.lng }, { elementId: p2.id, lat: p2.lat, lng: p2.lng }] },
      name,
    );
    const track: TrackPoint[] = [];
    for (let i = 0; i < 3; i++) {
      const t: TrackPoint = { ...newBase(name), activityId: act.id, lat: -23.55 - i * 0.0001, lng: -46.63, accuracy: 6, timestamp: Date.now() + i, segment: 0 };
      await d.db.trackPoints.add(t);
      track.push(t);
    }
    return { act, p1, p2, cable, track };
  });
}
