import JSZip from 'jszip';
import type { RotaFibraDB } from '../../db/db';
import type { Activity, Cable, NetworkElement, Photo, SettingEntry, TrackPoint } from '../../db/types';
import { plural } from '../../lib/format';
import { isElementType } from '../elements/meta';

// Backup completo do aparelho: um .zip com os dados em JSON e as fotos como arquivos.
//   backup.json          dados de todas as tabelas (inclui excluídos logicamente, que a sincronização precisa)
//   photos/<id>.jpg      conteúdo de cada foto

export const BACKUP_FORMAT = 'rotafibra-backup';
export const BACKUP_VERSION = 1;
const DATA_FILE = 'backup.json';

/** Configurações que pertencem ao aparelho: nunca entram no backup nem são sobrescritas ao restaurar. */
export const DEVICE_SETTINGS = new Set(['lastBackupAt', 'backupDismissedAt', 'mapView', 'cableDraft', 'trackState', 'account', 'accountProfile', 'deviceOwner']);

export type PhotoMeta = Omit<Photo, 'blob'> & { file: string; mime: string };

export interface BackupTables {
  activities: Activity[];
  elements: NetworkElement[];
  cables: Cable[];
  trackPoints: TrackPoint[];
  photos: PhotoMeta[];
  settings: SettingEntry[];
}
export type TableName = keyof BackupTables;
const TABLES: TableName[] = ['activities', 'elements', 'cables', 'trackPoints', 'photos', 'settings'];

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  tables: BackupTables;
}

/** Erro com mensagem pronta (pt-BR) para mostrar ao técnico. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface ParsedBackup {
  file: BackupFile;
  photoBlobs: Map<string, Blob>;
  /** Fotos citadas no JSON cujo arquivo não está no .zip. */
  missingPhotos: number;
}

export interface Count {
  added: number;
  updated: number;
  skipped: number;
}
export interface RestoreResult {
  counts: Record<TableName, Count>;
  /** Atividades abertas do backup que viraram concluídas para manter "só uma aberta por vez". */
  concludedOpenActivities: number;
  skippedPhotos: number;
}

// ---------- exportar ----------

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function buildBackup(
  database: RotaFibraDB,
  opts: { appVersion?: string; now?: number; onProgress?: (percent: number) => void } = {},
): Promise<{ blob: Blob; bytes: number }> {
  // Uma única transação de leitura: o backup é uma fotografia consistente, mesmo se algo mudar durante a geração.
  const t = await database.transaction(
    'r',
    [database.activities, database.elements, database.cables, database.trackPoints, database.photos, database.settings],
    async () => ({
      activities: await database.activities.toArray(),
      elements: await database.elements.toArray(),
      cables: await database.cables.toArray(),
      trackPoints: await database.trackPoints.toArray(),
      photos: await database.photos.toArray(),
      settings: await database.settings.toArray(),
    }),
  );

  const zip = new JSZip();
  const photos: PhotoMeta[] = [];
  for (const p of t.photos) {
    const { blob, ...rest } = p;
    const mime = blob.type || 'image/jpeg';
    const file = `photos/${p.id}.${EXT[mime] ?? 'jpg'}`;
    // JPEG já é comprimido: guardar sem recomprimir poupa tempo e bateria.
    zip.file(file, blob, { compression: 'STORE' });
    photos.push({ ...rest, file, mime });
  }

  const data: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: opts.now ?? Date.now(),
    appVersion: opts.appVersion ?? 'dev',
    tables: {
      activities: t.activities,
      elements: t.elements,
      cables: t.cables,
      trackPoints: t.trackPoints,
      photos,
      settings: t.settings.filter((s) => !DEVICE_SETTINGS.has(s.key)),
    },
  };
  zip.file(DATA_FILE, JSON.stringify(data), { compression: 'DEFLATE' });

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }, (m) =>
    opts.onProgress?.(m.percent),
  );
  return { blob, bytes: blob.size };
}

