import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './update-prompt.css';

const CHECK_EVERY_MS = 60 * 60 * 1000;

/** Avisa quando há versão nova do app e quando o app já pode ser usado offline. */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Procura versão nova de hora em hora enquanto o app fica aberto.
      if (registration) setInterval(() => void registration.update(), CHECK_EVERY_MS);
    },
  });

  // O aviso informativo some sozinho; o de atualização espera o toque do técnico.
  useEffect(() => {
    if (!offlineReady) return;
    const t = setTimeout(() => setOfflineReady(false), 8000);
    return () => clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  if (needRefresh) {
    return (
      <div className="update-toast" role="alert">
        <span>Nova versão disponível</span>
        {/* Só atualiza quando o técnico toca: recarregar no meio de um formulário perderia o que foi digitado. */}
        <button className="btn btn-primary btn-small" onClick={() => void updateServiceWorker(true)}>
          Atualizar
        </button>
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div className="update-toast" role="status">
        <span>Pronto para usar sem internet</span>
        <button className="btn btn-small" onClick={() => setOfflineReady(false)}>
          OK
        </button>
      </div>
    );
  }

  return null;
}
