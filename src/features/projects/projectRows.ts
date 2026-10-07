import type { LinkedActivity, Project, ProjectInput, ProjectStatus } from './types';

// Traducao entre o projeto do app (camelCase) e a linha do servidor (snake_case).

type Row = Record<string, unknown>;

/** Campos que o administrador pode mudar; `null` apaga um campo opcional. */
export interface ProjectPatch {
  assignedTo?: string;
  title?: string;
  kind?: Project['kind'];
  osNumber?: string | null;
  description?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  dueDate?: string | null;
  status?: ProjectStatus;
  deleted?: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

export function projectFromRow(r: Row): Project {
  const lat = num(r.lat);
  const lng = num(r.lng);
  const os = str(r.os_number);
  const due = str(r.due_date);
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    assignedTo: String(r.assigned_to),
    title: String(r.title ?? ''),
    kind: r.kind === 'manutencao' ? 'manutencao' : 'implantacao',
    ...(os ? { osNumber: os } : {}),
    description: str(r.description) ?? '',
    address: str(r.address) ?? '',
    ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
    ...(due ? { dueDate: due } : {}),
    status: r.status === 'concluido' || r.status === 'cancelado' ? r.status : 'aberto',
    deleted: r.deleted === true,
    createdAt: Date.parse(String(r.created_at)),
    updatedAt: Date.parse(String(r.updated_at)),
    ...(str(r.server_updated_at) ? { serverUpdatedAt: str(r.server_updated_at)! } : {}),
  };
}

/** O formulario sempre manda o projeto inteiro: o que ficou vazio apaga o que havia (`null`). */
export function patchFromInput(input: ProjectInput): ProjectPatch {
  return {
    assignedTo: input.assignedTo,
    title: input.title,
    kind: input.kind,
    osNumber: input.osNumber ?? null,
    description: input.description,
    address: input.address,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    dueDate: input.dueDate ?? null,
  };
}

const COLUMN: Record<keyof ProjectPatch, string> = {
  assignedTo: 'assigned_to', title: 'title', kind: 'kind', osNumber: 'os_number', description: 'description', address: 'address',
  lat: 'lat', lng: 'lng', dueDate: 'due_date', status: 'status', deleted: 'deleted',
};

/** So os campos presentes (um `undefined` nunca vira "apagar"). */
export function rowFromPatch(patch: ProjectPatch): Row {
  const out: Row = {};
  for (const key of Object.keys(COLUMN) as (keyof ProjectPatch)[]) {
    if (patch[key] !== undefined) out[COLUMN[key]] = patch[key];
  }
  return out;
}

export function linkedFromRow(r: Row): LinkedActivity {
  const started = Date.parse(String(r.started_at));
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    technician: String(r.technician ?? ''),
    status: r.status === 'concluida' ? 'concluida' : 'aberta',
    completesProject: r.completes_project === true,
    deleted: r.deleted === true,
    ...(Number.isNaN(started) ? {} : { startedAt: started }),
  };
}
