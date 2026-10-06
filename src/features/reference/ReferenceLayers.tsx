import { useLiveQuery } from 'dexie-react-hooks';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type { ReferenceFeature } from '../../db/types';
import { navigate } from '../../lib/route';
import { draftStore } from '../elements/draftStore';
import { references } from './referenceRepo';
import './reference.css';

const PANE = 'reference';

type LatLng = [number, number];
const ll = ([lng, lat]: [number, number]): LatLng => [lat, lng];

function build(f: ReferenceFeature, color: string, renderer: L.Canvas): L.Layer {
  const g = f.geom;
  const layer =
    g.kind === 'point'
      ? L.circleMarker(ll(g.coord), { renderer, pane: PANE, radius: 6, color: '#000', weight: 2, fillColor: color, fillOpacity: 1 })
      : g.kind === 'line'
        ? L.polyline(g.parts.map((p) => p.map(ll)), { renderer, pane: PANE, color, weight: 3, opacity: 0.95, dashArray: '8 6' })
        : // Só o contorno: um polígono preenchido e tocável interceptaria toques no mapa vazio.
          L.polygon(g.rings.map((r) => r.map(ll)), { renderer, pane: PANE, color, weight: 3, fill: false, dashArray: '4 6' });
  layer.on('click', () => {
    // Só abre o detalhe em modo normal: marcando, movendo ou lançando cabo o toque é do mapa.
    if (draftStore.getState().phase === 'idle') navigate('referencia', { id: f.id });
  });
  return layer;
}

/**
 * Camadas de referência (KML/KMZ importado) visíveis. Desenhadas em canvas (milhares de itens sem peso),
 * num painel abaixo dos cabos e dos elementos.
 */
export default function ReferenceLayers() {
  const map = useMap();
  const layers = useLiveQuery(() => references.list());
  // Só refaz o desenho quando muda o que é visível (ou a cor), não a cada alteração de nome ou "convertido".
  const key = layers?.filter((l) => l.visible).map((l) => `${l.id}~${l.color}`).join('|') ?? '';

  useEffect(() => {
    if (!key) return;
    if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = '380';
    let cancelled = false;
    // tolerance: aumenta a área de toque (≈ 50 px) de pontos e linhas finas
    const renderer = L.canvas({ pane: PANE, padding: 0.4, tolerance: 22 });
    const group = L.layerGroup();
    void (async () => {
      // Ordem de desenho = prioridade do toque: o que entra por último fica por cima e é o tocado.
      // Pontos acima de linhas, linhas acima de polígonos (um cabo passando por um poste não "rouba" o toque).
      const byKind: Record<'polygon' | 'line' | 'point', L.Layer[]> = { polygon: [], line: [], point: [] };
      for (const part of key.split('|')) {
        const [id, color] = part.split('~') as [string, string];
        const feats = await references.features(id);
        if (cancelled) return;
        for (const f of feats) byKind[f.geom.kind].push(build(f, color, renderer));
      }
      for (const layer of [...byKind.polygon, ...byKind.line, ...byKind.point]) group.addLayer(layer);
      if (!cancelled) group.addTo(map);
    })();
    return () => {
      cancelled = true;
      group.remove();
      renderer.remove();
    };
  }, [map, key]);

  return null;
}
