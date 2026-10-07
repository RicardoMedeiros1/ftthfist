import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ConfirmDialog from '../../components/ConfirmDialog';
import { db } from '../../db/db';
import type { Activity } from '../../db/types';
import { adminDeleteText } from '../../lib/ownership';
import { useCanEdit, useIsMine } from '../../lib/useOwnership';
import { ActivityRuleError, activities } from './activityRepo';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Excluir atividade": para o dono e para o administrador, com confirmacao. A exclusao e logica e leva junto os elementos, os
 * cabos, as fotos e a trilha dela (o que fica em outras atividades perde so o vinculo). Nao aparece para quem so le.
 */
export default function DeleteActivity({ activity, onDeleted }: { activity: Activity; onDeleted?: () => void }) {
  const editable = useCanEdit(activity);
  const mine = useIsMine(activity);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = useLiveQuery(
    async () => ({
      elements: await db.elements.where('activityId').equals(activity.id).filter((e) => !e.deleted).count(),
      cables: await db.cables.where('activityId').equals(activity.id).filter((c) => !c.deleted).count(),
      photos: await db.photos.where('activityId').equals(activity.id).filter((p) => !p.deleted).count(),
    }),
    [activity.id],
  );
  if (!editable) return null;

  const what = counts
    ? [plural(counts.elements, 'elemento', 'elementos'), plural(counts.cables, 'cabo', 'cabos'), plural(counts.photos, 'foto', 'fotos')].join(', ')
    : 'tudo o que é dela';
  const message = [
    !mine ? adminDeleteText('atividade', activity.technician) : '',
    `Saem do mapa, das listas e dos totais: a atividade, ${what} e a trilha GPS dela.`,
    activity.status === 'aberta' ? 'Ela está aberta: a gravação da trilha e o trabalho em andamento são encerrados.' : '',
    'Não dá para desfazer pelo app.',
  ]
    .filter(Boolean)
    .join(' ');

  async function confirm() {
    setAsking(false);
    setError(null);
    try {
      await activities.remove(activity.id);
      onDeleted?.();
    } catch (e) {
      setError(e instanceof ActivityRuleError ? e.message : 'Não foi possível excluir. Tente de novo.');
    }
  }

  return (
    <>
      <button className="btn btn-danger btn-block" onClick={() => setAsking(true)}>
        Excluir atividade
      </button>
      {error && <div className="alert" role="alert">{error}</div>}
      {asking && (
        <ConfirmDialog
          title={`Excluir a atividade "${activity.title}"?`}
          message={message}
          confirmLabel="Excluir tudo"
          danger
          onCancel={() => setAsking(false)}
          onConfirm={() => void confirm()}
        />
      )}
    </>
  );
}
