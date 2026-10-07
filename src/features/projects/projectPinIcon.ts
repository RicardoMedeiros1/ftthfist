import { divIcon } from 'leaflet';

// O pino de um projeto no mapa (amarelo, com area de toque de 48 px). Usado no mapa do tecnico e no do painel.

const BOX = 48;
export const projectPinIcon = divIcon({
  className: 'project-pin',
  html: `<div class="el-hit" style="width:${BOX}px;height:${BOX}px"><svg viewBox="0 0 32 40" width="36" height="44" aria-hidden="true"><path d="M16 38C16 38 4 24 4 14a12 12 0 1 1 24 0C28 24 16 38 16 38Z" fill="#ffd60a" stroke="#000" stroke-width="3"/><circle cx="16" cy="14" r="5" fill="#000"/></svg></div>`,
  iconSize: [BOX, BOX],
  iconAnchor: [BOX / 2, BOX - 4],
});
