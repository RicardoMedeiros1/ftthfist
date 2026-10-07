import { db, newBase, touch, type RotaFibraDB } from '../../db/db';
import type { Activity, ActivityKind, BaseRecord, Material } from '../../db/types';
import { detachElementFromCables, recomputeCable, unlinkReserves } from '../cables/cableLinks';
import { canEdit, isMine, notMineMessage } from '../../lib/ownership';
import { MAX_DESCRIPTION, sanitizeMaterials } from './materials';

export type ActivityRuleCode = 'ALREADY_OPEN' | 'TITLE_REQUIRED' | 'TECHNICIAN_REQUIRED' | 'NOT_FOUND' | 'NOT_OWNER';

/** Erro de regra de negócio, com mensagem pronta para mostrar ao técnico. */
export class ActivityRuleError extends Error {
  constructor(
    readonly code: ActivityRuleCode,
    message: string,
  ) {
    super(message);
    this.name = 'ActivityRuleError';
  }
}

export interface ActivityPatch {
  title?: string;
  /** Vazio remove o numero da OS. */
  osNumber?: string;
  description?: string;
  materials?: Material[];
}

/** O que saiu junto com a atividade (para a mensagem de confirmacao e o aviso depois). */
export interface ActivityRemoval {
  elements: number;
  cables: number;
  photos: number;
  trackPoints: number;
}

export interface NewActivityInput {
  kind: ActivityKind;
  title: string;
  osNumber?: string;
  /** Projeto designado de onde a atividade nasce (botao "Iniciar" do projeto). */
  projectId?: string;
}

