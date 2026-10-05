import UpdatePrompt from './components/UpdatePrompt';
import BackupReminder from './features/export/BackupReminder';
import BackupScreen from './features/export/BackupScreen';
import { requestPersistence } from './lib/storage';
import ActivitiesScreen from './features/activities/ActivitiesScreen';
import NewActivityScreen from './features/activities/NewActivityScreen';
import CableDetailScreen from './features/cables/CableDetailScreen';
import CableSetupScreen from './features/cables/CableSetupScreen';
import { cableDraftStore } from './features/cables/cableDraft';
import ElementDetailScreen from './features/elements/ElementDetailScreen';
import { draftStore } from './features/elements/draftStore';
import ElementFormScreen from './features/elements/ElementFormScreen';
import MapScreen from './features/map/MapScreen';
import SettingsScreen from './features/settings/SettingsScreen';
import { useEffect } from 'react';
import { useRoute } from './lib/route';

export default function App() {
  const route = useRoute();

  // Pede ao navegador para não apagar os dados do app (a tela de backup mostra o resultado).
  useEffect(() => {
    void requestPersistence();
  }, []);

  // Reabriu o app com um cabo em lançamento? Retoma de onde parou.
  useEffect(() => {
    void cableDraftStore.hydrate().then((found) => {
      if (found) draftStore.startCable();
    });
  }, []);

  // Sair do mapa (voltar, configurações…) no meio de "mover" ou de editar o traçado desiste da operação.
  useEffect(() => {
    const phase = draftStore.getState().phase;
    if (route !== 'map' && (phase === 'mover' || phase === 'cabo-editar')) draftStore.cancel();
  }, [route]);
  return (
    <>
      {/* O mapa fica sempre montado: abrir uma tela não interrompe o GPS nem o modo seguir. */}
      <div style={{ height: '100%' }} inert={route !== 'map'}>
        <MapScreen />
      </div>
      {route === 'atividades' && <ActivitiesScreen />}
      {route === 'nova-atividade' && <NewActivityScreen />}
      {route === 'novo-elemento' && <ElementFormScreen />}
      {route === 'elemento' && <ElementDetailScreen />}
      {route === 'novo-cabo' && <CableSetupScreen />}
      {route === 'cabo' && <CableDetailScreen />}
      {route === 'config' && <SettingsScreen />}
      {route === 'backup' && <BackupScreen />}
      <div className="toast-host">
        <UpdatePrompt />
        <BackupReminder />
      </div>
    </>
  );
}
