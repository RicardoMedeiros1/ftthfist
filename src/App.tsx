import UpdatePrompt from './components/UpdatePrompt';
import SavedNotice from './features/elements/SavedNotice';
import BackupReminder from './features/export/BackupReminder';
import BackupScreen from './features/export/BackupScreen';
import ExportScreen from './features/export/ExportScreen';
import AccountScreen from './features/account/AccountScreen';
import { accountStore } from './features/account/accountStore';
import SyncScreen from './features/sync/SyncScreen';
import AlteracoesScreen from './features/admin/AlteracoesScreen';
import PessoasScreen from './features/admin/PessoasScreen';
import { initSync } from './features/sync/syncRuntime';
import CamadasScreen from './features/reference/CamadasScreen';
import LayerScreen from './features/reference/LayerScreen';
import ReferenceFeatureScreen from './features/reference/ReferenceFeatureScreen';
import { requestPersistence } from './lib/storage';
import ActivitiesScreen from './features/activities/ActivitiesScreen';
import ActivityDetailScreen from './features/activities/ActivityDetailScreen';
import NewActivityScreen from './features/activities/NewActivityScreen';
import TrackScreen from './features/tracking/TrackScreen';
import TrackSync from './features/tracking/TrackSync';
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

  // Conta (Fase 2): carrega o ultimo estado conhecido e confirma a sessao sem bloquear nada. Sem variaveis, nao faz nada.
  useEffect(() => {
    void accountStore.init().then(initSync);
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
      {route === 'atividade' && <ActivityDetailScreen />}
      {route === 'nova-atividade' && <NewActivityScreen />}
      {route === 'novo-elemento' && <ElementFormScreen />}
      {route === 'elemento' && <ElementDetailScreen />}
      {route === 'novo-cabo' && <CableSetupScreen />}
      {route === 'cabo' && <CableDetailScreen />}
      {route === 'trilha' && <TrackScreen />}
      <TrackSync />
      {route === 'config' && <SettingsScreen />}
      {route === 'backup' && <BackupScreen />}
      {route === 'exportar' && <ExportScreen />}
      {route === 'conta' && <AccountScreen />}
      {route === 'sincronizacao' && <SyncScreen />}
      {route === 'pessoas' && <PessoasScreen />}
      {route === 'alteracoes' && <AlteracoesScreen />}
      {route === 'camadas' && <CamadasScreen />}
      {route === 'camada' && <LayerScreen />}
      {route === 'referencia' && <ReferenceFeatureScreen />}
      <div className="toast-host">
        <SavedNotice />
        <UpdatePrompt />
        <BackupReminder />
      </div>
    </>
  );
}
