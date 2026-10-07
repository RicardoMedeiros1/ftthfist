import type { PlanLine, PlanPoint, ProjectPlan } from '../../db/types';
import type { Bounds } from '../map/mapCommands';
import type { ParsedLayer } from '../reference/kmlImport';
import { PLAN_LIMITS, cleanCode, emptyPlan, planBounds, vertexCount } from './plan';

// Importar um KML/KMZ para dentro do desenho do projeto. O arquivo e lido por `parseReferenceFile` (o mesmo das camadas de
// referencia); aqui so se escolhe o que serve para o desenho e se encaixa nos limites. Tudo puro e testado.
//   - linha  -> traçado (linha longa demais e partida em pedacos que se encostam)
//   - ponto  -> ponto do tipo "outro", com o nome do arquivo como codigo
//   - poligono (area) -> nao entra; so e contado para avisar

export type ImportMode = 'substituir' | 'acrescentar';

type Coord = [number, number];

/** O que o arquivo traz de aproveitavel, ainda sem id. Coordenadas ja em [lat, lng]. */
export interface PlanImport {
  lines: Coord[][];
  points: { lat: number; lng: number; code: string }[];
  /** Areas do arquivo (nao entram no desenho). */
  polygons: number;
  /** Elementos sem coordenadas validas (ou que sobraram com 1 ponto so). */
  skipped: number;
}

/** Quebra uma linha com pontos demais em pedacos de ate `max` pontos; cada pedaco comeca onde o anterior terminou. */
export function splitLine(points: Coord[], max: number = PLAN_LIMITS.verticesPerLine): Coord[][] {
  if (points.length <= max) return [points];
  const out: Coord[][] = [];
  for (let start = 0; start < points.length - 1; start += max - 1) out.push(points.slice(start, start + max));
  return out;
}

/** Tira pontos repetidos em sequencia (o arquivo costuma trazer o mesmo ponto duas vezes). */
function dedupe(points: Coord[]): Coord[] {
  const out: Coord[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

export function planImportFromLayer(layer: ParsedLayer): PlanImport {
  const imp: PlanImport = { lines: [], points: [], polygons: 0, skipped: layer.skipped };
  for (const f of layer.features) {
    const g = f.geom;
    if (g.kind === 'polygon') {
      imp.polygons++;
    } else if (g.kind === 'point') {
      imp.points.push({ lat: g.coord[1], lng: g.coord[0], code: cleanCode(f.name) });
    } else {
      for (const part of g.parts) {
        const pts = dedupe(part.map(([lng, lat]): Coord => [lat, lng]));
        if (pts.length < 2) imp.skipped++;
        else imp.lines.push(...splitLine(pts));
      }
    }
  }
  return imp;
}

export const hasUsable = (imp: PlanImport): boolean => imp.lines.length > 0 || imp.points.length > 0;

export interface ImportOutcome {
  plan: ProjectPlan;
  addedLines: number;
  addedPoints: number;
  /** O que nao coube nos limites do desenho. */
  droppedLines: number;
  droppedPoints: number;
  /** [sul, oeste, norte, leste] do que entrou (null se nada entrou). */
  bounds: Bounds | null;
}

const bytesOf = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Junta o que veio do arquivo ao desenho. `substituir` descarta o desenho atual; `acrescentar` mantem. O que passa dos limites
 * (traçados, pontos, pontos de traçado, tamanho) e deixado de fora e contado, para o desenho resultante poder ser salvo sempre.
 */
export function applyImport(current: ProjectPlan, imp: PlanImport, mode: ImportMode, makeId: () => string): ImportOutcome {
  const base = mode === 'substituir' ? emptyPlan() : current;
  const taken = new Set([...base.lines.map((l) => l.id), ...base.points.map((p) => p.id)]);
  const fresh = (): string => {
    for (;;) {
      const id = makeId();
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  };

  const lines: PlanLine[] = [...base.lines];
  const points: PlanPoint[] = [...base.points];
  const addedLines: PlanLine[] = [];
  const addedPoints: PlanPoint[] = [];
  let vertices = vertexCount(base);
  let bytes = bytesOf(base);
  let droppedLines = 0;
  let droppedPoints = 0;

  for (const pts of imp.lines) {
    const line: PlanLine = { id: fresh(), points: pts };
    const size = bytesOf(line) + 1; // +1: a virgula
    if (lines.length >= PLAN_LIMITS.lines || vertices + pts.length > PLAN_LIMITS.vertices || bytes + size > PLAN_LIMITS.bytes) {
      droppedLines++;
      continue;
    }
    lines.push(line);
    addedLines.push(line);
    vertices += pts.length;
    bytes += size;
  }
  for (const p of imp.points) {
    const point: PlanPoint = { id: fresh(), type: 'outro', lat: p.lat, lng: p.lng, ...(p.code ? { code: p.code } : {}) };
    const size = bytesOf(point) + 1;
    if (points.length >= PLAN_LIMITS.points || bytes + size > PLAN_LIMITS.bytes) {
      droppedPoints++;
      continue;
    }
    points.push(point);
    addedPoints.push(point);
    bytes += size;
  }
  return {
    plan: { lines, points },
    addedLines: addedLines.length,
    addedPoints: addedPoints.length,
    droppedLines,
    droppedPoints,
    bounds: planBounds({ lines: addedLines, points: addedPoints }),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** O que a tela diz depois de importar. */
export function importMessage(out: ImportOutcome, imp: PlanImport): string {
  const added: string[] = [];
  if (out.addedLines > 0) added.push(plural(out.addedLines, 'traçado', 'traçados'));
  if (out.addedPoints > 0) added.push(plural(out.addedPoints, 'ponto', 'pontos'));
  const parts = [added.length ? `Importado: ${added.join(' e ')}.` : 'Nada foi importado.'];
  if (imp.polygons > 0) parts.push(`${plural(imp.polygons, 'área (polígono) não entra', 'áreas (polígonos) não entram')} no desenho.`);
  if (imp.skipped > 0) parts.push(`${plural(imp.skipped, 'elemento sem coordenadas válidas foi ignorado', 'elementos sem coordenadas válidas foram ignorados')}.`);
  const dropped = out.droppedLines + out.droppedPoints;
  if (dropped > 0) parts.push(`${plural(dropped, 'item não coube', 'itens não couberam')} no limite do desenho.`);
  if (added.length) parts.push('Confira no mapa e toque em “Salvar desenho”.');
  return parts.join(' ');
}

/** Por que o arquivo nao serve, quando nao tem traçado nem ponto. */
export function noUsableText(imp: PlanImport): string {
  return imp.polygons > 0
    ? 'O arquivo só tem áreas (polígonos), e elas não entram no desenho. Só traçados (linhas) e pontos são importados.'
    : 'O arquivo não tem traçados (linhas) nem pontos utilizáveis.';
}
