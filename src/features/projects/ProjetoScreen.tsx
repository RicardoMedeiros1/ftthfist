import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import ScreenShell from '../../components/ScreenShell';
import type { ActivityKind } from '../../db/types';
import { formatDateTime } from '../../lib/format';
import { goBack, navigate, useRoute, useRouteId } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { useAccount } from '../account/accountStore';
import { KIND_LABEL } from '../activities/labels';
import type { Person } from '../admin/adminApi';
import { adminApi } from '../admin/adminRuntime';
import { adminErrorText } from '../admin/people';
import { useAdminData } from '../admin/useAdminData';
import { assignable, roleSuffix } from './assignable';
import { emptyForm, formFromProject, formatCoordinates, parseCoordinates, validateForm, TITLE_MAX, type FormErrors, type ProjectForm } from './projectForm';
import { patchFromInput } from './projectRows';
import { formatDueDate, isOverdue, projectState, STATE_LABEL } from './projectState';
import type { LinkedActivity, Project } from './types';
import './projects.css';

type Ask = { kind: 'concluir' | 'cancelar' | 'reabrir' | 'excluir' | 'restaurar' } | { kind: 'reatribuir'; to: string };

const nameOf = (people: readonly Person[], id: string) => {
  const p = people.find((x) => x.id === id);
  return p ? p.fullName || p.email : 'o técnico';
};

function confirmFor(ask: Ask, project: Project | null, people: readonly Person[], linked: readonly LinkedActivity[]) {
  switch (ask.kind) {
    case 'concluir':
      return { title: 'Marcar como concluído?', message: 'O projeto aparece como concluído para o técnico e o escritório, mesmo sem uma atividade que o encerre. Dá para reabrir depois.', confirmLabel: 'Marcar como concluído', danger: false };
    case 'cancelar':
      return { title: 'Cancelar o projeto?', message: 'Ele deixa de aparecer como tarefa para o técnico. As atividades que já foram feitas continuam como estão. Dá para reabrir depois.', confirmLabel: 'Cancelar o projeto', danger: true };
    case 'reabrir':
      return { title: 'Reabrir o projeto?', message: 'Ele volta a aparecer como tarefa para o técnico.', confirmLabel: 'Reabrir', danger: false };
    case 'restaurar':
      return { title: 'Restaurar o projeto?', message: 'Ele volta às listas do administrador, do escritório e do técnico responsável.', confirmLabel: 'Restaurar', danger: false };
    case 'excluir':
      return { title: 'Excluir o projeto?', message: 'Ele some das listas do técnico e do escritório. As atividades que já foram feitas continuam e nada é apagado do servidor.', confirmLabel: 'Excluir', danger: true };
    case 'reatribuir': {
      const from = project ? nameOf(people, project.assignedTo) : 'o técnico atual';
      return {
        title: `Passar para ${nameOf(people, ask.to)}?`,
        message: `${nameOf(people, ask.to)} passa a ver o projeto e ${from} deixa de ver. ${linked.length === 1 ? 'A atividade que já foi feita continua' : `As ${linked.length} atividades que já foram feitas continuam`} com ${from}.`,
        confirmLabel: 'Passar o projeto',
        danger: false,
      };
    }
  }
}

