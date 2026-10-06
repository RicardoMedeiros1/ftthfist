import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import type { Cable, TrackPoint } from '../../db/types';
import { activityRepo } from '../activities/activityRepo';
import { elementRepo } from '../elements/elementRepo';
import {
  BACKUP_VERSION,
  BackupError,
  applyBackup,
  backupFileName,
  buildBackup,
  dataSummary,
  describeCounts,
  parseBackup,
  summarizeBackup,
  type BackupFile,
  type ParsedBackup,
} from './backup';

let src: RotaFibraDB;
let dst: RotaFibraDB;
const fresh = async () => {
  const d = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await d.open();
  return d;
};
beforeEach(async () => {
  src = await fresh();
  dst = await fresh();
});

const bytes = async (b: Blob) => Array.from(new Uint8Array(await b.arrayBuffer()));
const jpeg = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
const gps = { type: 'poste', lat: -23.55, lng: -46.63, accuracy: 8, positionSource: 'gps' } as const;

/** Atividade concluída + uma aberta, 2 elementos (1 com 2 fotos), 1 cabo, trilha e configurações. */
async function seed(db: RotaFibraDB) {
  const acts = activityRepo(db);
  const els = elementRepo(db);
  const a1 = await acts.create({ kind: 'implantacao', title: 'Rua A', osNumber: '10' }, 'Carlos');
  const e1 = await els.create({ ...gps, code: 'P-1', attrs: { owner: 'proprio' } }, 'Carlos', [
    { blob: jpeg(1, 2, 3), takenAt: 111 },
    { blob: jpeg(250, 251, 252, 253), takenAt: 222 },
  ]);
  const e2 = await els.create({ type: 'cto', lat: -23.551, lng: -46.631, positionSource: 'manual', attrs: { capacity: 16 } }, 'Carlos');
  await acts.complete(a1.id);
  const a2 = await acts.create({ kind: 'manutencao', title: 'Poste caído' }, 'Carlos');
  const cable: Cable = {
    id: crypto.randomUUID(), createdAt: 5, updatedAt: 5, createdBy: 'Carlos', deleted: false, syncStatus: 'pending',
    cableType: 'AS-80', fiberCount: 12, vertices: [{ elementId: e1.id, lat: e1.lat, lng: e1.lng }, { elementId: e2.id, lat: e2.lat, lng: e2.lng }],
    lengthMeters: 100, reserveMeters: 10, totalMeters: 110, activityId: a1.id, notes: '',
  };
  await db.cables.add(cable);
  const tp: TrackPoint = { id: crypto.randomUUID(), createdAt: 6, updatedAt: 6, createdBy: 'Carlos', deleted: false, syncStatus: 'pending', activityId: a2.id, lat: -23.5, lng: -46.6, accuracy: 9, timestamp: 1000 };
  await db.trackPoints.add(tp);
  await db.settings.bulkPut([
    { key: 'technician', value: 'Carlos' },
    { key: 'baseLayer', value: 'satelite' },
    { key: 'lastBackupAt', value: 123 },
    { key: 'mapView', value: { lat: 1, lng: 2, zoom: 3 } },
    { key: 'trackState', value: { status: 'gravando' } },
    { key: 'cableDraft', value: { cableId: 'x' } },
  ]);
  return { a1, a2, e1, e2, cable, tp };
}

const roundtrip = async (db: RotaFibraDB): Promise<ParsedBackup> => {
  const { blob } = await buildBackup(db, { appVersion: 'abc1234', now: 777 });
  return parseBackup(await blob.arrayBuffer());
};

