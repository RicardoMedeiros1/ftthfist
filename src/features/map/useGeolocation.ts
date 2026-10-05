import { useCallback, useEffect, useRef, useState } from 'react';

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number; // metros
  timestamp: number;
}

/** off: GPS desligado · following: mapa acompanha · free: GPS ligado, mapa solto */
export type LocateMode = 'off' | 'following' | 'free';

function messageFor(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Permissão de localização negada. Libere o GPS nas configurações do navegador.';
    case err.POSITION_UNAVAILABLE:
      return 'Sem sinal de GPS no momento.';
    default:
      return 'O GPS demorou para responder. Tentando de novo…';
  }
}

export function useGeolocation() {
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [mode, setMode] = useState<LocateMode>('off');
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  }, []);

  const start = useCallback(() => {
    if (watchId.current !== null) return;
    if (!('geolocation' in navigator)) {
      setError('Este aparelho não oferece geolocalização.');
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        setError(messageFor(err));
        if (err.code === err.PERMISSION_DENIED) {
          stop();
          setMode('off');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [stop]);

  /** Toque no botão: off→seguindo, solto→seguindo, seguindo→desliga. */
  const toggle = useCallback(() => {
    if (mode === 'following') {
      stop();
      setMode('off');
      setFix(null);
      setError(null);
    } else {
      start();
      setMode('following');
    }
  }, [mode, start, stop]);

  /** O usuário arrastou o mapa: o GPS continua, mas o mapa deixa de seguir. */
  const release = useCallback(() => {
    setMode((m) => (m === 'following' ? 'free' : m));
  }, []);

  useEffect(() => stop, [stop]);

  return { fix, mode, error, toggle, release };
}
