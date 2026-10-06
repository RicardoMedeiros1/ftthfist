import { describe, expect, it } from 'vitest';
import { changeVerb, diffRecords, recordTitle } from './diffRecords';

const ctl = { updated_at: '2026-10-06T10:00:00Z', server_updated_at: '2026-10-06T10:00:01Z', updated_by: 'x', geom: 'POINT(1 2)', created_at: 'a', created_by: 'Ana', owner_id: 'o', id: 'i' };

describe('diffRecords', () => {
  it('ignora os campos de controle: mudar so o horario nao e mudanca', () => {
    expect(diffRecords({ ...ctl, code: 'P-1' }, { ...ctl, updated_at: '2030-01-01T00:00:00Z', updated_by: 'y', geom: 'POINT(3 4)', code: 'P-1' })).toEqual([]);
  });

  it('conta o que mudou com o nome do campo em portugues', () => {
    expect(diffRecords({ code: 'P-1', notes: '' }, { code: 'P-2', notes: 'inclinado' })).toEqual([
      { label: 'Identificação', before: 'P-1', after: 'P-2' },
      { label: 'Observações', before: 'vazio', after: 'inclinado' },
    ]);
  });

  it('atributos do elemento viram uma linha por atributo que mudou', () => {
    const out = diffRecords({ attrs: { owner: 'proprio', ownerCode: '12', meters: 10 } }, { attrs: { owner: 'concessionaria', ownerCode: '12', meters: 15 } });
    expect(out).toEqual([
      { label: 'Dono do poste', before: 'Próprio', after: 'Concessionária' },
      { label: 'Metros de reserva', before: '10', after: '15' },
    ]);
  });

  it('valores conhecidos saem por extenso: tipo, situacao, excluido, datas, metros, posicao, precisao', () => {
    const out = diffRecords(
      { kind: 'implantacao', status: 'aberta', deleted: false, type: 'poste', total_m: 1500, lat: -23.5, accuracy_m: 4.4, position_source: 'gps' },
      { kind: 'manutencao', status: 'concluida', deleted: true, type: 'cto', total_m: 200, lat: -23.5000011, accuracy_m: 20, position_source: 'manual' },
    );
    const by = Object.fromEntries(out.map((c) => [c.label, [c.before, c.after]]));
    expect(by['Tipo de atividade']).toEqual(['Implantação', 'Manutenção']);
    expect(by['Situação']).toEqual(['Aberta', 'Concluída']);
    expect(by['Excluído']).toEqual(['não', 'sim']);
    expect(by['Tipo']).toEqual(['Poste', 'CTO']);
    expect(by['Total (metros)']).toEqual(['1500,0 m', '200,0 m']);
    expect(by['Latitude']).toEqual(['-23.500000', '-23.500001']);
    expect(by['Precisão']).toEqual(['4 m', '20 m']);
    expect(by['Origem da posição']).toEqual(['GPS', 'Marcada no mapa']);
  });

  it('datas viram horario legivel', () => {
    const [c] = diffRecords({ ended_at: null }, { ended_at: '2026-10-06T15:30:00-03:00' });
    expect(c!.before).toBe('vazio');
    expect(c!.after).toMatch(/\d{2}\/\d{2}/);
  });

  it('materiais: lista legivel; tracado: numero de pontos, e avisa quando so as posicoes mudaram', () => {
    const [m] = diffRecords({ materials: [] }, { materials: [{ item: 'Fita', quantity: 2, unit: 'un' }] });
    expect(m).toEqual({ label: 'Materiais', before: 'nenhum', after: 'Fita · 2 un' });
    const v1 = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }];
    expect(diffRecords({ vertices: v1 }, { vertices: [...v1, { lat: 3, lng: 3 }] })).toEqual([{ label: 'Traçado', before: '2 pontos', after: '3 pontos' }]);
    expect(diffRecords({ vertices: v1 }, { vertices: [{ lat: 1, lng: 1 }, { lat: 2.5, lng: 2 }] })).toEqual([{ label: 'Traçado', before: '2 pontos', after: '2 pontos (posições alteradas)' }]);
  });

  it('campo que ainda nao tem nome aparece com a chave (nao some)', () => {
    expect(diffRecords({}, { novo_campo: 'x' })).toEqual([{ label: 'novo_campo', before: 'vazio', after: 'x' }]);
  });
});

describe('changeVerb', () => {
  it('excluir e restaurar valem mais que os outros detalhes', () => {
    expect(changeVerb({ deleted: false }, { deleted: true, code: 'x' })).toBe('Excluiu');
    expect(changeVerb({ deleted: true }, { deleted: false })).toBe('Restaurou');
    expect(changeVerb({ deleted: false, code: 'a' }, { deleted: false, code: 'b' })).toBe('Alterou');
    expect(changeVerb({ deleted: true }, { deleted: true })).toBe('Alterou');
  });
});

describe('recordTitle', () => {
  it('nome curto por tipo de registro', () => {
    expect(recordTitle('elements', { type: 'poste', code: 'P-001' })).toBe('Poste P-001');
    expect(recordTitle('elements', { type: 'cto', code: '' })).toBe('CTO');
    expect(recordTitle('cables', { cable_type: 'AS-80', fiber_count: 12 })).toBe('Cabo AS-80 · 12 fibras');
    expect(recordTitle('activities', { title: 'Rua X' })).toBe('Atividade Rua X');
    expect(recordTitle('photos', {})).toBe('Foto');
    expect(recordTitle('outra', {})).toBe('outra');
  });
});
