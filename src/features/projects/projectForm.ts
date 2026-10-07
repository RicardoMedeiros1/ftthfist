import type { ActivityKind } from '../../db/types';
import type { Project, ProjectInput } from './types';

// O formulario do administrador: tudo e texto na tela; aqui se confere e se converte no que vai para o servidor.

export interface ProjectForm {
  title: string;
  kind: ActivityKind;
  osNumber: string;
  assignedTo: string;
  description: string;
  address: string;
  /** Coordenadas coladas (ex.: do Google Maps). Vazio = sem ponto no mapa. */
  coords: string;
  /** `AAAA-MM-DD` (campo de data) ou vazio. */
  dueDate: string;
}

export const TITLE_MAX = 120;

export const emptyForm = (assignedTo = ''): ProjectForm => ({ title: '', kind: 'implantacao', osNumber: '', assignedTo, description: '', address: '', coords: '', dueDate: '' });

export const formatCoordinates = (lat: number, lng: number): string => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

export function formFromProject(p: Project): ProjectForm {
  return {
    title: p.title,
    kind: p.kind,
    osNumber: p.osNumber ?? '',
    assignedTo: p.assignedTo,
    description: p.description,
    address: p.address,
    coords: p.lat !== undefined && p.lng !== undefined ? formatCoordinates(p.lat, p.lng) : '',
    dueDate: p.dueDate ?? '',
  };
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const NUM_COMMA = String.raw`-?\d+,\d+`;
const inRange = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Entende o que o escritorio cola do Google Maps (ou digita): "-23.5505, -46.6333", "-23,5505; -46,6333",
 * "-23.5505 -46.6333" ou um link (`@lat,lng`, `!3d..!4d..`, `?q=lat,lng`, `ll=`). Fora do mundo ou ilegivel = null.
 */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const t = text.replace(/[−–—]/g, '-').trim().replace(/^[([]\s*|\s*[)\]]$/g, '');
  if (!t) return null;
  const pair = (a: string, b: string) => {
    const lat = Number(a.replace(',', '.'));
    const lng = Number(b.replace(',', '.'));
    return inRange(lat, lng) ? { lat, lng } : null;
  };
  if (/^https?:\/\//i.test(t)) {
    const m =
      new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`).exec(t) ??
      new RegExp(String.raw`@(${NUM}),(${NUM})`).exec(t) ??
      new RegExp(String.raw`[?&](?:q|ll|query|destination|center)=(${NUM})(?:,|%2C)(${NUM})`, 'i').exec(t);
    return m ? pair(m[1]!, m[2]!) : null;
  }
  let m = new RegExp(`^(${NUM})\\s*(?:,|;|\\s)\\s*(${NUM})$`).exec(t); // 1 ponto como decimal
  if (m) return pair(m[1]!, m[2]!);
  m = new RegExp(`^(${NUM_COMMA}|${NUM})\\s*;\\s*(${NUM_COMMA}|${NUM})$`).exec(t); // virgula decimal, separada por ponto e virgula
  if (m) return pair(m[1]!, m[2]!);
  m = new RegExp(`^(${NUM_COMMA})\\s*(?:,\\s*|\\s+)(${NUM_COMMA})$`).exec(t); // virgula decimal, separada por virgula e espaco ou so espaco
  return m ? pair(m[1]!, m[2]!) : null;
}

/** `2026-02-30` nao existe; o campo de data do navegador ja evita, mas texto colado ou um navegador antigo nao. */
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  // dia que nao existe "escorrega" para o mes seguinte (30/02 vira 02/03), entao a data nao volta igual
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === s;
}

export type FormErrors = Partial<Record<'title' | 'assignedTo' | 'coords' | 'dueDate', string>>;

export function validateForm(f: ProjectForm): { ok: true; input: ProjectInput } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const title = f.title.trim();
  if (!title) errors.title = 'Escreva o nome do projeto.';
  else if (title.length > TITLE_MAX) errors.title = `Use até ${TITLE_MAX} letras no nome.`;
  if (!f.assignedTo) errors.assignedTo = 'Escolha o técnico responsável.';
  const point = f.coords.trim() ? parseCoordinates(f.coords) : undefined;
  if (point === null) errors.coords = 'Não entendi as coordenadas. Cole como aparecem no Google Maps, por exemplo -23.5505, -46.6333.';
  const due = f.dueDate.trim();
  if (due && !isRealDate(due)) errors.dueDate = 'Data inválida.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const os = f.osNumber.trim();
  return {
    ok: true,
    input: {
      assignedTo: f.assignedTo,
      title,
      kind: f.kind,
      ...(os ? { osNumber: os } : {}),
      description: f.description.trim(),
      address: f.address.trim(),
      ...(point ? { lat: point.lat, lng: point.lng } : {}),
      ...(due ? { dueDate: due } : {}),
    },
  };
}