/** Criar ou editar um projeto designado (e cancelar, concluir, reabrir ou excluir). Exige internet e um administrador ativo. */
export default function ProjetoScreen() {
  const route = useRoute();
  const id = useRouteId();
  const isNew = route === 'projeto-novo';
  const online = useOnlineStatus();
  const isAdmin = useAccount((a) => a.status === 'ativo' && a.profile?.role === 'admin');
  const draftId = useRef(crypto.randomUUID()); // o mesmo id em toda tentativa: repetir o envio nunca cria dois
  const data = useAdminData(async () => {
    if (!adminApi) return null;
    const [people, projects] = await Promise.all([adminApi.listPeople(), isNew ? Promise.resolve([] as Project[]) : adminApi.listProjects()]);
    const project = isNew ? null : (projects.find((p) => p.id === id) ?? null);
    const linked = project ? ((await adminApi.linkedActivities([project.id])).get(project.id) ?? []) : [];
    return { people, project, linked };
  }, [id, isNew]);
  const [form, setForm] = useState<ProjectForm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => goBack('projetos');
  const loaded = data.data;

  // preenche o formulario uma vez por projeto; recarregar depois de cancelar/concluir nao apaga o que esta sendo digitado
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const key = isNew ? 'novo' : (loaded.project?.id ?? 'nenhum');
    if (filledFor.current === key) return;
    filledFor.current = key;
    setForm(loaded.project ? formFromProject(loaded.project) : emptyForm());
    setErrors({});
  }, [loaded, isNew]);

  const options = useMemo(() => {
    const list = assignable(loaded?.people ?? []);
    const current = loaded?.project?.assignedTo;
    // o tecnico atual pode ter perdido o acesso: continua na lista, avisando, para o formulario nao "trocar" sem querer
    if (current && !list.some((p) => p.id === current)) {
      const gone = loaded?.people.find((p) => p.id === current);
      return [...list.map((p) => ({ id: p.id, label: `${p.fullName || p.email}${roleSuffix(p)}` })), { id: current, label: `${gone?.fullName || gone?.email || 'Técnico'} (sem acesso)` }];
    }
    return list.map((p) => ({ id: p.id, label: `${p.fullName || p.email}${roleSuffix(p)}` }));
  }, [loaded]);

  if (!isAdmin || !adminApi) {
    return (
      <ScreenShell title="Projeto" onBack={back}>
        <div className="alert" role="alert">Esta tela é só para administradores.</div>
      </ScreenShell>
    );
  }

  const project = loaded?.project ?? null;
  const linked = loaded?.linked ?? [];
  const state = project ? projectState(project, linked) : null;
  const title = isNew ? 'Novo projeto' : 'Projeto';

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  function save(skipAsk = false) {
    if (!form || !adminApi) return;
    const checked = validateForm(form);
    setErrors(checked.ok ? {} : checked.errors);
    if (!checked.ok) return;
    if (!skipAsk && project && checked.input.assignedTo !== project.assignedTo && linked.length > 0) {
      setAsk({ kind: 'reatribuir', to: checked.input.assignedTo });
      return;
    }
    const api = adminApi;
    void run(async () => {
      if (isNew) await api.createProject(draftId.current, checked.input);
      else if (project) await api.updateProject(project.id, patchFromInput(checked.input));
      back();
    });
  }

  function confirmAsk() {
    const a = ask;
    setAsk(null);
    if (!a || !adminApi) return;
    if (a.kind === 'reatribuir') return save(true);
    if (!project) return;
    const api = adminApi;
    const patch = { concluir: { status: 'concluido' as const }, cancelar: { status: 'cancelado' as const }, reabrir: { status: 'aberto' as const }, excluir: { deleted: true }, restaurar: { deleted: false } }[a.kind];
    void run(async () => {
      await api.updateProject(project.id, patch);
      if (a.kind === 'excluir') back();
      else data.reload();
    });
  }

  const set = (patch: Partial<ProjectForm>) => form && setForm({ ...form, ...patch });
  const point = form?.coords.trim() ? parseCoordinates(form.coords) : undefined;

  return (
    <ScreenShell title={title} onBack={back}>
      {!online && <div className="alert" role="alert">Sem internet. Para criar ou alterar projetos é preciso estar conectado.</div>}
      {data.error && <div className="alert" role="alert">{data.error}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {!isNew && loaded && !project && <div className="alert" role="alert">Projeto não encontrado. Volte e atualize a lista.</div>}
      {project?.deleted && (
        <div className="alert" role="status">
          Este projeto foi excluído. Ele não aparece para ninguém.
          <button className="btn btn-block" disabled={busy || !online} onClick={() => setAsk({ kind: 'restaurar' })}>Restaurar projeto</button>
        </div>
      )}
      {form && (isNew || (project && !project.deleted)) && (
        <form
          className="screen-body"
          style={{ padding: 0 }}
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="field">
            <label htmlFor="proj-title">Nome do projeto</label>
            <input id="proj-title" type="text" value={form.title} maxLength={TITLE_MAX + 20} placeholder="Ex.: Rua das Flores, bairro Centro" onChange={(e) => set({ title: e.target.value })} aria-invalid={Boolean(errors.title)} />
            {errors.title && <p className="field-error" role="alert">{errors.title}</p>}
          </div>
          <div className="field">
            <span className="label" id="proj-kind-label">Tipo</span>
            <div className="seg" role="group" aria-labelledby="proj-kind-label">
              {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
                <button type="button" key={k} aria-pressed={form.kind === k} onClick={() => set({ kind: k })}>{KIND_LABEL[k]}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="proj-tech">Técnico responsável</label>
            <select id="proj-tech" value={form.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })} aria-invalid={Boolean(errors.assignedTo)}>
              <option value="">Escolha…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            {errors.assignedTo && <p className="field-error" role="alert">{errors.assignedTo}</p>}
          </div>
          <div className="field">
            <label htmlFor="proj-os">Nº da OS (opcional)</label>
            <input id="proj-os" type="text" value={form.osNumber} onChange={(e) => set({ osNumber: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="proj-desc">Instruções para o técnico</label>
            <textarea id="proj-desc" rows={4} value={form.description} placeholder="O que fazer, material, cuidados…" onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="proj-addr">Endereço ou referência</label>
            <input id="proj-addr" type="text" value={form.address} placeholder="Rua, número, ponto de referência" onChange={(e) => set({ address: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="proj-coords">Ponto no mapa (opcional)</label>
            <input id="proj-coords" type="text" inputMode="text" autoComplete="off" value={form.coords} placeholder="-23.5505, -46.6333" onChange={(e) => set({ coords: e.target.value })} aria-invalid={Boolean(errors.coords)} />
            <p className="hint">No Google Maps, toque e segure no local e copie as coordenadas (ou cole o link do local). O técnico vê o ponto no mapa.</p>
            {point && (
              <p className="coords-read">
                Entendi: {formatCoordinates(point.lat, point.lng)} ·{' '}
                <a href={`https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=18/${point.lat}/${point.lng}`} target="_blank" rel="noopener noreferrer">Conferir no mapa</a>
              </p>
            )}
            {errors.coords && <p className="field-error" role="alert">{errors.coords}</p>}
          </div>
          <div className="field">
            <label htmlFor="proj-due">Prazo (opcional)</label>
            <input id="proj-due" type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} aria-invalid={Boolean(errors.dueDate)} />
            {errors.dueDate && <p className="field-error" role="alert">{errors.dueDate}</p>}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !online}>{busy ? 'Salvando…' : isNew ? 'Criar projeto' : 'Salvar alterações'}</button>
        </form>
      )}

      {project && !project.deleted && state && (
        <>
          <section className="card" aria-label="Situação do projeto">
            <div className="card-title">
              Situação: <span className={`badge badge-state-${state}`}>{STATE_LABEL[state]}</span>
              {isOverdue(project, state, Date.now()) && <> <span className="badge badge-overdue">Atrasado</span></>}
            </div>
            <div className="card-meta">
              {project.dueDate ? `Prazo ${formatDueDate(project.dueDate)}. ` : ''}Criado em {formatDateTime(project.createdAt)}.
            </div>
            {state === 'concluido' && project.status === 'aberto' && (
              <p className="hint">Concluído porque uma atividade do técnico terminou o projeto. Para reabrir, abra essa atividade (na lista abaixo) e responda “Não” em “Com esta atividade o projeto terminou?”.</p>
            )}
            <div className="project-actions">
              {project.status === 'aberto' && state !== 'concluido' && <button className="btn btn-block" disabled={busy || !online} onClick={() => setAsk({ kind: 'concluir' })}>Marcar como concluído</button>}
              {project.status === 'aberto' && <button className="btn btn-danger btn-block" disabled={busy || !online} onClick={() => setAsk({ kind: 'cancelar' })}>Cancelar projeto</button>}
              {project.status !== 'aberto' && <button className="btn btn-block" disabled={busy || !online} onClick={() => setAsk({ kind: 'reabrir' })}>Reabrir projeto</button>}
            </div>
          </section>
          <section className="field" aria-label="Atividades do projeto">
            <span className="label">Atividades deste projeto ({linked.length})</span>
            {linked.length === 0 ? (
              <p className="hint">O técnico ainda não começou. Quando ele iniciar o projeto, a atividade aparece aqui.</p>
            ) : (
              <ul className="project-linked">
                {linked.map((a) => (
                  <li key={a.id}>
                    <button className="btn" onClick={() => navigate('atividade', { id: a.id })}>
                      {a.title} · {a.technician} · {a.status === 'concluida' ? 'concluída' : 'aberta'}{a.completesProject ? ' · terminou o projeto' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <button className="btn btn-danger btn-block" disabled={busy || !online} onClick={() => setAsk({ kind: 'excluir' })}>Excluir projeto</button>
        </>
      )}
      {ask && <ConfirmDialog {...confirmFor(ask, project, loaded?.people ?? [], linked)} onCancel={() => setAsk(null)} onConfirm={confirmAsk} />}
    </ScreenShell>
  );
}
