import { describe, expect, it } from 'vitest';
import { emptyForm, formFromProject, formatCoordinates, isRealDate, parseCoordinates, validateForm, TITLE_MAX } from './projectForm';
import type { Project } from './types';

describe('parseCoordinates', () => {
  const ok: [string, string][] = [
    ['ponto decimal e virgula', '-23.5505, -46.6333'],
    ['sem espaco', '-23.5505,-46.6333'],
    ['so espaco', '-23.5505 -46.6333'],
    ['virgula decimal e ponto e virgula', '-23,5505; -46,6333'],
    ['virgula decimal, virgula e espaco', '-23,5505, -46,6333'],
    ['virgula decimal e so espaco', '-23,5505 -46,6333'],
    ['entre parenteses', '(-23.5505, -46.6333)'],
    ['sinal de menos tipografico', '−23.5505, −46.6333'],
    ['espacos nas pontas', '   -23.5505, -46.6333  '],
    ['link com @', 'https://www.google.com/maps/place/Rua/@-23.5505,-46.6333,17z/data=!3m1'],
    ['link com !3d!4d (vale o ponto marcado, nao o centro)', 'https://www.google.com/maps/place/X/@-10.1,-10.2,17z/data=!3d-23.5505!4d-46.6333'],
    ['link com ?q=', 'https://maps.google.com/?q=-23.5505,-46.6333'],
    ['link com ll=', 'https://maps.google.com/maps?foo=1&ll=-23.5505,-46.6333&z=17'],
    ['link com virgula codificada', 'https://www.google.com/maps?q=-23.5505%2C-46.6333'],
  ];
  for (const [name, text] of ok) it(`entende: ${name}`, () => expect(parseCoordinates(text)).toEqual({ lat: -23.5505, lng: -46.6333 }));

  it('inteiros e positivos', () => {
    expect(parseCoordinates('10, 20')).toEqual({ lat: 10, lng: 20 });
    expect(parseCoordinates('0, 0')).toEqual({ lat: 0, lng: 0 });
    expect(parseCoordinates('90, 180')).toEqual({ lat: 90, lng: 180 });
    expect(parseCoordinates('-90 -180')).toEqual({ lat: -90, lng: -180 });
  });

  const bad = ['', '   ', 'abc', '-23.5505', '-23.5505, -46.6333, 10', '91, 0', '0, 181', '-91 0', '23°33′S 46°38′W', 'https://example.com/sem-coordenadas', '-23,5505,-46,6333,1', '12.3.4, 5.6'];
  for (const text of bad) it(`recusa: "${text}"`, () => expect(parseCoordinates(text)).toBeNull());

  it('o formato mostrado volta a ser entendido (ida e volta)', () => {
    expect(parseCoordinates(formatCoordinates(-23.55052, -46.633309))).toEqual({ lat: -23.55052, lng: -46.633309 });
    expect(formatCoordinates(-23.5505, -46.6333)).toBe('-23.550500, -46.633300');
  });
});

describe('isRealDate', () => {
  it('aceita dias que existem e recusa o resto', () => {
    expect(isRealDate('2026-10-20')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true); // bissexto
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-04-31')).toBe(false);
    expect(isRealDate('2026-03-00')).toBe(false);
    expect(isRealDate('2026-02-00')).toBe(false);
    expect(isRealDate('2026-12-31')).toBe(true);
    expect(isRealDate('2026-01-01')).toBe(true);
    expect(isRealDate('2026-2-3')).toBe(false);
    expect(isRealDate('2026-00-10')).toBe(false);
    expect(isRealDate('20/10/2026')).toBe(false);
    expect(isRealDate('')).toBe(false);
  });
});

describe('validateForm', () => {
  const valid = { ...emptyForm('u1'), title: '  Rua das Flores  ' };

  it('o minimo e nome e tecnico; o resto vai limpo e sem campos vazios', () => {
    expect(validateForm(valid)).toEqual({ ok: true, input: { assignedTo: 'u1', title: 'Rua das Flores', kind: 'implantacao', description: '', address: '' } });
  });

  it('com tudo preenchido', () => {
    const r = validateForm({ title: 'Rua X', kind: 'manutencao', osNumber: ' OS-9 ', assignedTo: 'u2', description: ' trocar o cabo ', address: ' Rua X, 10 ', coords: '-23,5505; -46,6333', dueDate: '2026-10-20' });
    expect(r).toEqual({ ok: true, input: { assignedTo: 'u2', title: 'Rua X', kind: 'manutencao', osNumber: 'OS-9', description: 'trocar o cabo', address: 'Rua X, 10', lat: -23.5505, lng: -46.6333, dueDate: '2026-10-20' } });
  });

  it('sem nome, nome so de espacos, nome longo demais e sem tecnico', () => {
    expect(validateForm({ ...valid, title: '' })).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    expect(validateForm({ ...valid, title: '   ' })).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    expect(validateForm({ ...valid, title: 'x'.repeat(TITLE_MAX) }).ok).toBe(true);
    expect(validateForm({ ...valid, title: 'x'.repeat(TITLE_MAX + 1) })).toMatchObject({ ok: false, errors: { title: expect.stringContaining(String(TITLE_MAX)) } });
    expect(validateForm({ ...valid, assignedTo: '' })).toMatchObject({ ok: false, errors: { assignedTo: expect.any(String) } });
  });

  it('coordenadas ilegiveis e data impossivel; todos os erros juntos', () => {
    const r = validateForm({ ...valid, title: '', assignedTo: '', coords: 'perto da padaria', dueDate: '2026-02-30' });
    expect(r).toEqual({ ok: false, errors: { title: expect.any(String), assignedTo: expect.any(String), coords: expect.any(String), dueDate: expect.any(String) } });
  });

  it('coordenadas so de espacos = sem ponto (nao e erro)', () => {
    const r = validateForm({ ...valid, coords: '   ' });
    expect(r.ok && 'lat' in r.input).toBe(false);
  });
});

describe('formFromProject', () => {
  const p: Project = { id: 'p', ownerId: 'a', assignedTo: 'u1', title: 'T', kind: 'manutencao', osNumber: 'OS-1', description: 'd', address: 'end', lat: -23.5, lng: -46.6, dueDate: '2026-10-20', status: 'aberto', deleted: false, createdAt: 1, updatedAt: 1 };
  it('volta ao formulario e, validado, volta a ser o mesmo', () => {
    const form = formFromProject(p);
    expect(form).toEqual({ title: 'T', kind: 'manutencao', osNumber: 'OS-1', assignedTo: 'u1', description: 'd', address: 'end', coords: '-23.500000, -46.600000', dueDate: '2026-10-20' });
    expect(validateForm(form)).toEqual({ ok: true, input: { assignedTo: 'u1', title: 'T', kind: 'manutencao', osNumber: 'OS-1', description: 'd', address: 'end', lat: -23.5, lng: -46.6, dueDate: '2026-10-20' } });
  });
  it('projeto sem ponto, OS e prazo', () => {
    const { lat, lng, osNumber, dueDate, ...rest } = p;
    void lat; void lng; void osNumber; void dueDate;
    expect(formFromProject(rest)).toMatchObject({ osNumber: '', coords: '', dueDate: '' });
  });
});
