import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useMemo } from 'react';
import { SETTING_KEYS, getSetting, setSetting } from '../../db/db';
import { navigate } from '../../lib/route';
import { useDraft } from '../elements/draftStore';
import PlanShapes from './PlanShapes';
import { plannedProjects } from './planInfo';
import { useMyProjects } from './useMyProjects';

// A camada "Projetado" do mapa do tecnico: o desenho dos projetos que faltam fazer, como guia. Funciona sem internet (o desenho
// vem junto com o projeto na sincronizacao) e liga/desliga por um botao do mapa.

/** Ligada por padrao. `undefined` enquanto carrega. */
export const usePlannedVisible = (): boolean | undefined => useLiveQuery(() => getSetting<boolean>(SETTING_KEYS.plannedVisible, true));

export const setPlannedVisible = (visible: boolean): Promise<void> => setSetting(SETTING_KEYS.plannedVisible, visible);

/** Os desenhos que o tecnico tem para seguir agora. */
export function usePlannedProjects() {
  const { rows } = useMyProjects();
  return useMemo(() => plannedProjects(rows ?? []), [rows]);
}

/** Dentro do mapa. So desenha (e pega toque) quando o tecnico nao esta marcando nada. */
export const ProjectPlanLayer = memo(function ProjectPlanLayer() {
  const plans = usePlannedProjects();
  const visible = usePlannedVisible();
  const idle = useDraft((s) => s.phase === 'idle');
  if (!visible || plans.length === 0) return null;
  return <PlanShapes plans={plans} interactive={idle} topInset={150} onOpenProject={(id) => navigate('meu-projeto', { id })} />;
});

/** O botao do mapa. So aparece quando ha algum desenho para mostrar. */
export const PlannedToggle = memo(function PlannedToggle() {
  const plans = usePlannedProjects();
  const visible = usePlannedVisible();
  const idle = useDraft((s) => s.phase === 'idle');
  if (!idle || visible === undefined || plans.length === 0) return null;
  return (
    <button
      className="map-btn map-btn-wide"
      aria-pressed={visible}
      aria-label={visible ? 'Ocultar o desenho dos projetos' : 'Mostrar o desenho dos projetos'}
      onClick={() => void setPlannedVisible(!visible)}
    >
      Projetado
    </button>
  );
});
