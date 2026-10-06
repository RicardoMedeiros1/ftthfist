import { useEffect, useState } from 'react';
import { useRoute } from '../../lib/route';
import { useDraft } from './draftStore';

const NOTICE_MS = 3500;

/** Aviso rápido (ex.: "Salvo: Poste P-101"). Fica no bloco de avisos do topo, onde nada mais compete por espaço. */
export default function SavedNotice() {
  const route = useRoute();
  const idle = useDraft((s) => s.phase === 'idle');
  const notice = useDraft((s) => s.notice);
  const id = useDraft((s) => s.noticeId);
  const [visibleId, setVisibleId] = useState(0);

  useEffect(() => {
    if (!id) return;
    setVisibleId(id);
    const t = setTimeout(() => setVisibleId(0), NOTICE_MS);
    return () => clearTimeout(t);
  }, [id]);

  // Some assim que uma nova marcação começa e não aparece por cima de outras telas.
  if (route !== 'map' || !idle || !notice || visibleId !== id) return null;
  return (
    <div className="saved-notice" role="status">
      {notice}
    </div>
  );
}
