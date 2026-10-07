import type { PlanLine, PlanPoint, PlanPointType, ProjectPlan } from '../../db/types';
import { pathLengthMeters } from '../../lib/geo';
import type { Bounds } from '../map/mapCommands';

// O desenho do projeto (o que o administrador projetou no mapa): formato, limites, leitura segura do que vem do servidor e
// medidas. Puro e testado. Os mesmos limites estao no banco (migration 14); aqui sao um pouco mais folgados no tamanho
// para o que o app aceita nunca ser recusado pelo servidor.

export const PLAN_LIMITS = {
  lines: 200,
  points: 2000,
  /** Pontos de uma linha so. */
  verticesPerLine: 5000,
  /** Pontos de todas as linhas somados. */
  vertices: 20000,
  /** Letras do codigo de um ponto. */
  code: 60,
  /** Bytes do JSON no aparelho (o banco aceita ate 400000 no texto do jsonb, que e um pouco maior). */
  bytes: 300_000,
} as const;

export const PLAN_POINT_TYPES: readonly PlanPointType[] = ['poste', 'cto', 'ceo', 'reserva', 'outro'];

export const emptyPlan = (): ProjectPlan => ({ lines: [], points: [] });

export const isEmptyPlan = (p: ProjectPlan | null | undefined): boolean => !p || (p.lines.length === 0 && p.points.length === 0);

// (NaN e infinito falham nas comparacoes, entao nao precisam de teste a parte)
const coordOk = (lat: unknown, lng: unknown): boolean => typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export const vertexCount = (p: ProjectPlan): number => p.lines.reduce((n, l) => n + l.points.length, 0);

/** O texto em portugues do primeiro problema que impede de salvar o desenho; null = pode salvar. */
export function validatePlan(plan: ProjectPlan): string | null {
  if (plan.lines.length > PLAN_LIMITS.lines) return `O desenho tem traçados demais (o máximo é ${PLAN_LIMITS.lines}).`;
  if (plan.points.length > PLAN_LIMITS.points) return `O desenho tem pontos demais (o máximo é ${PLAN_LIMITS.points}).`;
  for (const l of plan.lines) {
    if (l.points.length < 2) return 'Todo traçado precisa de pelo menos 2 pontos.';
    if (l.points.length > PLAN_LIMITS.verticesPerLine) return `Um traçado tem pontos demais (o máximo é ${PLAN_LIMITS.verticesPerLine}).`;
    if (l.points.some((v) => !Array.isArray(v) || v.length !== 2 || !coordOk(v[0], v[1]))) return 'Há um ponto de traçado fora do mapa (coordenada inválida).';
  }
  if (vertexCount(plan) > PLAN_LIMITS.vertices) return `O desenho tem pontos de traçado demais (o máximo é ${PLAN_LIMITS.vertices}).`;
  for (const p of plan.points) {
    if (!PLAN_POINT_TYPES.includes(p.type)) return 'Há um ponto com tipo inválido.';
    if (!coordOk(p.lat, p.lng)) return 'Há um ponto fora do mapa (coordenada inválida).';
    if (p.code !== undefined && (typeof p.code !== 'string' || p.code.length > PLAN_LIMITS.code)) return `O código de um ponto passa de ${PLAN_LIMITS.code} letras.`;
  }
  if (new TextEncoder().encode(JSON.stringify(plan)).length > PLAN_LIMITS.bytes) return 'O desenho ficou grande demais para enviar. Simplifique o traçado ou apague o que não precisa.';
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Le o desenho que veio do servidor (ou de um arquivo), com cuidado: o que nao for valido e deixado de fora em vez de derrubar a
 * tela. Devolve null quando nao ha nada aproveitavel (sem desenho, formato errado ou tudo invalido).
 */
export function parsePlan(raw: unknown): ProjectPlan | null {
  if (!isObj(raw)) return null;
  const lines: PlanLine[] = [];
  if (Array.isArray(raw.lines)) {
    raw.lines.slice(0, PLAN_LIMITS.lines).forEach((l, i) => {
      if (!isObj(l) || !Array.isArray(l.points)) return;
      const points = l.points.filter((v): v is [number, number] => Array.isArray(v) && v.length === 2 && coordOk(v[0], v[1])).slice(0, PLAN_LIMITS.verticesPerLine);
      if (points.length >= 2) lines.push({ id: typeof l.id === 'string' && l.id ? l.id : `linha-${i}`, points: points.map(([a, b]) => [a, b]) });
    });
  }
  const points: PlanPoint[] = [];
  if (Array.isArray(raw.points)) {
    raw.points.slice(0, PLAN_LIMITS.points).forEach((p, i) => {
      if (!isObj(p) || !PLAN_POINT_TYPES.includes(p.type as PlanPointType) || !coordOk(p.lat, p.lng)) return;
      const code = typeof p.code === 'string' ? p.code.slice(0, PLAN_LIMITS.code) : '';
      points.push({
        id: typeof p.id === 'string' && p.id ? p.id : `ponto-${i}`,
        type: p.type as PlanPointType,
        lat: p.lat as number,
        lng: p.lng as number,
        ...(code ? { code } : {}),
      });
    });
  }
  const plan = { lines, points };
  return isEmptyPlan(plan) ? null : plan;
}

/** [sul, oeste, norte, leste] do desenho todo (linhas e pontos); null se estiver vazio. */
export function planBounds(plan: ProjectPlan): Bounds | null {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  const take = (lat: number, lng: number) => {
    s = Math.min(s, lat);
    n = Math.max(n, lat);
    w = Math.min(w, lng);
    e = Math.max(e, lng);
  };
  for (const l of plan.lines) for (const [lat, lng] of l.points) take(lat, lng);
  for (const p of plan.points) take(p.lat, p.lng);
  return Number.isFinite(s) ? [s, w, n, e] : null;
}

/** Comprimento do traçado em metros (so em linha reta entre os pontos, como o do cabo). */
export const lineMeters = (l: PlanLine): number => pathLengthMeters(l.points.map(([lat, lng]) => ({ lat, lng })));

export const planMeters = (plan: ProjectPlan): number => plan.lines.reduce((m, l) => m + lineMeters(l), 0);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 traçados (340 m) e 5 pontos" / "Sem desenho". */
export function planSummary(plan: ProjectPlan | null | undefined): string {
  if (!plan || isEmptyPlan(plan)) return 'Sem desenho';
  const parts: string[] = [];
  if (plan.lines.length > 0) parts.push(`${plural(plan.lines.length, 'traçado', 'traçados')} (${Math.round(planMeters(plan))} m)`);
  if (plan.points.length > 0) parts.push(plural(plan.points.length, 'ponto', 'pontos'));
  return parts.join(' e ');
}
