import { formatDateTime } from '../../lib/format';
import { formatMeters } from '../../lib/geo';
import { KIND_LABEL } from '../activities/labels';
import { ELEMENT_META } from '../elements/meta';

// Compara duas versoes de um registro (linhas do servidor, em snake_case) e conta o que mudou em portugues.

export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

/** Campos de controle: mudam a cada gravacao e nao dizem nada ao administrador. */
const IGNORED = new Set(['id', 'owner_id', 'created_by', 'created_at', 'updated_at', 'server_updated_at', 'updated_by', 'geom']);

const LABELS: Record<string, string> = {
  title: 'Título',
  kind: 'Tipo de atividade',
  os_number: 'Nº da OS',
  technician: 'Técnico',
  started_at: 'Início',
  ended_at: 'Fim',
  status: 'Situação',
  description: 'Descrição',
  materials: 'Materiais',
  deleted: 'Excluído',
  activity_id: 'Atividade',
  element_id: 'Elemento',
  type: 'Tipo',
  lat: 'Latitude',
  lng: 'Longitude',
  accuracy_m: 'Precisão',
  position_source: 'Origem da posição',
  code: 'Identificação',
  notes: 'Observações',
  cable_type: 'Tipo do cabo',
  fiber_count: 'Nº de fibras',
  vertices: 'Traçado',
  length_m: 'Traçado (metros)',
  reserve_m: 'Reservas (metros)',
  total_m: 'Total (metros)',
  taken_at: 'Foto tirada em',
  storage_path: 'Arquivo da foto',
  segment: 'Trecho',
};

const ATTR_LABELS: Record<string, string> = {
  owner: 'Dono do poste',
  ownerCode: 'Código na concessionária',
  capacity: 'Capacidade',
  splitter: 'Splitter',
  oltName: 'OLT',
  ponPort: 'Porta PON',
  trays: 'Bandejas',
  splices: 'Emendas',
  meters: 'Metros de reserva',
  cableId: 'Cabo ligado',
  problem: 'Problema',
  actionTaken: 'Ação realizada',
};

const WORDS: Record<string, string> = {
  concluida: 'Concluída',
  aberta: 'Aberta',
  gps: 'GPS',
  manual: 'Marcada no mapa',
  concessionaria: 'Concessionária',
  proprio: 'Próprio',
  outro: 'Outro',
  rompimento: 'Rompimento',
  atenuacao: 'Atenuação',
  poste_caido: 'Poste caído',
  caixa_danificada: 'Caixa danificada',
};

export const TABLE_LABEL: Record<string, string> = {
  activities: 'Atividade',
  elements: 'Elemento',
  cables: 'Cabo',
  photos: 'Foto',
  track_points: 'Ponto da trilha',
};

const EMPTY = 'vazio';

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return EMPTY;
  if (key === 'deleted') return v === true ? 'sim' : 'não';
  if (key === 'kind' && typeof v === 'string' && v in KIND_LABEL) return KIND_LABEL[v as keyof typeof KIND_LABEL];
  if (key === 'type' && typeof v === 'string' && v in ELEMENT_META) return ELEMENT_META[v as keyof typeof ELEMENT_META].label;
  if (key === 'lat' || key === 'lng') return Number(v).toFixed(6);
  if (key === 'accuracy_m') return `${Math.round(Number(v))} m`;
  if (key.endsWith('_m')) return formatMeters(Number(v));
  if (key.endsWith('_at') && typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? v : formatDateTime(t);
  }
  if (key === 'vertices' && Array.isArray(v)) return `${v.length} pontos`;
  if (key === 'materials' && Array.isArray(v)) {
    if (v.length === 0) return 'nenhum';
    return v.map((m: { item?: unknown; quantity?: unknown; unit?: unknown }) => `${String(m.item ?? '')} · ${String(m.quantity ?? '')} ${String(m.unit ?? '')}`.trim()).join('; ');
  }
  if (typeof v === 'string') return WORDS[v] ?? v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).replace('.', ',');
  return JSON.stringify(v);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** O que mudou de `before` para `after`, na ordem em que os campos aparecem. Sem mudanca visivel = lista vazia. */
export function diffRecords(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const out: FieldChange[] = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    if (IGNORED.has(key) || same(before[key], after[key])) continue;
    if (key === 'attrs') {
      const b = (before.attrs ?? {}) as Record<string, unknown>;
      const a = (after.attrs ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (same(b[k], a[k])) continue;
        out.push({ label: ATTR_LABELS[k] ?? k, before: show(k, b[k]), after: show(k, a[k]) });
      }
      continue;
    }
    const b = show(key, before[key]);
    const a = show(key, after[key]);
    // ex.: o traco continua com 3 pontos, mas um deles mudou de lugar
    out.push({ label: LABELS[key] ?? key, before: b, after: a === b ? `${a} (posições alteradas)` : a });
  }
  return out;
}

/** O que foi feito, em uma palavra: excluir e restaurar valem mais que os outros detalhes. */
export function changeVerb(before: Record<string, unknown>, after: Record<string, unknown>): 'Excluiu' | 'Restaurou' | 'Alterou' {
  if (before.deleted !== true && after.deleted === true) return 'Excluiu';
  if (before.deleted === true && after.deleted !== true) return 'Restaurou';
  return 'Alterou';
}

/** Nome curto do registro para a lista (ex.: "Poste P-001", "Cabo AS-80 · 12 fibras", "Atividade Rua X"). */
export function recordTitle(table: string, row: Record<string, unknown>): string {
  const base = TABLE_LABEL[table] ?? table;
  switch (table) {
    case 'activities':
      return `${base} ${String(row.title ?? '')}`.trim();
    case 'elements': {
      const type = typeof row.type === 'string' && row.type in ELEMENT_META ? ELEMENT_META[row.type as keyof typeof ELEMENT_META].label : base;
      return `${type}${row.code ? ' ' + String(row.code) : ''}`;
    }
    case 'cables':
      return `${base} ${String(row.cable_type ?? '')} · ${String(row.fiber_count ?? '')} fibras`.trim();
    default:
      return base;
  }
}
