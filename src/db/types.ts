// Modelo de dados local (ver CLAUDE.md). Nomes em inglês, valores de domínio em português.

export type SyncStatus = 'pending' | 'synced';

/** Campos comuns a todos os registros. */
export interface BaseRecord {
  id: string; // UUID gerado no aparelho
  createdAt: number; // epoch ms
  updatedAt: number;
  createdBy: string;
  deleted: boolean; // exclusão sempre lógica
  syncStatus: SyncStatus;
  /** Quem registrou (id da conta no servidor). Ausente = criado neste aparelho antes de haver conta. */
  ownerId?: string;
}

export type ActivityKind = 'implantacao' | 'manutencao';
export type ActivityStatus = 'aberta' | 'concluida';

export interface Material {
  item: string;
  quantity: number;
  unit: string;
}

export interface Activity extends BaseRecord {
  kind: ActivityKind;
  title: string;
  osNumber?: string;
  technician: string;
  startedAt: number;
  endedAt?: number;
  status: ActivityStatus;
  description: string;
  materials: Material[];
}

export type ElementType = 'poste' | 'cto' | 'ceo' | 'reserva' | 'ocorrencia' | 'outro';
export type PositionSource = 'gps' | 'manual';

export type PosteOwner = 'concessionaria' | 'proprio' | 'outro';
export type OccurrenceProblem =
  | 'rompimento'
  | 'atenuacao'
  | 'poste_caido'
  | 'caixa_danificada'
  | 'outro';

export interface PosteAttrs {
  owner?: PosteOwner;
  ownerCode?: string;
}
export interface CtoAttrs {
  capacity?: number; // 8, 16…
  splitter?: string; // '1:8' | '1:16'…
  oltName?: string; // Fase 3
  ponPort?: string; // Fase 3
}
export interface CeoAttrs {
  trays?: number;
  splices?: number;
}
export interface ReservaAttrs {
  meters?: number;
  cableId?: string;
}
export interface OcorrenciaAttrs {
  problem?: OccurrenceProblem;
  actionTaken?: string;
}
export type OutroAttrs = Record<string, never>;

export interface ElementAttrsByType {
  poste: PosteAttrs;
  cto: CtoAttrs;
  ceo: CeoAttrs;
  reserva: ReservaAttrs;
  ocorrencia: OcorrenciaAttrs;
  outro: OutroAttrs;
}

export interface NetworkElement extends BaseRecord {
  type: ElementType;
  lat: number;
  lng: number;
  accuracy?: number; // metros; ausente quando a posição é manual
  positionSource: PositionSource;
  code: string; // identificação / plaqueta
  notes: string;
  activityId: string;
  attrs: ElementAttrsByType[ElementType];
}

export type CableType = 'drop' | 'AS-80' | 'AS-120' | 'outro';
export type FiberCount = 1 | 2 | 4 | 6 | 12 | 24 | 36 | 48 | 72 | 144;

export interface CableVertex {
  elementId?: string;
  lat: number;
  lng: number;
}

// Usado a partir da Fase 1B.
export interface Cable extends BaseRecord {
  cableType: string; // lista editável nas Configurações
  fiberCount: FiberCount;
  vertices: CableVertex[];
  lengthMeters: number;
  reserveMeters: number;
  totalMeters: number;
  activityId: string;
  notes: string;
}

export interface Photo extends BaseRecord {
  blob: Blob; // JPEG ~1600 px, qualidade ~0.7
  remoteUrl?: string; // Fase 2
  lat?: number;
  lng?: number;
  takenAt: number;
  elementId?: string;
  activityId: string;
}

// Usado a partir da Fase 1B.
export interface TrackPoint extends BaseRecord {
  activityId: string;
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  speed?: number;
  /** Trecho da gravação: pausar, retomar ou a tela apagar abre um trecho novo (não se liga com linha reta ao anterior). */
  segment?: number;
}

// ---- Camadas de referência (KML/KMZ importado) ----
// São dados de terceiros, só para consulta: ficam no aparelho e não entram no backup
// (dá para importar o arquivo de novo). Coordenadas sempre [lng, lat].

export type RefCoord = [number, number];

export type RefGeometry =
  | { kind: 'point'; coord: RefCoord }
  | { kind: 'line'; parts: RefCoord[][] }
  /** Só o anel externo de cada polígono (furos são ignorados). */
  | { kind: 'polygon'; rings: RefCoord[][] };

export interface ReferenceLayer extends BaseRecord {
  name: string;
  fileName: string;
  color: string;
  visible: boolean;
  counts: { points: number; lines: number; polygons: number };
  /** Elementos do arquivo que não puderam ser usados (sem coordenadas ou inválidos). */
  skipped: number;
  /** [sul, oeste, norte, leste] */
  bounds: [number, number, number, number];
  /** Índices (`n`) dos pontos já convertidos em elementos. */
  converted: number[];
}

export interface ReferenceFeature {
  id: string; // `${layerId}:${n}`
  layerId: string;
  n: number;
  /** Texto puro: nada do arquivo de terceiros é tratado como HTML. */
  name: string;
  description: string;
  props: [string, string][];
  geom: RefGeometry;
}

/** Configurações do aparelho (uma linha por chave). */
export interface SettingEntry {
  key: string;
  value: unknown;
}
