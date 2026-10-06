import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import { activityRepo } from '../activities/activityRepo';
import { ElementRuleError } from '../elements/elementRepo';
import type { ParsedFeature, ParsedLayer } from './kmlImport';
import { LAYER_COLORS, ReferenceRuleError, featureId, parseFeatureId, referenceRepo } from './referenceRepo';

let db: RotaFibraDB;
let repo: ReturnType<typeof referenceRepo>;
beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  repo = referenceRepo(db);
});

const point = (name: string, lng: number, lat: number, description = ''): ParsedFeature => ({ name, description, props: [], geom: { kind: 'point', coord: [lng, lat] } });
const line = (name: string): ParsedFeature => ({ name, description: '', props: [], geom: { kind: 'line', parts: [[[-46, -23], [-46.1, -23.1]]] } });
const parsed = (features: ParsedFeature[]): ParsedLayer => ({
  name: 'Rede X',
  features,
  counts: { points: features.filter((f) => f.geom.kind === 'point').length, lines: features.filter((f) => f.geom.kind === 'line').length, polygons: 0 },
  skipped: 2,
  bounds: [-23.1, -46.1, -23, -46],
});
const sample = () => parsed([point('CTO-1', -46.63, -23.55, 'Rua A'), point('CTO-2', -46.64, -23.56), line('Cabo 1'), point('', -46.65, -23.57)]);

describe('parseFeatureId', () => {
  it('separa só no último ":"', () => {
    expect(parseFeatureId(featureId('abc-123', 7))).toEqual({ layerId: 'abc-123', n: 7 });
    expect(parseFeatureId('a:b:3')).toEqual({ layerId: 'a:b', n: 3 });
    expect(parseFeatureId('semnumero')).toBeNull();
    expect(parseFeatureId('a:x')).toBeNull();
    expect(parseFeatureId(':3')).toBeNull();
    expect(parseFeatureId('a:-1')).toBeNull();
  });
});

describe('importLayer', () => {
  it('grava a camada (visível, com cor) e cada elemento com id estável', async () => {
    const layer = await repo.importLayer(sample(), { name: 'Minha rede', fileName: 'rede.kmz' }, 'Carlos');
    expect(layer).toMatchObject({ name: 'Minha rede', fileName: 'rede.kmz', visible: true, deleted: false, converted: [], skipped: 2, color: LAYER_COLORS[0] });
    expect(layer.counts).toEqual({ points: 3, lines: 1, polygons: 0 });
    const feats = await repo.features(layer.id);
    expect(feats).toHaveLength(4);
    expect((await repo.getFeature(featureId(layer.id, 2)))!.name).toBe('Cabo 1');
    expect((await repo.list()).map((l) => l.id)).toEqual([layer.id]);
  });

  it('nome vazio usa o do arquivo; cada camada nova pega a próxima cor', async () => {
    const a = await repo.importLayer(sample(), { name: '  ', fileName: 'a.kml' }, 'C');
    const b = await repo.importLayer(sample(), { name: 'B', fileName: 'b.kml' }, 'C');
    expect(a.name).toBe('Rede X');
    expect(b.color).toBe(LAYER_COLORS[1]);
  });

  it('importa muitos elementos (vários blocos)', async () => {
    const many = parsed(Array.from({ length: 4500 }, (_, i) => point(`p${i}`, -46 + i / 1e5, -23)));
    const layer = await repo.importLayer(many, { name: 'Grande', fileName: 'g.kml' }, 'C');
    expect(await db.referenceFeatures.where('layerId').equals(layer.id).count()).toBe(4500);
  });

  it('é tudo ou nada: se gravar os elementos falhar, nem a camada fica', async () => {
    vi.spyOn(db.referenceFeatures, 'bulkAdd').mockRejectedValueOnce(new Error('disco cheio'));
    await expect(repo.importLayer(sample(), { name: 'X', fileName: 'x.kml' }, 'C')).rejects.toThrow('disco cheio');
    expect(await repo.list()).toEqual([]);
    expect(await db.referenceLayers.count()).toBe(0);
    vi.restoreAllMocks();
    // e depois disso importar funciona normalmente
    await repo.importLayer(sample(), { name: 'X', fileName: 'x.kml' }, 'C');
    expect(await repo.list()).toHaveLength(1);
  });
});

describe('visibilidade, nome e exclusão', () => {
  it('liga/desliga uma camada e todas', async () => {
    const a = await repo.importLayer(sample(), { name: 'A', fileName: 'a.kml' }, 'C');
    const b = await repo.importLayer(sample(), { name: 'B', fileName: 'b.kml' }, 'C');
    await repo.setVisible(a.id, false);
    expect((await repo.get(a.id))!.visible).toBe(false);
    expect((await repo.get(b.id))!.visible).toBe(true);
    await repo.setAllVisible(false);
    expect((await repo.list()).every((l) => !l.visible)).toBe(true);
    await repo.setAllVisible(true);
    expect((await repo.list()).every((l) => l.visible)).toBe(true);
  });

  it('renomear ignora nome vazio e limita o tamanho', async () => {
    const a = await repo.importLayer(sample(), { name: 'A', fileName: 'a.kml' }, 'C');
    await repo.rename(a.id, '   ');
    expect((await repo.get(a.id))!.name).toBe('A');
    await repo.rename(a.id, 'x'.repeat(300));
    expect((await repo.get(a.id))!.name).toHaveLength(100);
  });

  it('excluir: exclusão lógica da camada e conteúdo apagado; as outras camadas ficam intactas', async () => {
    const a = await repo.importLayer(sample(), { name: 'A', fileName: 'a.kml' }, 'C');
    const b = await repo.importLayer(sample(), { name: 'B', fileName: 'b.kml' }, 'C');
    await repo.remove(a.id);
    expect(await repo.get(a.id)).toBeUndefined();
    expect((await db.referenceLayers.get(a.id))!.deleted).toBe(true);
    expect(await repo.features(a.id)).toHaveLength(0);
    expect(await repo.features(b.id)).toHaveLength(4);
    expect((await repo.list()).map((l) => l.id)).toEqual([b.id]);
  });
});

