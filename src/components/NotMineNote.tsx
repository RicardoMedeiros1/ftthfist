/** Aviso nas telas de detalhe de registros de outro tecnico (somente leitura). */
export default function NotMineNote({ author, what }: { author: string; what: string }) {
  return (
    <p className="hint not-mine-note" role="note">
      Este {what} foi registrado por {author || 'outro técnico'}. Só ele pode alterar.
    </p>
  );
}
