import UpdatePrompt from './components/UpdatePrompt';
import ActivitiesScreen from './features/activities/ActivitiesScreen';
import NewActivityScreen from './features/activities/NewActivityScreen';
import ElementDetailScreen from './features/elements/ElementDetailScreen';
import { draftStore } from './features/elements/draftStore';
import ElementFormScreen from './features/elements/ElementFormScreen';
import MapScreen from './features/map/MapScreen';
import SettingsScreen from './features/settings/SettingsScreen';
import { useEffect } from 'react';
import { useRoute } from './lib/route';

export default function App() {
  const route = useRoute();

  // Sair do mapa (voltar, configurações…) no meio de "mover" desiste da movimentação.
  useEffect(() => {
    if (route !== 'map' && draftStore.getState().phase === 'mover') draftStore.cancel();
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
      {route === 'config' && <SettingsScreen />}
      <UpdatePrompt />
    </>
  );
}
