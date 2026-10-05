import ActivitiesScreen from './features/activities/ActivitiesScreen';
import NewActivityScreen from './features/activities/NewActivityScreen';
import MapScreen from './features/map/MapScreen';
import SettingsScreen from './features/settings/SettingsScreen';
import { useRoute } from './lib/route';

export default function App() {
  const route = useRoute();
  return (
    <>
      {/* O mapa fica sempre montado: abrir uma tela não interrompe o GPS nem o modo seguir. */}
      <div style={{ height: '100%' }} inert={route !== 'map'}>
        <MapScreen />
      </div>
      {route === 'atividades' && <ActivitiesScreen />}
      {route === 'nova-atividade' && <NewActivityScreen />}
      {route === 'config' && <SettingsScreen />}
    </>
  );
}
