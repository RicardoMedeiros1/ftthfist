import { formatDateTime } from '../lib/format';
import { actingUserId, adminEditingText } from '../lib/ownership';

/** Faixa nas telas de detalhe quando o administrador esta alterando o registro de um tecnico. */
export function AdminBanner({ author, what }: { author: string; what: string }) {
  return (
    <p className="hint admin-banner" role="note">
      {adminEditingText(what, author)}
    </p>
  );
}

/** "Alterado pelo administrador em 06/10, 18:09": aparece para o dono (e para o proprio administrador) quando outra pessoa mexeu. */
export function EditedByNote({ record }: { record: { ownerId?: string; updatedBy?: string; updatedAt: number } }) {
  if (!record.updatedBy || !record.ownerId || record.updatedBy === record.ownerId) return null;
  const me = record.updatedBy === actingUserId();
  return (
    <p className="hint edited-by-note" role="note">
      {me ? 'Você (administrador) alterou este registro' : 'Alterado pelo administrador'} em {formatDateTime(record.updatedAt)}.
    </p>
  );
}
