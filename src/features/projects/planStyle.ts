import { divIcon, type DivIcon } from 'leaflet';
import type { PlanPointType } from '../../db/types';
import { elementSvg } from '../elements/elementSvg';

// Como o desenho do projeto aparece no mapa: tracejado ciano e icones com anel tracejado, para nunca se confundir com o que
// ja foi feito em campo (cabos coloridos e icones cheios). O mesmo estilo serve ao editor, ao tecnico e ao painel.

export const PLAN_COLOR = '#00e5ff';
export const PLAN_CASING = '#00222b';
export const PLAN_SELECT = '#ffd400';

const pinCache = new Map<string, DivIcon>();

/** Icone de um ponto projetado (area de toque de 48 px). */
export function planPointIcon(type: PlanPointType, selected = false): DivIcon {
  const key = `${type}:${selected}`;
  let icon = pinCache.get(key);
  if (!icon) {
    icon = divIcon({
      className: 'plan-pin-icon',
      html: `<div class="plan-pin${selected ? ' plan-pin-sel' : ''}"><div class="plan-pin-ring">${elementSvg(type, { size: 28 })}</div></div>`,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
    pinCache.set(key, icon);
  }
  return icon;
}

const handle = (cls: string) => divIcon({ className: 'plan-handle-icon', html: `<div class="plan-handle ${cls}"></div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
/** Alca de um ponto do traçado (arrastar muda o ponto). */
export const handleIcon = (selected: boolean): DivIcon => (selected ? HANDLE_SEL : HANDLE);
/** Alca do meio de um trecho (tocar cria um ponto novo ali). */
export const midIcon: DivIcon = handle('plan-handle-mid');
const HANDLE = handle('');
const HANDLE_SEL = handle('plan-handle-sel');
