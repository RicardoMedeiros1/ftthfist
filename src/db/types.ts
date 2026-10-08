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
  /** Quem fez a ultima alteracao no servidor (id da conta). Diferente do dono = alteracao do administrador. So vem do servidor. */
  updatedBy?: string;
  /** Marca de que o registro EXISTE no servidor (texto `server_updated_at` da ultima versao baixada). Registro criado aqui nao tem. */
  serverUpdatedAt?: string;
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
  /** Projeto designado de onde a atividade veio (ver features/projects). Ausente = atividade avulsa. */
  projectId?: string;
  /** Com esta atividade o tecnico terminou o projeto. So vale com `projectId`. */
  completesProject?: boolean;
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
  /** Cabo e fibra (a partir de 1) que alimentam esta CTO. Os dois juntos ou nenhum. */
  feedCableId?: string;
  feedFiber?: number;
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

/** Padrão de cores das fibras e dos tubos: ABNT (padrão do app) ou o internacional (TIA-598). */
export type ColorStandard = 'abnt' | 'tia598';

/** "Neste elemento, este cabo continua no cabo `cableId`" (os dois cabos passam pelo elemento). A ligação vale nos dois sentidos. */
export interface CableLink {
  elementId: string;
  cableId: string;
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
  /** Cores das fibras deste cabo. Ausente = ABNT. */
  colorStandard?: ColorStandard;
  /** Ligações com outros cabos (guardadas no cabo de quem as fez). Ausente = nenhuma. */
  links?: CableLink[];
}

export interface Photo extends BaseRecord {
  /**
   * JPEG ~1600 px, qualidade ~0.7. Ausente na foto de um colega (ou minha, de outro aparelho) que ainda nao foi
   * baixada: o registro chega pela sincronizacao e o arquivo so e baixado ao abrir o elemento.
   */
  blob?: Blob;
  /** Caminho no bucket `fotos` (`<dono>/<id>.jpg`). Preenchido quando o arquivo ja esta no servidor. */
  storagePath?: string;
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

// ---- Projetos designados ----
// O administrador cria o projeto e o entrega a um tecnico. No aparelho e so uma COPIA do servidor (nunca e enviada):
// por isso nao e um BaseRecord (sem syncStatus) e nao entra no backup (volta na proxima sincronizacao).

/** O que o administrador grava. `concluido` marcado a mao vale mesmo sem atividade concluida. */
export type ProjectStatus = 'aberto' | 'concluido' | 'cancelado';

/** Tipos de ponto que o administrador pode projetar (o que se marca no campo, menos ocorrencia). */
export type PlanPointType = 'poste' | 'cto' | 'ceo' | 'reserva' | 'outro';

/** Um traçado projetado (linha de cabo). Cada ponto e [latitude, longitude]. */
export interface PlanLine {
  id: string;
  points: [number, number][];
}

/** Um ponto projetado (poste, CTO...). */
export interface PlanPoint {
  id: string;
  type: PlanPointType;
  lat: number;
  lng: number;
  /** Codigo/plaqueta previsto (opcional). */
  code?: string;
}

/** O desenho do projeto: o que o administrador projetou no mapa para o tecnico seguir. Nunca vira cabo sozinho. */
export interface ProjectPlan {
  lines: PlanLine[];
  points: PlanPoint[];
}

export interface Project {
  id: string;
  /** Quem criou (administrador). */
  ownerId: string;
  /** Tecnico responsavel. */
  assignedTo: string;
  title: string;
  kind: ActivityKind;
  osNumber?: string;
  description: string;
  address: string;
  lat?: number;
  lng?: number;
  /** `AAAA-MM-DD`, dia local. */
  dueDate?: string;
  status: ProjectStatus;
  /** O que o administrador desenhou no mapa (ausente = sem desenho). */
  plan?: ProjectPlan;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
  /** Texto `server_updated_at` da ultima versao conhecida (cursor da sincronizacao). */
  serverUpdatedAt?: string;
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
