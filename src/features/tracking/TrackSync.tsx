import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { activities } from '../activities/activityRepo';
import { trackRecorder } from './trackRecorder';

/** Ao abrir o app retoma o estado da gravação; depois, garante que ela só continua na atividade aberta. */
export default function TrackSync() {
  const open = useLiveQuery(() => activities.getOpen()); // undefined = carregando
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void trackRecorder.hydrate().finally(() => setReady(true));
  }, []);
  const openId = open === undefined ? undefined : (open?.id ?? null);
  useEffect(() => {
    if (ready && openId !== undefined) void trackRecorder.syncActivity(openId);
  }, [ready, openId]);
  return null;
}
