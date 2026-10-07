import { describe, expect, it } from 'vitest';
import { createSupabaseAdminApi } from './adminApi';

// A traducao dos erros do servidor para o que o app entende. (O comportamento contra o servidor de verdade esta em
// supabase/tests/admin-api.test.ts; aqui ficam as respostas que um Postgres local nao consegue produzir, como 503.)

type Reply = { data?: unknown; error?: { code?: string; message?: string } | null; status?: number };
const chain = (reply: Reply): unknown => {
  const q: Record<string, unknown> = {};
  const self = new Proxy(q, { get: (_t, k) => (k === 'then' ? (ok: (v: Reply) => unknown) => Promise.resolve(reply).then(ok) : () => self) });
  return self;
};
const apiReplying = (reply: Reply) => createSupabaseAdminApi({ from: () => chain(reply), rpc: () => chain(reply) } as never);

describe('erros do servidor viram o tipo certo', () => {
  const cases: [string, Reply, string][] = [
    ['sem resposta (fetch falhou)', { error: { message: 'Failed to fetch' }, status: 0 }, 'network'],
    ['servidor fora do ar (503)', { error: { message: 'down' }, status: 503 }, 'network'],
    ['muitas chamadas (429)', { error: { message: 'slow down' }, status: 429 }, 'network'],
    ['token vencido (401)', { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }, 'auth'],
    ['sem permissao (403)', { error: { message: 'no' }, status: 403 }, 'denied'],
    ['sem permissao (42501)', { error: { code: '42501', message: 'no' }, status: 400 }, 'denied'],
    ['ultimo administrador (23514)', { error: { code: '23514', message: 'precisa existir pelo menos um administrador ativo' }, status: 400 }, 'last-admin'],
    ['pedido invalido (400)', { error: { code: '22P02', message: 'bad' }, status: 400 }, 'other'],
  ];
  for (const [name, reply, kind] of cases) {
    it(name, async () => {
      await expect(apiReplying(reply).listPeople()).rejects.toMatchObject({ name: 'AdminError', kind });
    });
  }

  it('o mesmo vale para as demais chamadas (nao so listar pessoas)', async () => {
    const api = apiReplying({ error: { message: 'down' }, status: 503 });
    await expect(api.listEdits(5)).rejects.toMatchObject({ kind: 'network' });
    await expect(api.listConflicts(5)).rejects.toMatchObject({ kind: 'network' });
    await expect(api.names(['x'])).rejects.toMatchObject({ kind: 'network' });
    await expect(api.trackPage('a', 5)).rejects.toMatchObject({ kind: 'network' });
    await expect(api.setAccess('x', { active: true })).rejects.toMatchObject({ kind: 'network' });
  });

  it('alterar acesso sem nenhuma linha afetada = recusado pelo servidor (RLS), nao sucesso', async () => {
    await expect(apiReplying({ data: [], error: null, status: 200 }).setAccess('x', { active: true })).rejects.toMatchObject({ kind: 'denied' });
    await expect(apiReplying({ data: [{ id: 'x' }], error: null, status: 200 }).setAccess('x', { active: true })).resolves.toBeUndefined();
  });
});

describe('projetos: erros do servidor', () => {
  const input = { assignedTo: 'u1', title: 'T', kind: 'implantacao' as const, description: '', address: '' };

  it('regra do banco (23514) nos projetos e "invalid", nao "ultimo administrador"', async () => {
    const api = apiReplying({ error: { code: '23514', message: 'o projeto so pode ser designado a um tecnico' }, status: 400 });
    await expect(api.createProject('p', input)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.updateProject('p', { title: 'x' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.listProjects()).rejects.toMatchObject({ kind: 'invalid' });
    // a mesma resposta em outra chamada continua querendo dizer "ultimo administrador"
    await expect(api.setAccess('x', { active: false })).rejects.toMatchObject({ kind: 'last-admin' });
  });

  it('sem internet, sem permissao e sessao vencida', async () => {
    await expect(apiReplying({ error: { message: 'down' }, status: 503 }).createProject('p', input)).rejects.toMatchObject({ kind: 'network' });
    await expect(apiReplying({ error: { message: 'down' }, status: 0 }).listProjects()).rejects.toMatchObject({ kind: 'network' });
    await expect(apiReplying({ error: { code: '42501', message: 'rls' }, status: 403 }).createProject('p', input)).rejects.toMatchObject({ kind: 'denied' });
    await expect(apiReplying({ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }).updateProject('p', {})).rejects.toMatchObject({ kind: 'auth' });
    await expect(apiReplying({ error: { message: 'down' }, status: 503 }).linkedActivities(['a'])).rejects.toMatchObject({ kind: 'network' });
  });

  it('criar ou alterar sem nenhuma linha de volta = recusado (RLS), nao sucesso', async () => {
    await expect(apiReplying({ data: [], error: null, status: 201 }).createProject('p', input)).rejects.toMatchObject({ kind: 'denied' });
    await expect(apiReplying({ data: [], error: null, status: 200 }).updateProject('p', { title: 'x' })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('o texto para o administrador mostra que foram os dados', async () => {
    const { adminErrorText } = await import('./people');
    const err = await apiReplying({ error: { code: '23514', message: 'x' }, status: 400 }).createProject('p', input).catch((e: unknown) => e);
    expect(adminErrorText(err)).toContain('projeto');
  });
});
