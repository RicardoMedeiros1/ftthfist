import type { PlanLine, PlanPoint, PlanPointType, ProjectPlan } from '../../db/types';
import { PLAN_LIMITS, isEmptyPlan } from './plan';

// As operacoes da tela de desenho, todas puras: cada uma devolve um desenho novo (ou o MESMO objeto quando nada mudou, para o
// historico nao guardar passos vazios). A tela so liga toques e cliques a estas funcoes.

export type Coord = [number, number];

/** O que esta escolhido no mapa. `vertex` = um ponto de dentro de um traçado. */
export type Selection = { kind: 'line'; id: string } | { kind: 'point'; id: string } | { kind: 'vertex'; lineId: string; index: number };

// ---------- historico (desfazer e refazer) ----------

export const HISTORY_LIMIT = 100;

export interface Editor {
  plan: ProjectPlan;
  past: ProjectPlan[];
  future: ProjectPlan[];
}

export const newEditor = (plan: ProjectPlan): Editor => ({ plan, past: [], future: [] });

/** Grava uma mudanca. Mudar de verdade apaga o "refazer"; "mudar" para o mesmo desenho nao grava nada. */
export function commit(e: Editor, next: ProjectPlan): Editor {
  if (next === e.plan) return e;
  return { plan: next, past: [...e.past, e.plan].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(e: Editor): Editor {
  const prev = e.past[e.past.length - 1];
  return prev ? { plan: prev, past: e.past.slice(0, -1), future: [e.plan, ...e.future] } : e;
}

export function redo(e: Editor): Editor {
  const [next, ...rest] = e.future;
  return next ? { plan: next, past: [...e.past, e.plan], future: rest } : e;
}

export const canUndo = (e: Editor) => e.past.length > 0;
export const canRedo = (e: Editor) => e.future.length > 0;

// ---------- coordenadas ----------

/** 7 casas decimais (cerca de 1 cm): mais que isso so engorda o desenho. */
export const roundCoord = (n: number): number => Math.round(n * 1e7) / 1e7;

const sameCoord = (a: Coord, b: Coord) => roundCoord(a[0]) === roundCoord(b[0]) && roundCoord(a[1]) === roundCoord(b[1]);

// ---------- limites ----------

export type Limit = 'linha' | 'ponto' | 'vertice';

/** Ja nao cabe mais um(a)? (a tela avisa em vez de deixar o banco recusar na hora de salvar) */
export function limitReached(plan: ProjectPlan, what: Limit, lineId?: string): boolean {
  if (what === 'linha') return plan.lines.length >= PLAN_LIMITS.lines;
  if (what === 'ponto') return plan.points.length >= PLAN_LIMITS.points;
  const line = plan.lines.find((l) => l.id === lineId);
  const total = plan.lines.reduce((n, l) => n + l.points.length, 0);
  return total >= PLAN_LIMITS.vertices || (line?.points.length ?? 0) >= PLAN_LIMITS.verticesPerLine;
}

export const LIMIT_TEXT: Record<Limit, string> = {
  linha: `O desenho já tem o máximo de traçados (${PLAN_LIMITS.lines}).`,
  ponto: `O desenho já tem o máximo de pontos (${PLAN_LIMITS.points}).`,
  vertice: 'O traçado não aceita mais pontos (limite do desenho).',
};

// ---------- pontos projetados ----------

export function addPoint(plan: ProjectPlan, id: string, type: PlanPointType, lat: number, lng: number): ProjectPlan {
  if (limitReached(plan, 'ponto') || plan.points.some((p) => p.id === id)) return plan;
  return { ...plan, points: [...plan.points, { id, type, lat: roundCoord(lat), lng: roundCoord(lng) }] };
}

const mapPoint = (plan: ProjectPlan, id: string, f: (p: PlanPoint) => PlanPoint): ProjectPlan => {
  const found = plan.points.find((p) => p.id === id);
  if (!found) return plan;
  const next = f(found);
  return next === found ? plan : { ...plan, points: plan.points.map((p) => (p === found ? next : p)) };
};

export const movePoint = (plan: ProjectPlan, id: string, lat: number, lng: number): ProjectPlan =>
  mapPoint(plan, id, (p) => (sameCoord([p.lat, p.lng], [lat, lng]) ? p : { ...p, lat: roundCoord(lat), lng: roundCoord(lng) }));

export const setPointType = (plan: ProjectPlan, id: string, type: PlanPointType): ProjectPlan => mapPoint(plan, id, (p) => (p.type === type ? p : { ...p, type }));

/** O codigo e cortado no limite e, vazio, deixa de existir (o ponto fica sem a chave). */
export function setPointCode(plan: ProjectPlan, id: string, code: string): ProjectPlan {
  const clean = code.trim().slice(0, PLAN_LIMITS.code);
  return mapPoint(plan, id, (p) => {
    if ((p.code ?? '') === clean) return p;
    const { code: _old, ...rest } = p;
    void _old;
    return clean ? { ...rest, code: clean } : rest;
  });
}

export function deletePoint(plan: ProjectPlan, id: string): ProjectPlan {
  return plan.points.some((p) => p.id === id) ? { ...plan, points: plan.points.filter((p) => p.id !== id) } : plan;
}

// ---------- traçados ----------

/** Um traçado novo, ainda com um ponto so (rascunho: ao terminar, o que ficou com menos de 2 pontos some). */
export function addLine(plan: ProjectPlan, id: string, lat: number, lng: number): ProjectPlan {
  if (limitReached(plan, 'linha') || plan.lines.some((l) => l.id === id)) return plan;
  return { ...plan, lines: [...plan.lines, { id, points: [[roundCoord(lat), roundCoord(lng)]] }] };
}

const mapLine = (plan: ProjectPlan, id: string, f: (l: PlanLine) => PlanLine): ProjectPlan => {
  const found = plan.lines.find((l) => l.id === id);
  if (!found) return plan;
  const next = f(found);
  return next === found ? plan : { ...plan, lines: plan.lines.map((l) => (l === found ? next : l)) };
};

/** Acrescenta no fim. Um toque repetido no mesmo lugar (duplo clique) nao cria ponto repetido. */
export function appendVertex(plan: ProjectPlan, lineId: string, lat: number, lng: number): ProjectPlan {
  if (limitReached(plan, 'vertice', lineId)) return plan;
  return mapLine(plan, lineId, (l) => {
    const last = l.points[l.points.length - 1];
    return last && sameCoord(last, [lat, lng]) ? l : { ...l, points: [...l.points, [roundCoord(lat), roundCoord(lng)]] };
  });
}

/** Insere ANTES da posicao `index` (0 = no comeco, tamanho = no fim). */
export function insertVertex(plan: ProjectPlan, lineId: string, index: number, lat: number, lng: number): ProjectPlan {
  if (limitReached(plan, 'vertice', lineId)) return plan;
  return mapLine(plan, lineId, (l) => {
    if (index < 0 || index > l.points.length) return l;
    return { ...l, points: [...l.points.slice(0, index), [roundCoord(lat), roundCoord(lng)], ...l.points.slice(index)] };
  });
}

export const moveVertex = (plan: ProjectPlan, lineId: string, index: number, lat: number, lng: number): ProjectPlan =>
  mapLine(plan, lineId, (l) => {
    const cur = l.points[index];
    if (!cur || sameCoord(cur, [lat, lng])) return l;
    return { ...l, points: l.points.map((p, i) => (i === index ? [roundCoord(lat), roundCoord(lng)] : p)) };
  });

export function deleteLine(plan: ProjectPlan, id: string): ProjectPlan {
  return plan.lines.some((l) => l.id === id) ? { ...plan, lines: plan.lines.filter((l) => l.id !== id) } : plan;
}

/** Apaga um ponto do traçado. Um traçado nao pode ficar com menos de 2 pontos: o ultimo par apaga o traçado inteiro. */
export function deleteVertex(plan: ProjectPlan, lineId: string, index: number): ProjectPlan {
  const line = plan.lines.find((l) => l.id === lineId);
  if (!line || index < 0 || index >= line.points.length) return plan;
  if (line.points.length <= 2) return deleteLine(plan, lineId);
  return mapLine(plan, lineId, (l) => ({ ...l, points: l.points.filter((_, i) => i !== index) }));
}

/** Terminou de desenhar: um traçado de um ponto so (rascunho) nao fica. */
export function finishLine(plan: ProjectPlan, lineId: string): ProjectPlan {
  const line = plan.lines.find((l) => l.id === lineId);
  return line && line.points.length < 2 ? deleteLine(plan, lineId) : plan;
}

/** Pontos de meio de cada trecho (a tela desenha uma alca ali para criar um ponto novo). `index` = onde inserir. */
export function midpoints(line: PlanLine): { index: number; lat: number; lng: number }[] {
  return line.points.slice(1).map((b, i) => ({ index: i + 1, lat: (line.points[i]![0] + b[0]) / 2, lng: (line.points[i]![1] + b[1]) / 2 }));
}

// ---------- ao salvar ----------

/** O que vai para o servidor: sem rascunhos de 1 ponto, sem pontos repetidos em sequencia, coordenadas arredondadas, codigo aparado. */
export function cleanPlan(plan: ProjectPlan): ProjectPlan {
  const lines: PlanLine[] = [];
  for (const l of plan.lines) {
    const pts: Coord[] = [];
    for (const [lat, lng] of l.points) {
      const c: Coord = [roundCoord(lat), roundCoord(lng)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) pts.push(c);
    }
    if (pts.length >= 2) lines.push({ id: l.id, points: pts });
  }
  const points = plan.points.map((p): PlanPoint => {
    const code = (p.code ?? '').trim().slice(0, PLAN_LIMITS.code);
    return { id: p.id, type: p.type, lat: roundCoord(p.lat), lng: roundCoord(p.lng), ...(code ? { code } : {}) };
  });
  return { lines, points };
}

/** O desenho mudou em relacao ao salvo? (compara o que seria enviado, entao rascunho e arredondamento nao contam) */
export const isDirty = (a: ProjectPlan, b: ProjectPlan): boolean => JSON.stringify(cleanPlan(a)) !== JSON.stringify(cleanPlan(b));

/** O que seria gravado: `null` quando nao sobrou nada (apaga o desenho no servidor). */
export function planToSave(plan: ProjectPlan): ProjectPlan | null {
  const clean = cleanPlan(plan);
  return isEmptyPlan(clean) ? null : clean;
}

/** Depois de desfazer/refazer, a escolha pode apontar para algo que nao existe mais: vira nenhuma. */
export function pruneSelection(sel: Selection | null, plan: ProjectPlan): Selection | null {
  if (!sel) return null;
  if (sel.kind === 'point') return plan.points.some((p) => p.id === sel.id) ? sel : null;
  if (sel.kind === 'line') return plan.lines.some((l) => l.id === sel.id) ? sel : null;
  const line = plan.lines.find((l) => l.id === sel.lineId);
  return line && sel.index < line.points.length ? sel : null;
}
