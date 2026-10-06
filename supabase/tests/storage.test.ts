import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, ID, IDS, createTestDb, type TestDb } from './support/harness';

const FOTO = '11111111-1111-4111-8111-111111111111';
const FOTO2 = '22222222-2222-4222-8222-222222222222';
const path = (owner: keyof typeof IDS, id = FOTO2, ext = 'jpg') => `${IDS[owner]}/${id}.${ext}`;
const put = (name: string, bucket = 'fotos'): [string, unknown[]] => [`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]];

describe.skipIf(!DB_URL)('fotos: bucket privado e políticas do Storage', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await db.admin(`insert into storage.buckets (id, name) values ('outro', 'outro')`);
    await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('fotos', $1, $2)`, [path('ana', FOTO), IDS.ana]);
  });
  afterAll(async () => { await db?.drop(); });

  it('o bucket é privado, aceita só JPEG e tem tamanho máximo', async () => {
    const [b] = await db.admin<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'fotos'`);
    expect(b).toEqual({ public: false, file_size_limit: '3145728', allowed_mime_types: ['image/jpeg'] });
  });

  it('o técnico envia para a PRÓPRIA pasta, com o nome <uuid>/<uuid>.jpg', async () => {
    await db.run('ana', async (tx) => {
      expect(await tx.count(...put(path('ana')))).toBe(1);
    });
  });

  it('não envia para a pasta de outro, na raiz, em outro bucket, nem com nome fora do padrão', async () => {
    await db.run('ana', async (tx) => {
      await tx.denied(...put(path('bruno')));
      await tx.denied(...put(`${FOTO2}.jpg`));
      await tx.denied(...put(path('ana'), 'outro'));
      await tx.denied(...put(path('ana', FOTO2, 'png')));
      await tx.denied(...put(`${IDS.ana}/foto.jpg`));
      await tx.denied(...put(`${IDS.ana}/../${IDS.bruno}/${FOTO2}.jpg`));
    });
  });

  it('escritório, conta desativada e anônimo não enviam', async () => {
    for (const who of ['clara', 'eva', 'anon'] as const) {
      await db.run(who, async (tx) => {
        await tx.denied(...put(path(who === 'anon' ? 'ana' : who)));
      });
    }
  });

  it('todo perfil ativo lê as fotos da rede; conta desativada e anônimo não leem', async () => {
    const seen: Record<string, number> = {};
    for (const who of ['ana', 'bruno', 'clara', 'davi', 'eva', 'anon'] as const) {
      await db.run(who, async (tx) => { seen[who] = (await tx.q(`select 1 from storage.objects where bucket_id = 'fotos'`)).length; });
    }
    expect(seen).toEqual({ ana: 1, bruno: 1, clara: 1, davi: 1, eva: 0, anon: 0 });
  });

  it('reenvio (nova tentativa) só na própria pasta', async () => {
    await db.run('ana', async (tx) => {
      expect(await tx.count(`update storage.objects set updated_at = now() where name = $1`, [path('ana', FOTO)])).toBe(1);
    });
    await db.run('bruno', async (tx) => {
      expect(await tx.count(`update storage.objects set updated_at = now() where name = $1`, [path('ana', FOTO)])).toBe(0);
    });
  });

  it('ninguém apaga foto (nem o dono, nem o admin): o objeto continua lá', async () => {
    for (const who of ['ana', 'davi'] as const) {
      await db.run(who, async (tx) => {
        expect(await tx.count(`delete from storage.objects where name = $1`, [path('ana', FOTO)])).toBe(0);
        expect(await tx.q(`select 1 from storage.objects where name = $1`, [path('ana', FOTO)])).toHaveLength(1);
      });
    }
  });
});

// (ID usado só para manter o import consistente com os demais arquivos)
void ID;
