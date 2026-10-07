import { Canvas } from 'leaflet';

// Leaflet 1.9.4: se um desenho em canvas (linhas/circulos) e removido DEPOIS de o proprio canvas ter sido destruido (o que
// acontece ao sair da tela do mapa, pois o React desmonta os filhos depois de o mapa ter sido removido), o Leaflet agenda um
// redesenho que roda sem canvas e estoura "Cannot read properties of undefined (reading 'clearRect')". O redesenho de um
// canvas que nao existe mais nao tem o que desenhar: so deve ser ignorado.

type Redrawable = { _redraw(): void; _ctx?: unknown; _redrawRequest?: number | null };
let applied = false;

export function guardCanvasRedraw(): void {
  if (applied) return;
  applied = true;
  const proto = Canvas.prototype as unknown as Redrawable;
  const original = proto._redraw;
  proto._redraw = function guarded(this: Redrawable) {
    if (!this._ctx) {
      this._redrawRequest = null;
      return;
    }
    original.call(this);
  };
}
