import { describe, expect, it } from 'vitest';
import { linkedFromRow, patchFromInput, projectFromRow, rowFromPatch } from './projectRows';
import type { ProjectPlan } from './types';

const row = {
  id: 'p1', owner_id: 'adm', assigned_to: 'u1', title: 'Rua X', kind: 'manutencao', os_number: 'OS-1', description: 'd', address: 'end',
  lat: -23.5, lng: -46.6, due_date: '2026-10-20', status: 'concluido', deleted: false,
  created_at: '2026-10-01T12:00:00+00:00', updated_at: '2026-10-02T12:00:00+00:00', server_updated_at: '2026-10-02T12:00:00.123456+00:00',
};

describe('projectFromRow', () => {
  it('traduz a linha completa', () => {
    expect(projectFromRow(row)).toEqual({
      id: 'p1', ownerId: 'adm', assignedTo: 'u1', title: 'Rua X', kind: 'manutencao', osNumber: 'OS-1', description: 'd', address: 'end',
      lat: -23.5, lng: -46.6, dueDate: '2026-10-20', status: 'concluido', deleted: false,
      createdAt: Date.parse('2026-10-01T12:00:00Z'), updatedAt: Date.parse('2026-10-02T12:00:00Z'), serverUpdatedAt: '2026-10-02T12:00:00.123456+00:00',
    });
  });
  it('campos opcionais vazios ficam ausentes (nada de null ou string vazia disfarcada)', () => {
    const p = projectFromRow({ ...row, os_number: null, lat: null, lng: null, due_date: null, status: 'aberto' });
    expect('osNumber' in p || 'lat' in p || 'lng' in p || 'dueDate' in p).toBe(false);
    expect(p.status).toBe('aberto');
    expect(projectFromRow({ ...row, os_number: '' }).osNumber).toBeUndefined();
  });
  it('so entra como ponto quando ha latitude E longitude', () => {
    const p = projectFromRow({ ...row, lng: null });
    expect('lat' in p || 'lng' in p).toBe(false);
  });
  it('valores desconhecidos viram os padroes (tipo implantacao, situacao aberto, nao excluido)', () => {
    expect(projectFromRow({ ...row, kind: 'x', status: 'y', deleted: null })).toMatchObject({ kind: 'implantacao', status: 'aberto', deleted: false });
    expect(projectFromRow({ ...row, status: 'cancelado', deleted: true })).toMatchObject({ status: 'cancelado', deleted: true });
  });
});

describe('patchFromInput / rowFromPatch', () => {
  it('o formulario completo: o que ficou vazio apaga (null) e o resto vai igual', () => {
    const patch = patchFromInput({ assignedTo: 'u2', title: 'T', kind: 'implantacao', description: '', address: '' });
    expect(patch).toEqual({ assignedTo: 'u2', title: 'T', kind: 'implantacao', osNumber: null, description: '', address: '', lat: null, lng: null, dueDate: null });
    expect(rowFromPatch(patch)).toEqual({ assigned_to: 'u2', title: 'T', kind: 'implantacao', os_number: null, description: '', address: '', lat: null, lng: null, due_date: null });
  });
  it('com valores', () => {
    const patch = patchFromInput({ assignedTo: 'u2', title: 'T', kind: 'manutencao', osNumber: 'OS', description: 'd', address: 'a', lat: 1, lng: 2, dueDate: '2026-10-20' });
    expect(rowFromPatch(patch)).toEqual({ assigned_to: 'u2', title: 'T', kind: 'manutencao', os_number: 'OS', description: 'd', address: 'a', lat: 1, lng: 2, due_date: '2026-10-20' });
  });
  it('um patch parcial manda so o que foi pedido (undefined nunca apaga); false e zero contam', () => {
    expect(rowFromPatch({ status: 'cancelado' })).toEqual({ status: 'cancelado' });
    expect(rowFromPatch({ deleted: false })).toEqual({ deleted: false });
    expect(rowFromPatch({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0 });
    expect(rowFromPatch({})).toEqual({});
    expect(rowFromPatch({ title: undefined })).toEqual({});
  });
  it('nunca manda dono, datas ou quem alterou (isso e do servidor)', () => {
    const keys = Object.keys(rowFromPatch({ ...patchFromInput({ assignedTo: 'u', title: 't', kind: 'implantacao', description: '', address: '' }), status: 'aberto', deleted: false }));
    for (const k of ['owner_id', 'id', 'created_at', 'updated_at', 'server_updated_at', 'updated_by']) expect(keys).not.toContain(k);
  });
});

describe('linkedFromRow', () => {
  it('traduz a atividade ligada', () => {
    expect(linkedFromRow({ id: 'a1', title: 'Trecho 1', technician: 'Ana', status: 'concluida', completes_project: true, deleted: false, started_at: '2026-10-05T10:00:00+00:00' })).toEqual({
      id: 'a1', title: 'Trecho 1', technician: 'Ana', status: 'concluida', completesProject: true, deleted: false, startedAt: Date.parse('2026-10-05T10:00:00Z'),
    });
  });
  it('padroes: aberta, nao termina o projeto, sem data se vier ilegivel', () => {
    const l = linkedFromRow({ id: 'a2', title: null, technician: null, status: 'x', started_at: 'lixo' });
    expect(l).toEqual({ id: 'a2', title: '', technician: '', status: 'aberta', completesProject: false, deleted: false });
  });
});

describe('desenho do projeto', () => {
  const plan: ProjectPlan = { lines: [{ id: 'l1', points: [[-23.55, -46.63], [-23.551, -46.631]] }], points: [{ id: 'p1', type: 'cto', lat: -23.55, lng: -46.63, code: 'CTO-1' }] };
  it('chega do servidor como desenho do projeto', () => {
    expect(projectFromRow({ ...row, plan }).plan).toEqual(plan);
  });
  it('sem desenho, nulo, vazio ou ilegivel: o campo fica ausente (nunca null nem objeto vazio)', () => {
    for (const bad of [undefined, null, {}, { lines: [], points: [] }, 'x', 7, { lines: 'a' }]) {
      const p = projectFromRow({ ...row, plan: bad });
      expect('plan' in p).toBe(false);
    }
  });
  it('um desenho com pedacos invalidos chega so com o que presta', () => {
    const p = projectFromRow({ ...row, plan: { lines: [{ id: 'a', points: [[0, 0]] }], points: [{ id: 'ok', type: 'poste', lat: 1, lng: 2 }, { id: 'ruim', type: 'x', lat: 1, lng: 2 }] } });
    expect(p.plan).toEqual({ lines: [], points: [{ id: 'ok', type: 'poste', lat: 1, lng: 2 }] });
  });
  it('o formulario comum NUNCA manda o desenho (editar o nome nao o apaga)', () => {
    const patch = patchFromInput({ assignedTo: 'u', title: 't', kind: 'implantacao', description: '', address: '' });
    expect('plan' in patch).toBe(false);
    expect('plan' in rowFromPatch(patch)).toBe(false);
  });
  it('a tela de desenho manda o desenho, ou null para apagar; undefined nao mexe', () => {
    expect(rowFromPatch({ plan })).toEqual({ plan });
    expect(rowFromPatch({ plan: null })).toEqual({ plan: null });
    expect(rowFromPatch({ plan: undefined })).toEqual({});
    expect(rowFromPatch({ title: 'x', plan })).toEqual({ title: 'x', plan });
  });
});
