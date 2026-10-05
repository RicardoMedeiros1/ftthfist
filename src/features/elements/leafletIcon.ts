import { divIcon, type DivIcon } from 'leaflet';
import type { ElementType } from '../../db/types';
import { elementSvg } from './elementSvg';

export type IconVariant = 'highlighted' | 'dim' | 'draft';

const SIZE: Record<IconVariant, number> = { highlighted: 44, dim: 28, draft: 54 };
/** Área de toque mínima (princípio 4): o desenho pode ser menor, mas o toque acerta num quadrado de 48 px. */
const HIT = 48;
const cache = new Map<string, DivIcon>();

/** Ícone de mapa: destacado (atividade aberta), apagado (outras atividades) ou rascunho (sendo posicionado). */
export function elementIcon(type: ElementType, variant: IconVariant): DivIcon {
  const key = `${type}:${variant}`;
  let icon = cache.get(key);
  if (!icon) {
    const size = SIZE[variant];
    const box = Math.max(size, HIT);
    icon = divIcon({
      className: `el-icon el-icon-${variant}`,
      html: `<div class="el-hit" style="width:${box}px;height:${box}px">${elementSvg(type, { highlighted: variant !== 'dim', size })}</div>`,
      iconSize: [box, box],
      iconAnchor: [box / 2, box / 2],
    });
    cache.set(key, icon);
  }
  return icon;
}
