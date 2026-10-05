import { useEffect } from 'react';
import { draftStore, useDraft } from './draftStore';
import { betterFix, captureOutcome, type Fix } from './gpsCapture';

/** Escuta o GPS enquanto a busca está ativa e guarda a melhor leitura no rascunho. */
function Capture() {
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      draftStore.failCapture('Este aparelho não oferece geolocalização.');
      return;
    }
    const startedAt = Date.now();
    let best: Fix | null = null;

    const evaluate = () => {
      const outcome = captureOutcome(best, Date.now() - startedAt);
      if (outcome === 'concluir') draftStore.finishCapture();
      else if (outcome === 'falhar') draftStore.failCapture('Sem sinal de GPS. Tente de novo ou toque no mapa.');
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        best = betterFix(best, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
        draftStore.setGpsBest(best);
        evaluate();
      },
      (err) => {
        // Sinal fraco/timeout: continua esperando. Só a negação de permissão encerra.
        if (err.code === err.PERMISSION_DENIED) {
          draftStore.failCapture('Permissão de localização negada. Libere o GPS nas configurações do navegador.');
        }
      },
      // maximumAge 0: nunca aceitar posição antiga guardada pelo aparelho.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    const timer = setInterval(() => {
      draftStore.setElapsed(Date.now() - startedAt);
      evaluate();
    }, 250);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(timer);
    };
  }, []);
  return null;
}

export default function GpsCaptureHost() {
  const active = useDraft((s) => s.phase === 'posicao' && s.mode === 'gps' && s.capture === 'buscando');
  const run = useDraft((s) => s.captureRun);
  // `key` reinicia a escuta quando o técnico pede "buscar de novo".
  return active ? <Capture key={run} /> : null;
}