// ---------- validar e ler ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const oneOf = (list: readonly string[], v: unknown) => isStr(v) && list.includes(v);

function validBase(r: Record<string, unknown>): boolean {
  return (
    isStr(r.id) &&
    r.id !== '' &&
    isNum(r.createdAt) &&
    isNum(r.updatedAt) &&
    isStr(r.createdBy) &&
    typeof r.deleted === 'boolean' &&
    oneOf(['pending', 'synced'], r.syncStatus)
  );
}

const lat = (v: unknown) => isNum(v) && Math.abs(v) <= 90;
const lng = (v: unknown) => isNum(v) && Math.abs(v) <= 180;

const VALIDATORS: Record<TableName, (r: Record<string, unknown>) => boolean> = {
  activities: (r) =>
    validBase(r) &&
    oneOf(['implantacao', 'manutencao'], r.kind) &&
    oneOf(['aberta', 'concluida'], r.status) &&
    isStr(r.title) &&
    isNum(r.startedAt),
  elements: (r) =>
    validBase(r) && isElementType(r.type) && lat(r.lat) && lng(r.lng) && isStr(r.activityId) && isObj(r.attrs),
  cables: (r) =>
    validBase(r) &&
    isStr(r.activityId) &&
    Array.isArray(r.vertices) &&
    r.vertices.every((v) => isObj(v) && lat(v.lat) && lng(v.lng)) &&
    isNum(r.lengthMeters),
  trackPoints: (r) => validBase(r) && isStr(r.activityId) && lat(r.lat) && lng(r.lng) && isNum(r.timestamp),
  photos: (r) =>
    validBase(r) &&
    isStr(r.activityId) &&
    isNum(r.takenAt) &&
    isStr(r.mime) &&
    isStr(r.file) &&
    /^photos\/[\w-]+\.(jpg|png|webp)$/.test(r.file),
  settings: (r) => isStr(r.key) && r.key !== '' && 'value' in r,
};

const TABLE_LABEL: Record<TableName, string> = {
  activities: 'atividades',
  elements: 'elementos',
  cables: 'cabos',
  trackPoints: 'trilha',
  photos: 'fotos',
  settings: 'configurações',
};

function validateFile(raw: unknown): BackupFile {
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupError('Este arquivo não é um backup do RotaFibra.');
  }
  if (!isNum(raw.version) || raw.version < 1) throw new BackupError('Backup com versão inválida.');
  if (raw.version > BACKUP_VERSION) {
    throw new BackupError('Este backup foi feito por uma versão mais nova do app. Atualize o app e tente de novo.');
  }
  if (!isObj(raw.tables)) throw new BackupError('Backup corrompido (faltam os dados).');

  for (const name of TABLES) {
    const rows = raw.tables[name];
    if (!Array.isArray(rows)) throw new BackupError(`Backup corrompido (faltam ${TABLE_LABEL[name]}).`);
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (!isObj(row) || !VALIDATORS[name](row)) {
        throw new BackupError(`Backup com dados inválidos em ${TABLE_LABEL[name]} (registro ${i + 1}).`);
      }
      const key = String(name === 'settings' ? row.key : row.id);
      if (seen.has(key)) throw new BackupError(`Backup com registro repetido em ${TABLE_LABEL[name]}.`);
      seen.add(key);
    });
  }
  return raw as unknown as BackupFile;
}

