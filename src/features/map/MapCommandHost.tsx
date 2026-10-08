import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { mapCommands, usePendingMapCommand } from './mapCommands';

/** Aplica os pedidos de "ver no mapa". `onBeforeMove` solta o modo "seguir o GPS", que senão desfaria o movimento. */
export default function MapCommandHost({ onBeforeMove }: { onBeforeMove: () => void }) {
  const map = useMap();
  const cmd = usePendingMapCommand();
  useEffect(() => {
    if (!cmd) return;
    onBeforeMove();
    if (cmd.kind === 'fit') {
      const [s, w, n, e] = cmd.bounds;
      // Um ponto só (ou quase): fitBounds iria para o zoom máximo; usa um zoom de rua.
      if (n - s < 1e-5 && e - w < 1e-5) map.setView([(s + n) / 2, (w + e) / 2], 18);
      // as margens de cima e de baixo desviam da faixa da atividade e dos botoes do mapa, que ficam por cima
      else map.fitBounds([[s, w], [n, e]], { paddingTopLeft: [48, 110], paddingBottomRight: [84, 130], maxZoom: 19 });
    } else {
      map.setView([cmd.lat, cmd.lng], Math.max(map.getZoom(), cmd.zoom));
    }
    mapCommands.done(cmd.id);
  }, [cmd, map, onBeforeMove]);
  return null;
}
