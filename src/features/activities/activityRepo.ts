import { db, newBase, touch, type RotaFibraDB } from '../../db/db';
import type { Activity, ActivityKind } from '../../db/types';
import { isMine, notMineMessage } from '../../lib/ownership';

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

export interface NewActivityInput {
  kind: ActivityKind;
  title: string;
  osNumber?: string;
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
        };
        await database.activities.add(activity);
        return activity;
      });
    },

    async complete(id: string): Promise<void> {
      await database.transaction('rw', database.activities, async () => {
        const a = await database.activities.get(id);
        if (!a || a.deleted) throw new ActivityRuleError('NOT_FOUND', 'Atividade não encontrada.');
        if (!isMine(a)) throw new ActivityRuleError('NOT_OWNER', notMineMessage('atividade'));
        if (a.status === 'concluida') return;
        await database.activities.update(id, touch<Activity>({ status: 'concluida', endedAt: Date.now() }));
      });
    },

    async reopen(id: string): Promise<void> {
      await database.transaction('rw', database.activities, async () => {
        const a = await database.activities.get(id);
        if (!a || a.deleted) throw new ActivityRuleError('NOT_FOUND', 'Atividade não encontrada.');
        if (!isMine(a)) throw new ActivityRuleError('NOT_OWNER', notMineMessage('atividade'));
        if (a.status === 'aberta') return;
        const open = await findOpen();
        if (open) throw alreadyOpen(open);
        // `undefined` remove o campo no Dexie.
        await database.activities.update(id, touch<Activity>({ status: 'aberta', endedAt: undefined }));
      });
    },
  };
}

export const activities = activityRepo();
