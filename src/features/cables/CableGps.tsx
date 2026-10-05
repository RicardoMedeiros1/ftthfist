import { useEffect } from 'react';
import { useDraft } from '../elements/draftStore';
import { gpsFeed } from './gpsFeed';

/** Mantém o GPS ligado enquanto o cabo está sendo lançado, para o botão "Marcar poste aqui" responder na hora. */
function Watcher() {
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    gpsFeed.reset();
    const id = navigator.geolocation.watchPosition(
      (pos) =>
        gpsFeed.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        }),
      () => undefined, // sem sinal: o botão avisa na hora de usar
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      gpsFeed.reset();
    };
  }, []);
  return null;
}

export default function CableGps() {
  const active = useDraft((s) => s.phase === 'cabo');
  return active ? <Watcher /> : null;
}