describe('exportar', () => {
  it('gera um .zip com backup.json e uma foto por arquivo, sem as configurações do aparelho', async () => {
    await seed(src);
    const { blob } = await buildBackup(src, { appVersion: 'abc1234', now: 777 });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names).toContain('backup.json');
    expect(names.filter((n) => n.startsWith('photos/') && !n.endsWith('/'))).toHaveLength(2);
    const data = JSON.parse(await zip.file('backup.json')!.async('string')) as BackupFile;
    expect(data).toMatchObject({ format: 'rotafibra-backup', version: BACKUP_VERSION, createdAt: 777, appVersion: 'abc1234' });
    expect(data.tables.settings.map((s) => s.key).sort()).toEqual(['baseLayer', 'technician']);
    expect(data.tables.photos.every((p) => !('blob' in p))).toBe(true);
  });

  it('banco vazio gera um backup válido', async () => {
    const parsed = await roundtrip(src);
    expect(summarizeBackup(parsed)).toEqual({ activities: 0, elements: 0, cables: 0, photos: 0, trackPoints: 0 });
  });
});

describe('restaurar: ida e volta', () => {
  it('em outro aparelho (substituir) tudo volta idêntico, inclusive o conteúdo das fotos', async () => {
    const s = await seed(src);
    const parsed = await roundtrip(src);
    const r = await applyBackup(dst, parsed, 'replace');

    expect(r.counts.activities).toEqual({ added: 2, updated: 0, skipped: 0 });
    expect(r.counts.elements.added).toBe(2);
    expect(r.counts.photos.added).toBe(2);
    expect(r.concludedOpenActivities).toBe(0);

    for (const table of ['activities', 'elements', 'cables', 'trackPoints'] as const) {
      const a = await src[table].orderBy('id').toArray();
      const b = await dst[table].orderBy('id').toArray();
      expect(b).toEqual(a);
    }
    const sp = await src.photos.orderBy('id').toArray();
    const dp = await dst.photos.orderBy('id').toArray();
    expect(dp).toHaveLength(2);
    for (let i = 0; i < sp.length; i++) {
      const { blob: b1, ...m1 } = sp[i]!;
      const { blob: b2, ...m2 } = dp[i]!;
      expect(m2).toEqual(m1);
      expect(b2.type).toBe('image/jpeg');
      expect(await bytes(b2)).toEqual(await bytes(b1));
    }
    expect((await dst.settings.get('technician'))?.value).toBe('Carlos');
    expect((await dst.activities.get(s.a2.id))?.status).toBe('aberta');
  });

  it('substituir apaga o que havia antes, mas preserva as configurações do aparelho', async () => {
    await seed(src);
    const parsed = await roundtrip(src);
    const old = activityRepo(dst);
    await old.create({ kind: 'implantacao', title: 'Atividade antiga' }, 'Maria');
    await dst.settings.bulkPut([{ key: 'lastBackupAt', value: 999 }, { key: 'technician', value: 'Maria' }]);
    await applyBackup(dst, parsed, 'replace');
    expect((await dst.activities.toArray()).map((a) => a.title).sort()).toEqual(['Poste caído', 'Rua A']);
    expect((await dst.settings.get('lastBackupAt'))?.value).toBe(999);
    expect((await dst.settings.get('technician'))?.value).toBe('Carlos');
  });

  it('o registro excluído logicamente também viaja no backup', async () => {
    const s = await seed(src);
    await elementRepo(src).remove(s.e2.id);
    const parsed = await roundtrip(src);
    await applyBackup(dst, parsed, 'replace');
    expect((await dst.elements.get(s.e2.id))?.deleted).toBe(true);
    expect(summarizeBackup(parsed).elements).toBe(1);
  });
});

