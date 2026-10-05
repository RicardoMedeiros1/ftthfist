import { divIcon, type DivIcon } from 'leaflet';
import type { ElementType } from '../../db/types';
import { elementSvg } from './elementSvg';

export type IconVariant = 'highlighted' | 'dim' | 'draft';

const SIZE: Record<IconVariant, number> = { highlighted: 44, dim: 28, draft: 54 };
const cache = new Map<string, DivIcon>();

/** Ícone de mapa: destacado (atividade aberta), apagado (outras atividades) ou rascunho (sendo posicionado). */
export function elementIcon(type: ElementType, variant: IconVariant): DivIcon {
  const key = `${type}:${variant}`;
  let icon = cache.get(key);
  if (!icon) {
    const size = SIZE[variant];
    icon = divIcon({
      className: `el-icon el-icon-${variant}`,
      html: elementSvg(type, { highlighted: variant !== 'dim', size }),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    cache.set(key, icon);
  }
  return icon;
}