export function activityRepo(database: RotaFibraDB = db) {
  const findOpen = () =>
    database.activities
      .where('status')
      .equals('aberta')
      .filter((a) => !a.deleted && isMine(a)) // a atividade aberta de outro técnico não é a minha
      .first();

  const alreadyOpen = (open: Activity) =>
    new ActivityRuleError(
      'ALREADY_OPEN',
      `Já existe uma atividade aberta ("${open.title}"). Conclua antes de abrir outra.`,
    );

  return {
    async getOpen(): Promise<Activity | null> {
      return (await findOpen()) ?? null;
    },

    /** Abertas primeiro; depois as mais recentes. Exclui as removidas logicamente. */
    async list(): Promise<Activity[]> {
      const all = await database.activities.filter((a) => !a.deleted).toArray();
      return all.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'aberta' ? -1 : 1;
        return b.startedAt - a.startedAt;
      });
    },

    async create(input: NewActivityInput, technician: string): Promise<Activity> {
      const title = input.title.trim();
      const tech = technician.trim();
      const os = input.osNumber?.trim();
      if (!title) throw new ActivityRuleError('TITLE_REQUIRED', 'Informe um título para a atividade.');
      if (!tech) throw new ActivityRuleError('TECHNICIAN_REQUIRED', 'Informe o nome do técnico.');

      // A checagem e a gravação ficam na mesma transação: duas abas/toques não abrem duas atividades.
      return database.transaction('rw', database.activities, async () => {
        const open = await findOpen();
        if (open) throw alreadyOpen(open);
        const now = Date.now();
        const activity: Activity = {
          ...newBase(tech, now),
          kind: input.kind,
          title,
          ...(os ? { osNumber: os } : {}),
          technician: tech,
          startedAt: now,
          status: 'aberta',
          description: '',
          materials: [],
          ...(input.projectId ? { projectId: input.projectId } : {}),
        };
        await database.activities.add(activity);
        return activity;
      });
    },

    /** Edita titulo, OS, descricao e materiais. O tipo, o tecnico e as datas nao mudam por aqui. Dono ou administrador. */
    async update(id: string, patch: ActivityPatch): Promise<Activity> {
      return database.transaction('rw', database.activities, async () => {
        const a = await database.activities.get(id);
        if (!a || a.deleted) throw new ActivityRuleError('NOT_FOUND', 'Atividade não encontrada.');
        if (!canEdit(a)) throw new ActivityRuleError('NOT_OWNER', notMineMessage('atividade'));
        const changes: Partial<Activity> = {};
        if (patch.title !== undefined) {
          const title = patch.title.trim().replace(/\s+/g, ' ');
          if (!title) throw new ActivityRuleError('TITLE_REQUIRED', 'Dê um título para a atividade.');
          changes.title = title.slice(0, 120);
        }
        if (patch.osNumber !== undefined) changes.osNumber = patch.osNumber.trim().slice(0, 40) || undefined; // `undefined` remove o campo
        if (patch.description !== undefined) changes.description = patch.description.trim().slice(0, MAX_DESCRIPTION);
        if (patch.materials !== undefined) changes.materials = sanitizeMaterials(patch.materials);
        await database.activities.update(id, touch<Activity>(changes));
        return (await database.activities.get(id)) as Activity;
      });
    },

    async complete(id: string): Promise<void> {
      await database.transaction('rw', database.activities, async () => {
        const a = await database.activities.get(id);
        if (!a || a.deleted) throw new ActivityRuleError('NOT_FOUND', 'Atividade não encontrada.');
        if (!canEdit(a)) throw new ActivityRuleError('NOT_OWNER', notMineMessage('atividade'));
        if (a.status === 'concluida') return;
        await database.activities.update(id, touch<Activity>({ status: 'concluida', endedAt: Date.now() }));
      });
    },

    /**
     * Exclusao LOGICA da atividade e de tudo o que e dela (elementos, cabos, fotos e trilha), de uma vez e com a mesma hora
     * (o servidor reconhece como um so envio). Dono ou administrador. Cabos e reservas de OUTRAS atividades que dependiam
     * de algo daqui ficam no lugar, sem o vinculo.
     */
    async remove(id: string): Promise<ActivityRemoval> {
      return database.transaction('rw', [database.activities, database.elements, database.cables, database.photos, database.trackPoints], async () => {
        const a = await database.activities.get(id);
        if (!a || a.deleted) throw new ActivityRuleError('NOT_FOUND', 'Atividade não encontrada.');
        if (!canEdit(a)) throw new ActivityRuleError('NOT_OWNER', notMineMessage('atividade'));
        const now = Date.now();
        const mark = async <T extends { id: string }>(find: () => Promise<T[]>, update: (rid: string, changes: never) => Promise<unknown>): Promise<T[]> => {
          const found = await find();
          for (const x of found) await update(x.id, touch<BaseRecord>({ deleted: true }, now) as never);
          return found;
        };
        await database.activities.update(id, touch<Activity>({ deleted: true }, now));
        const cables = await mark(() => database.cables.where('activityId').equals(id).filter((x) => !x.deleted).toArray(), (rid, ch) => database.cables.update(rid, ch));
        const elements = await mark(() => database.elements.where('activityId').equals(id).filter((x) => !x.deleted).toArray(), (rid, ch) => database.elements.update(rid, ch));
        const photos = await mark(() => database.photos.where('activityId').equals(id).filter((x) => !x.deleted).toArray(), (rid, ch) => database.photos.update(rid, ch));
        const trackPoints = await mark(() => database.trackPoints.where('activityId').equals(id).filter((x) => !x.deleted).toArray(), (rid, ch) => database.trackPoints.update(rid, ch));
        // o que ficou em outras atividades e dependia disto: cabo que passava por um poste daqui segue com o ponto solto,
        // reserva que era de um cabo daqui fica sem cabo, e o total do cabo de fora perde a reserva que saiu
        for (const c of cables) await unlinkReserves(database, c.id);
        for (const e of elements) {
          await detachElementFromCables(database, e.id);
          const cableId = (e.attrs as { cableId?: string }).cableId;
          if (e.type === 'reserva' && cableId) await recomputeCable(database, cableId);
        }
        return { elements: elements.length, cables: cables.length, photos: photos.length, trackPoints: trackPoints.length };
      });
    },

    async reopen(id: string): Promise<void> {
      await database.transaction('rw', database.activities, async () => {
        const a = await database.activities.get(id);
        if (!a || a.deleted) throw new ActivityRuleError('NOT_FOUND', 'Atividade não encontrada.');
        if (!canEdit(a)) throw new ActivityRuleError('NOT_OWNER', notMineMessage('atividade'));
        if (a.status === 'aberta') return;
        // Uma aberta por TECNICO: reabrir a atividade de alguem (administrador) so e barrado se ESSE tecnico ja tem outra aberta.
        const open = await database.activities
          .where('status')
          .equals('aberta')
          .filter((x) => !x.deleted && (x.ownerId ?? null) === (a.ownerId ?? null))
          .first();
        if (open) throw alreadyOpen(open);
        // `undefined` remove o campo no Dexie.
        await database.activities.update(id, touch<Activity>({ status: 'aberta', endedAt: undefined }));
      });
    },
  };
}

export const activities = activityRepo();