describe('convertPoints', () => {
  const openActivity = () => activityRepo(db).create({ kind: 'implantacao', title: 'Rua A' }, 'Carlos');

  it('cria elementos manuais (sem precisão) na atividade aberta, com nome e origem, e marca como convertidos', async () => {
    const act = await openActivity();
    const layer = await repo.importLayer(sample(), { name: 'Rede X', fileName: 'x.kml' }, 'C');
    const made = await repo.convertPoints(layer.id, [0, 1], 'cto', 'Carlos');
    expect(made).toHaveLength(2);
    expect(made[0]).toMatchObject({ type: 'cto', lat: -23.55, lng: -46.63, positionSource: 'manual', code: 'CTO-1', activityId: act.id, createdBy: 'Carlos' });
    expect(made[0]!.accuracy).toBeUndefined();
    expect(made[0]!.notes).toBe('Origem: camada Rede X\nRua A');
    expect(made[1]!.notes).toBe('Origem: camada Rede X');
    expect((await repo.get(layer.id))!.converted).toEqual([0, 1]);
    expect(await db.elements.count()).toBe(2);
  });

  it('ignora o que não é ponto e números repetidos ou inexistentes', async () => {
    await openActivity();
    const layer = await repo.importLayer(sample(), { name: 'Rede X', fileName: 'x.kml' }, 'C');
    const made = await repo.convertPoints(layer.id, [2, 0, 0, 99], 'poste', 'Carlos');
    expect(made.map((e) => e.code)).toEqual(['CTO-1']);
    expect((await repo.get(layer.id))!.converted).toEqual([0]);
  });

  it('sem atividade aberta: erro e NADA é criado nem marcado', async () => {
    const layer = await repo.importLayer(sample(), { name: 'Rede X', fileName: 'x.kml' }, 'C');
    await expect(repo.convertPoints(layer.id, [0, 1], 'cto', 'Carlos')).rejects.toBeInstanceOf(ElementRuleError);
    expect(await db.elements.count()).toBe(0);
    expect((await repo.get(layer.id))!.converted).toEqual([]);
  });

  it('é tudo ou nada: falha no meio desfaz os já criados', async () => {
    await openActivity();
    const layer = await repo.importLayer(sample(), { name: 'Rede X', fileName: 'x.kml' }, 'C');
    // o 2º ponto tem posição impossível
    await db.referenceFeatures.update(featureId(layer.id, 1), { geom: { kind: 'point', coord: [-46, 123] } });
    await expect(repo.convertPoints(layer.id, [0, 1], 'cto', 'Carlos')).rejects.toBeInstanceOf(ElementRuleError);
    expect(await db.elements.count()).toBe(0);
    expect((await repo.get(layer.id))!.converted).toEqual([]);
  });

  it('só linhas selecionadas / camada inexistente / excluída', async () => {
    await openActivity();
    const layer = await repo.importLayer(sample(), { name: 'Rede X', fileName: 'x.kml' }, 'C');
    await expect(repo.convertPoints(layer.id, [2], 'cto', 'C')).rejects.toMatchObject({ code: 'NO_POINTS' });
    await expect(repo.convertPoints('nao-existe', [0], 'cto', 'C')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await repo.remove(layer.id);
    await expect(repo.convertPoints(layer.id, [0], 'cto', 'C')).rejects.toBeInstanceOf(ReferenceRuleError);
  });

  it('um ponto com código e observações ajustados pelo técnico', async () => {
    await openActivity();
    const layer = await repo.importLayer(sample(), { name: 'Rede X', fileName: 'x.kml' }, 'C');
    const [e] = await repo.convertPoints(layer.id, [0], 'ceo', 'Carlos', { override: { code: ' CEO-9 ', notes: 'conferir em campo' } });
    expect(e).toMatchObject({ type: 'ceo', code: 'CEO-9', notes: 'conferir em campo' });
  });

  it('converter de novo cria outro elemento (o marcador "convertido" é só um aviso)', async () => {
    await openActivity();
    const layer = await repo.importLayer(sample(), { name: 'Rede X', fileName: 'x.kml' }, 'C');
    await repo.convertPoints(layer.id, [0], 'cto', 'C');
    await repo.convertPoints(layer.id, [0], 'cto', 'C');
    expect(await db.elements.count()).toBe(2);
    expect((await repo.get(layer.id))!.converted).toEqual([0]);
  });
});
