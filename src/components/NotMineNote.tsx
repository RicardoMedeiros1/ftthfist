import { otherOwnerText } from '../lib/ownership';

/** Aviso nas telas de detalhe de registros de outro tecnico (somente leitura). */
export default function NotMineNote({ author, what }: { author: string; what: string }) {
  return (
    <p className="hint not-mine-note" role="note">
      {otherOwnerText(what, author)}
    </p>
  );
}
