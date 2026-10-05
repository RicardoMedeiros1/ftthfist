export type BaseLayerId = 'ruas' | 'satelite';

export interface BaseLayerDef {
  id: BaseLayerId;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
}

export const BASE_LAYERS: Record<BaseLayerId, BaseLayerDef> = {
  ruas: {
    id: 'ruas',
    label: 'Ruas',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satelite: {
    id: 'satelite',
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagem &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
};
