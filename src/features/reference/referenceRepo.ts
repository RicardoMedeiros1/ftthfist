import { db, newBase, touch, type RotaFibraDB } from '../../db/db';
import type { ElementType, NetworkElement, ReferenceFeature, ReferenceLayer } from '../../db/types';
import { elementRepo } from '../elements/elementRepo';
import type { ParsedLayer } from './kmlImport';

// Cores das camadas importadas: distintas entre si e do que o app desenha (cabos, trilha, elementos).
export const LAYER_COLORS = ['#ff4081', '#c6ff00', '#b388ff', '#ff9100', '#1de9b6', '#ff8a80'] as const;

export type ReferenceRuleCode = 'NOT_FOUND' | 'NO_POINTS';

export class ReferenceRuleError extends Error {
  constructor(
    readonly code: ReferenceRuleCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReferenceRuleError';
  }
}

export const featureId = (layerId: string, n: number) => `${layerId}:${n}`;

/** "layer:12" → { layerId, n }. O id do KML é um UUID; só o último ":" separa o número. */
export function parseFeatureId(id: string): { layerId: string; n: number } | null {
  const i = id.lastIndexOf(':');
  if (i <= 0) return null;
  const n = Number(id.slice(i + 1));
  return Number.isInteger(n) && n >= 0 ? { layerId: id.slice(0, i), n } : null;
}

const CHUNK = 2000;

export interface ConvertOptions {
  /** Só para um ponto: o técnico pode ajustar o código e as observações antes de criar. */
  override?: { code: string; notes: string };
}

export function referenceRepo(database: RotaFibraDB = db) {
  return {
    /** Camadas não excluídas, da mais antiga para a mais nova. */
    async list(): Promise<ReferenceLayer[]> {
      return (await database.referenceLayers.toArray()).filter((l) => !l.deleted).sort((a, b) => a.createdAt - b.createdAt);
    },

    async get(id: string): Promise<ReferenceLayer | undefined> {
      const l = await database.referenceLayers.get(id);
      return l && !l.deleted ? l : undefined;
    },

    /** Grava a camada e todos os seus elementos (tudo ou nada). */
    async importLayer(parsed: ParsedLayer, meta: { name: string; fileName: string }, createdBy: string, now = Date.now()): Promise<ReferenceLayer> {
      return database.transaction('rw', database.referenceLayers, database.referenceFeatures, async () => {
        const used = (await database.referenceLayers.toArray()).filter((l) => !l.deleted).length;
        const layer: ReferenceLayer = {
          ...newBase(createdBy, now),
          name: meta.name.trim() || parsed.name,
          fileName: meta.fileName,
          color: LAYER_COLORS[used % LAYER_COLORS.length]!,
          visible: true,
          counts: parsed.counts,
          skipped: parsed.skipped,
          bounds: parsed.bounds,
          converted: [],
        };
        await database.referenceLayers.add(layer);
        const rows: ReferenceFeature[] = parsed.features.map((f, n) => ({ id: featureId(layer.id, n), layerId: layer.id, n, ...f }));
        for (let i = 0; i < rows.length; i += CHUNK) await database.referenceFeatures.bulkAdd(rows.slice(i, i + CHUNK));
        return layer;
      });
    },

    async setVisible(id: string, visible: boolean): Promise<void> {
      await database.referenceLayers.update(id, touch<ReferenceLayer>({ visible }));
    },

    /** Liga ou desliga todas as camadas de uma vez (botão "Referência" do mapa). */
    async setAllVisible(visible: boolean): Promise<void> {
      await database.transaction('rw', database.referenceLayers, async () => {
        for (const l of await database.referenceLayers.toArray()) {
          if (!l.deleted && l.visible !== visible) await database.referenceLayers.update(l.id, touch<ReferenceLayer>({ visible }));
        }
      });
    },

    async rename(id: string, name: string): Promise<void> {
      const clean = name.trim();
      if (clean) await database.referenceLayers.update(id, touch<ReferenceLayer>({ name: clean.slice(0, 100) }));
    },

    /**
     * Exclusão lógica da camada (deleted = true); o conteúdo importado, que se recupera
     * importando o arquivo de novo, é apagado de verdade para liberar espaço.
     */
    async remove(id: string): Promise<void> {
      await database.transaction('rw', database.referenceLayers, database.referenceFeatures, async () => {
        await database.referenceLayers.update(id, touch<ReferenceLayer>({ deleted: true, visible: false }));
        await database.referenceFeatures.where('layerId').equals(id).delete();
      });
    },

    async features(layerId: string): Promise<ReferenceFeature[]> {
      return database.referenceFeatures.where('layerId').equals(layerId).toArray();
    },

    async getFeature(id: string): Promise<ReferenceFeature | undefined> {
      return database.referenceFeatures.get(id);
    },

    /**
     * Cria elementos a partir de pontos da camada, na atividade aberta (tudo ou nada: se algo falhar,
     * por exemplo não haver atividade aberta, nenhum elemento é criado). A posição vem do arquivo,
     * não do GPS do aparelho, então fica como "manual" e sem precisão.
     */
    async convertPoints(layerId: string, ns: number[], type: ElementType, technician: string, opts: ConvertOptions = {}): Promise<NetworkElement[]> {
      return database.transaction(
        'rw',
        [database.activities, database.elements, database.photos, database.cables, database.referenceLayers, database.referenceFeatures],
        async () => {
          const layer = await database.referenceLayers.get(layerId);
          if (!layer || layer.deleted) throw new ReferenceRuleError('NOT_FOUND', 'Esta camada não existe mais.');
          const found = await database.referenceFeatures.bulkGet([...new Set(ns)].map((n) => featureId(layerId, n)));
          const points = found.filter((f): f is ReferenceFeature => !!f && f.geom.kind === 'point');
          if (points.length === 0) throw new ReferenceRuleError('NO_POINTS', 'Nenhum ponto selecionado.');

          const els = elementRepo(database);
          const created: NetworkElement[] = [];
          for (const f of points) {
            if (f.geom.kind !== 'point') continue;
            const [lng, lat] = f.geom.coord;
            const notes = [`Origem: camada ${layer.name}`, f.description].filter(Boolean).join('\n').slice(0, 1000);
            created.push(
              await els.create(
                {
                  type,
                  lat,
                  lng,
                  positionSource: 'manual',
                  code: opts.override ? opts.override.code : f.name.slice(0, 80),
                  notes: opts.override ? opts.override.notes : notes,
                },
                technician,
              ),
            );
          }
          const converted = [...new Set([...layer.converted, ...points.map((p) => p.n)])].sort((a, b) => a - b);
          await database.referenceLayers.update(layerId, touch<ReferenceLayer>({ converted }));
          return created;
        },
      );
    },
  };
}

export const references = referenceRepo();