/** Lê e valida o .zip. Não grava nada. */
export async function parseBackup(
  input: Blob | ArrayBuffer | Uint8Array,
  onProgress?: (percent: number) => void,
): Promise<ParsedBackup> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new BackupError('Este arquivo não é um backup do RotaFibra (não é um .zip válido).');
  }
  const dataEntry = zip.file(DATA_FILE);
  if (!dataEntry) throw new BackupError('Backup incompleto: falta o arquivo de dados.');

  let raw: unknown;
  try {
    raw = JSON.parse(await dataEntry.async('string'));
  } catch {
    throw new BackupError('Backup corrompido (dados ilegíveis).');
  }
  const file = validateFile(raw);

  const photoBlobs = new Map<string, Blob>();
  let missing = 0;
  let done = 0;
  for (const meta of file.tables.photos) {
    const entry = zip.file(meta.file);
    if (entry) photoBlobs.set(meta.id, new Blob([await entry.async('arraybuffer')], { type: meta.mime }));
    else missing++;
    onProgress?.((++done / Math.max(1, file.tables.photos.length)) * 100);
  }
  return { file, photoBlobs, missingPhotos: missing };
}

// ---------- restaurar ----------

type Mergeable<T> = {
  bulkGet(keys: string[]): Promise<(T | undefined)[]>;
  bulkPut(items: T[]): Promise<unknown>;
};

// O `bulkPut` do Dexie tem várias sobrecargas que não casam com este contrato mínimo; a conversão é só de tipo.
const mergeable = <T>(table: unknown) => table as Mergeable<T>;

/** Para cada registro: novo entra; já existente só é trocado se o do backup for mais recente (vence o updatedAt). */
async function mergeInto<T extends { id: string; updatedAt: number }>(table: Mergeable<T>, incoming: T[]): Promise<Count> {
  const existing = await table.bulkGet(incoming.map((r) => r.id));
  const toPut: T[] = [];
  const c: Count = { added: 0, updated: 0, skipped: 0 };
  incoming.forEach((r, i) => {
    const cur = existing[i];
    if (!cur) {
      toPut.push(r);
      c.added++;
    } else if (r.updatedAt > cur.updatedAt) {
      toPut.push(r);
      c.updated++;
    } else c.skipped++;
  });
  await table.bulkPut(toPut);
  return c;
}

export async function applyBackup(
  database: RotaFibraDB,
  parsed: ParsedBackup,
  mode: 'merge' | 'replace',
  now = Date.now(),
): Promise<RestoreResult> {
  const t = parsed.file.tables;
  const photos: Photo[] = t.photos.flatMap((m) => {
    const blob = parsed.photoBlobs.get(m.id);
    if (!blob) return [];
    const { file: _file, mime: _mime, ...rest } = m;
    return [{ ...rest, blob }];
  });
  const incomingSettings = t.settings.filter((s) => !DEVICE_SETTINGS.has(s.key));

  // Todo o conteúdo já está na memória: a transação abaixo não espera nada fora do banco (senão ela fecharia sozinha)
  // e é "tudo ou nada" — se algo falhar no meio, nada do que já existia é alterado.
  return database.transaction(
    'rw',
    [database.activities, database.elements, database.cables, database.trackPoints, database.photos, database.settings],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          database.activities.clear(),
          database.elements.clear(),
          database.cables.clear(),
          database.trackPoints.clear(),
          database.photos.clear(),
        ]);
        const keys = (await database.settings.toCollection().primaryKeys()).filter((k) => !DEVICE_SETTINGS.has(String(k)));
        await database.settings.bulkDelete(keys);
      }

      // "Só uma atividade aberta por vez" também vale depois de restaurar.
      const localOpen =
        mode === 'merge'
          ? await database.activities.where('status').equals('aberta').filter((a) => !a.deleted).first()
          : undefined;
      const activities = t.activities.map((a) => ({ ...a }));
      const open = activities.filter((a) => a.status === 'aberta' && !a.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
      const keep = localOpen ? open.find((a) => a.id === localOpen.id) : open[0];
      let concluded = 0;
      for (const a of open) {
        if (a === keep) continue;
        a.status = 'concluida';
        a.endedAt = a.endedAt ?? a.updatedAt;
        a.updatedAt = now;
        a.syncStatus = 'pending';
        concluded++;
      }

      const counts = {} as Record<TableName, Count>;
      counts.activities = await mergeInto(mergeable<Activity>(database.activities), activities);
      counts.elements = await mergeInto(mergeable<NetworkElement>(database.elements), t.elements);
      counts.cables = await mergeInto(mergeable<Cable>(database.cables), t.cables);
      counts.trackPoints = await mergeInto(mergeable<TrackPoint>(database.trackPoints), t.trackPoints);
      counts.photos = await mergeInto(mergeable<Photo>(database.photos), photos);

      // Configurações: ao mesclar, só preenche o que falta (não troca o nome do técnico deste aparelho).
      const have = await database.settings.bulkGet(incomingSettings.map((s) => s.key));
      const toPut = incomingSettings.filter((_, i) => mode === 'replace' || !have[i]);
      await database.settings.bulkPut(toPut);
      counts.settings = { added: toPut.length, updated: 0, skipped: incomingSettings.length - toPut.length };

      return { counts, concludedOpenActivities: concluded, skippedPhotos: t.photos.length - photos.length };
    },
  );
}

