import type { ActivityKind } from '../../db/types';

// Projeto designado: o administrador cria, o tecnico executa (as atividades dele ficam ligadas ao projeto).

/** O que o administrador grava. `concluido` marcado a mao vale mesmo sem atividade concluida. */
export type ProjectStatus = 'aberto' | 'concluido' | 'cancelado';

/** O que se mostra: mistura o que o administrador marcou com o andamento das atividades ligadas. */
export type ProjectState = 'pendente' | 'em_andamento' | 'concluido' | 'cancelado';

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
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
  /** Texto `server_updated_at` da ultima versao conhecida (cursor da sincronizacao). */
  serverUpdatedAt?: string;
}

/** O que o administrador preenche (o servidor cuida do resto). */
export interface ProjectInput {
  assignedTo: string;
  title: string;
  kind: ActivityKind;
  osNumber?: string;
  description: string;
  address: string;
  lat?: number;
  lng?: number;
  dueDate?: string;
}

/** O que importa de uma atividade ligada para saber como o projeto esta. */
export interface LinkedActivity {
  id: string;
  title: string;
  technician: string;
  status: 'aberta' | 'concluida';
  completesProject: boolean;
  deleted: boolean;
  startedAt?: number;
}
