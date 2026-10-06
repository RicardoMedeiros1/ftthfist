import { formatDateTime } from '../../lib/format';
import type { ChangeEntry } from './adminApi';
import { changeVerb, diffRecords, recordTitle, type FieldChange } from './diffRecords';

// Texto de cada linha das telas "Alterações" e "Conflitos" (puro, testado sem tela).

export type ChangeKind = 'alteracao' | 'conflito';

export interface ChangeView {
  key: string;
  headline: string;
  owner: string;
  when: string;
  changes: FieldChange[];
  /** Tela do app para abrir o registro (null se nao existe tela: foto e ponto da trilha). */
  open: { route: 'elemento' | 'cabo' | 'atividade'; id: string } | null;
}

const OPEN: Record<string, 'elemento' | 'cabo' | 'atividade'> = { elements: 'elemento', cables: 'cabo', activities: 'atividade' };
const nameOf = (names: Map<string, string>, id: string | null) => (id ? names.get(id) || 'Alguém' : 'Alguém');

export function ids(entries: ChangeEntry[]): string[] {
  return entries.flatMap((e) => [e.ownerId, ...(e.editedBy ? [e.editedBy] : [])]);
}

export function describeChange(kind: ChangeKind, e: ChangeEntry, names: Map<string, string>): ChangeView {
  const title = recordTitle(e.table, { ...e.before, ...e.after });
  const owner = `de ${nameOf(names, e.ownerId)}`;
  const when = formatDateTime(Date.parse(e.at));
  const open = OPEN[e.table] && !(e.after.deleted === true) ? { route: OPEN[e.table]!, id: e.recordId } : null;
  if (kind === 'conflito') {
    // before = o que o servidor manteve; after = o que chegou atrasado e foi recusado
    return {
      key: `c${e.id}`,
      headline: `Edição atrasada recusada · ${title}`,
      owner,
      when,
      changes: diffRecords(e.before, e.after).map((c) => ({ label: c.label, before: `ficou ${c.before}`, after: `chegou ${c.after}` })),
      open,
    };
  }
  return {
    key: `a${e.id}`,
    headline: `${nameOf(names, e.editedBy)} ${changeVerb(e.before, e.after).toLowerCase()} · ${title}`,
    owner,
    when,
    changes: diffRecords(e.before, e.after),
    open,
  };
}
