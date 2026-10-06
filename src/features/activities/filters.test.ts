import { afterEach, describe, expect, it } from 'vitest';
import type { Activity } from '../../db/types';
import { setActingUser } from '../../lib/ownership';
import { DEFAULT_FILTERS, activeFilterCount, filterActivities, normalize, ownerOptions } from './filters';

const act = (over: Partial<Activity>): Activity => ({
  id: crypto.randomUUID(), createdAt: 1, updatedAt: 1, createdBy: 'x', deleted: false, syncStatus: 'synced',
  kind: 'implantacao', title: 'Rua A', technician: 'Ana', startedAt: 1, status: 'aberta', description: '', materials: [], ...over,
});

afterEach(() => setActingUser(null));

const list = () => [
  act({ title: 'Rua das Flores', ownerId: 'ana', technician: 'Ana Souza', startedAt: 10, osNumber: 'OS-1001' }),
  act({ title: 'Avenida Central', ownerId: 'bia', technician: 'Bia Lima', kind: 'manutencao', status: 'concluida', startedAt: 20, description: 'troca de CTO' }),
  act({ title: 'Manutenção da praça', ownerId: 'bia', technician: 'Bia L.', kind: 'manutencao', startedAt: 30 }),
  act({ title: 'Travessa', ownerId: 'davi', technician: 'Davi', startedAt: 5 }),
];

describe('filterActivities', () => {
  it('sem filtros devolve tudo', () => {
    expect(filterActivities(list(), DEFAULT_FILTERS)).toHaveLength(4);
  });

  it('por tipo e por situação', () => {
    expect(filterActivities(list(), { ...DEFAULT_FILTERS, kind: 'manutencao' }).map((a) => a.title)).toEqual(['Avenida Central', 'Manutenção da praça']);
    expect(filterActivities(list(), { ...DEFAULT_FILTERS, status: 'concluida' }).map((a) => a.title)).toEqual(['Avenida Central']);
    expect(filterActivities(list(), { ...DEFAULT_FILTERS, kind: 'manutencao', status: 'aberta' }).map((a) => a.title)).toEqual(['Manutenção da praça']);
  });

  it('por técnico: um específico, ou só as minhas', () => {
    setActingUser('ana');
    expect(filterActivities(list(), { ...DEFAULT_FILTERS, owner: 'bia' })).toHaveLength(2);
    expect(filterActivities(list(), { ...DEFAULT_FILTERS, owner: 'meus' }).map((a) => a.title)).toEqual(['Rua das Flores']);
  });

  it('a busca ignora acentos e maiúsculas e olha título, OS, técnico e descrição', () => {
    const f = (query: string) => filterActivities(list(), { ...DEFAULT_FILTERS, query }).map((a) => a.title);
    expect(f('manutencao')).toEqual(['Manutenção da praça']);
    expect(f('MANUTENÇÃO')).toEqual(['Manutenção da praça']);
    expect(f('os-1001')).toEqual(['Rua das Flores']);
    expect(f('lima')).toEqual(['Avenida Central']);
    expect(f('troca de cto')).toEqual(['Avenida Central']);
    expect(f('   ')).toHaveLength(4);
    expect(f('nao existe')).toEqual([]);
  });

  it('os filtros se combinam', () => {
    expect(filterActivities(list(), { owner: 'bia', kind: 'manutencao', status: 'concluida', query: 'central' })).toHaveLength(1);
    expect(filterActivities(list(), { owner: 'ana', kind: 'manutencao', status: 'todas', query: '' })).toEqual([]);
  });
});

describe('ownerOptions e contagem de filtros', () => {
  it('lista os outros técnicos, o com mais atividades primeiro, com o nome mais recente', () => {
    setActingUser('ana');
    expect(ownerOptions(list())).toEqual([
      { value: 'bia', label: 'Bia L.', count: 2 }, // o nome da atividade mais recente
      { value: 'davi', label: 'Davi', count: 1 },
    ]);
  });

  it('sem conta (tudo é meu) não há outros técnicos', () => {
    expect(ownerOptions(list())).toEqual([]);
  });

  it('activeFilterCount', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ owner: 'bia', kind: 'manutencao', status: 'aberta', query: ' x ' })).toBe(4);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, query: '   ' })).toBe(0);
  });

  it('normalize', () => {
    expect(normalize('Ação Çedilha ÁÉÍ')).toBe('acao cedilha aei');
  });
});