describe('restaurar: mesclar', () => {
  it('novo entra; o mais recente vence; o local mais novo é mantido', async () => {
    const s = await seed(src);
    const parsed = await roundtrip(src);
    // dst já tem a mesma atividade/elemento, em versões diferentes
    await dst.activities.add({ ...s.a1, title: 'Local mais NOVO', updatedAt: s.a1.updatedAt + 1_000_000 });
    await dst.elements.add({ ...s.e1, code: 'local antigo', updatedAt: s.e1.updatedAt - 1_000_000 });
    const r = await applyBackup(dst, parsed, 'merge');

    expect((await dst.activities.get(s.a1.id))?.title).toBe('Local mais NOVO');
    expect((await dst.elements.get(s.e1.id))?.code).toBe('P-1');
    expect(r.counts.activities).toEqual({ added: 1, updated: 0, skipped: 1 });
    expect(r.counts.elements).toEqual({ added: 1, updated: 1, skipped: 0 });
    expect(await dst.photos.count()).toBe(2);
  });

  it('restaurar duas vezes não duplica nada', async () => {
    await seed(src);
    const parsed = await roundtrip(src);
    await applyBackup(dst, parsed, 'merge');
    const again = await applyBackup(dst, parsed, 'merge');
    expect(await dst.elements.count()).toBe(2);
    expect(await dst.photos.count()).toBe(2);
    expect(again.counts.elements).toEqual({ added: 0, updated: 0, skipped: 2 });
  });

  it('não troca as configurações já existentes (ex.: nome do técnico), só preenche o que falta', async () => {
    await seed(src);
    const parsed = await roundtrip(src);
    await dst.settings.put({ key: 'technician', value: 'Maria' });
    await applyBackup(dst, parsed, 'merge');
    expect((await dst.settings.get('technician'))?.value).toBe('Maria');
    expect((await dst.settings.get('baseLayer'))?.value).toBe('satelite');
  });
});

describe('restaurar: só uma atividade aberta', () => {
  it('se este aparelho já tem uma aberta, a do backup é concluída', async () => {
    const s = await seed(src); // a2 aberta no backup
    const parsed = await roundtrip(src);
    const local = await activityRepo(dst).create({ kind: 'implantacao', title: 'Local aberta' }, 'Maria');
    const r = await applyBackup(dst, parsed, 'merge', 5_000_000);

    expect(r.concludedOpenActivities).toBe(1);
    const open = (await dst.activities.toArray()).filter((a) => a.status === 'aberta');
    expect(open.map((a) => a.id)).toEqual([local.id]);
    const closed = await dst.activities.get(s.a2.id);
    expect(closed).toMatchObject({ status: 'concluida', syncStatus: 'pending', updatedAt: 5_000_000 });
    expect(closed?.endedAt).toBeTypeOf('number');
  });

  it('a mesma atividade aberta dos dois lados continua aberta', async () => {
    const s = await seed(src);
    const parsed = await roundtrip(src);
    await dst.activities.add({ ...s.a2, updatedAt: s.a2.updatedAt - 10 });
    const r = await applyBackup(dst, parsed, 'merge');
    expect(r.concludedOpenActivities).toBe(0);
    expect((await dst.activities.get(s.a2.id))?.status).toBe('aberta');
  });

  it('backup com duas abertas (corrompido): mantém só a mais recente', async () => {
    const s = await seed(src);
    const extra = { ...s.a1, id: crypto.randomUUID(), status: 'aberta' as const, endedAt: undefined, updatedAt: s.a2.updatedAt - 500 };
    await src.activities.add(extra);
    const parsed = await roundtrip(src);
    const r = await applyBackup(dst, parsed, 'replace');
    expect(r.concludedOpenActivities).toBe(1);
    const open = (await dst.activities.toArray()).filter((a) => a.status === 'aberta');
    expect(open.map((a) => a.id)).toEqual([s.a2.id]);
  });
});

