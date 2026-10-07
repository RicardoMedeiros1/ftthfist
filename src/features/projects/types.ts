import type { ActivityKind } from '../../db/types';

// Projeto designado: o administrador cria, o tecnico executa (as atividades dele ficam ligadas ao projeto).
// O registro em si (`Project`) e a copia local do servidor e mora em db/types.

export type { Project, ProjectStatus } from '../../db/types';

/** O que se mostra: mistura o que o administrador marcou com o andamento das atividades ligadas. */
export type ProjectState = 'pendente' | 'em_andamento' | 'concluido' | 'cancelado';

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