// ---------- resumos para a tela ----------

export interface DataSummary {
  activities: number;
  elements: number;
  cables: number;
  photos: number;
  trackPoints: number;
  photoBytes: number;
  /** Quando o dado mais antigo foi criado (base do lembrete de backup). */
  firstDataAt: number | null;
}

export const hasData = (s: DataSummary) => s.activities + s.elements + s.cables + s.photos + s.trackPoints > 0;

/** O que há neste aparelho (sem os excluídos logicamente). */
export async function dataSummary(database: RotaFibraDB): Promise<DataSummary> {
  const alive = <T extends { deleted: boolean }>(r: T) => !r.deleted;
  let first: number | null = null;
  const track = (r: { createdAt: number }) => {
    if (first === null || r.createdAt < first) first = r.createdAt;
  };
  const count = async <T extends { deleted: boolean; createdAt: number }>(
    table: { filter(fn: (r: T) => boolean): { each(fn: (r: T) => void): Promise<void> } },
    extra?: (r: T) => void,
  ) => {
    let n = 0;
    await table.filter(alive).each((r) => {
      n++;
      track(r);
      extra?.(r);
    });
    return n;
  };
  let photoBytes = 0;
  const [activities, elements, cables, photos, trackPoints] = await Promise.all([
    count(database.activities),
    count(database.elements),
    count(database.cables),
    count(database.photos, (p) => {
      photoBytes += p.blob.size;
    }),
    count(database.trackPoints),
  ]);
  return { activities, elements, cables, photos, trackPoints, photoBytes, firstDataAt: first };
}


/** "3 atividades · 12 elementos · 8 fotos" (só o que não é zero). */
export function describeCounts(c: Pick<DataSummary, 'activities' | 'elements' | 'cables' | 'photos' | 'trackPoints'>): string {
  const parts = [
    c.activities && plural(c.activities, 'atividade', 'atividades'),
    c.elements && plural(c.elements, 'elemento', 'elementos'),
    c.cables && plural(c.cables, 'cabo', 'cabos'),
    c.photos && plural(c.photos, 'foto', 'fotos'),
    c.trackPoints && plural(c.trackPoints, 'ponto de trilha', 'pontos de trilha'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'sem dados';
}

/** Resumo do conteúdo (registros ativos) de um backup lido. */
export function summarizeBackup(parsed: ParsedBackup): Omit<DataSummary, 'photoBytes' | 'firstDataAt'> {
  const t = parsed.file.tables;
  const alive = (rows: { deleted: boolean }[]) => rows.filter((r) => !r.deleted).length;
  return {
    activities: alive(t.activities),
    elements: alive(t.elements),
    cables: alive(t.cables),
    photos: alive(t.photos),
    trackPoints: alive(t.trackPoints),
  };
}

export function backupFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `rotafibra-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}