describe('arquivos inválidos', () => {
  const zipWith = async (files: Record<string, string>) => {
    const z = new JSZip();
    for (const [k, v] of Object.entries(files)) z.file(k, v);
    return z.generateAsync({ type: 'arraybuffer' });
  };
  const good = async () => {
    await seed(src);
    const { blob } = await buildBackup(src);
    return JSON.parse(await (await JSZip.loadAsync(await blob.arrayBuffer())).file('backup.json')!.async('string')) as BackupFile;
  };
  const fails = async (input: ArrayBuffer | Uint8Array, expected: RegExp) => {
    const err = await parseBackup(input).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).message).toMatch(expected);
  };

  it('não é um zip', async () => fails(new TextEncoder().encode('isto não é um zip'), /não é um \.zip válido/));
  it('zip sem backup.json', async () => fails(await zipWith({ 'x.txt': 'oi' }), /falta o arquivo de dados/));
  it('JSON ilegível', async () => fails(await zipWith({ 'backup.json': '{nao é json' }), /ilegíveis/));
  it('zip qualquer com JSON de outro formato', async () => fails(await zipWith({ 'backup.json': '{"a":1}' }), /não é um backup do RotaFibra/));

  it('versão mais nova que a do app pede para atualizar', async () => {
    const d = await good();
    await fails(await zipWith({ 'backup.json': JSON.stringify({ ...d, version: BACKUP_VERSION + 1 }) }), /versão mais nova/);
  });

  it('registro inválido é recusado com a tabela e o número do registro', async () => {
    const d = await good();
    d.tables.elements[1]!.lat = 999;
    await fails(await zipWith({ 'backup.json': JSON.stringify(d) }), /elementos \(registro 2\)/);
  });

  it('tipo de elemento herdado do protótipo ("toString") é recusado', async () => {
    const d = await good();
    (d.tables.elements[0] as unknown as { type: string }).type = 'toString';
    await fails(await zipWith({ 'backup.json': JSON.stringify(d) }), /elementos/);
  });

  it('id repetido na mesma tabela é recusado', async () => {
    const d = await good();
    d.tables.elements[1]!.id = d.tables.elements[0]!.id;
    await fails(await zipWith({ 'backup.json': JSON.stringify(d) }), /repetido em elementos/);
  });

  it('caminho de foto suspeito é recusado', async () => {
    const d = await good();
    d.tables.photos[0]!.file = '../../etc/passwd';
    await fails(await zipWith({ 'backup.json': JSON.stringify(d) }), /fotos \(registro 1\)/);
  });

  it('foto citada mas ausente do zip: o resto é restaurado e a falha é contada', async () => {
    const d = await good();
    const files: Record<string, string> = { 'backup.json': JSON.stringify(d) };
    const parsed = await parseBackup(await zipWith(files));
    expect(parsed.missingPhotos).toBe(2);
    const r = await applyBackup(dst, parsed, 'replace');
    expect(r.skippedPhotos).toBe(2);
    expect(await dst.photos.count()).toBe(0);
    expect(await dst.elements.count()).toBe(2);
  });
});

describe('falha no meio da restauração', () => {
  it('é tudo ou nada: os dados que já existiam continuam intactos', async () => {
    await seed(src);
    const parsed = await roundtrip(src);
    const keep = await activityRepo(dst).create({ kind: 'implantacao', title: 'Não pode sumir' }, 'Maria');
    await elementRepo(dst).create(gps, 'Maria', [{ blob: jpeg(9, 9) }]);
    // Registro com id que o IndexedDB não aceita como chave: derruba a gravação depois do "limpar tudo".
    (parsed.file.tables.cables[0] as unknown as { id: unknown }).id = { quebrado: true };

    await expect(applyBackup(dst, parsed, 'replace')).rejects.toBeDefined();

    expect((await dst.activities.toArray()).map((a) => a.id)).toEqual([keep.id]);
    expect(await dst.elements.count()).toBe(1);
    expect(await dst.photos.count()).toBe(1);
  });
});

describe('resumos', () => {
  it('dataSummary conta só os não excluídos, soma o tamanho das fotos e acha o dado mais antigo', async () => {
    const s = await seed(src);
    await elementRepo(src).remove(s.e2.id);
    const sum = await dataSummary(src);
    expect(sum).toMatchObject({ activities: 2, elements: 1, cables: 1, photos: 2, trackPoints: 1, photoBytes: 7 });
    expect(sum.firstDataAt).toBe(5); // o cabo de teste, criado em t=5
  });

  it('describeCounts: singular/plural e omite zeros', () => {
    expect(describeCounts({ activities: 1, elements: 12, cables: 0, photos: 1, trackPoints: 340 })).toBe(
      '1 atividade · 12 elementos · 1 foto · 340 pontos de trilha',
    );
    expect(describeCounts({ activities: 0, elements: 0, cables: 0, photos: 0, trackPoints: 0 })).toBe('sem dados');
  });

  it('nome do arquivo com data e hora', () => {
    expect(backupFileName(new Date(2026, 9, 5, 8, 7))).toBe('rotafibra-backup-2026-10-05-0807.zip');
  });
});
