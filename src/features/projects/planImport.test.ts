import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { ProjectPlan } from '../../db/types';
import { parseReferenceFile, type ParsedLayer, type ParseXml } from '../reference/kmlImport';
import { PLAN_LIMITS, cleanCode, validatePlan } from './plan';
import { applyImport, hasUsable, importMessage, noUsableText, planImportFromLayer, splitLine, type PlanImport } from './planImport';

const parseXml: ParseXml = (text) =>
  new DOMParser({ onError: (level, msg) => { if (level !== 'warning') throw new Error(msg); } }).parseFromString(text, 'text/xml') as unknown as Document;
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;
const pm = (name: string, geom: string) => `<Placemark><name>${name}</name>${geom}</Placemark>`;
const point = (lng: number, lat: number) => `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;
const line = (...c: [number, number][]) => `<LineString><coordinates>${c.map(([lng, lat]) => `${lng},${lat},0`).join(' ')}</coordinates></LineString>`;
const poly = '<Polygon><outerBoundaryIs><LinearRing><coordinates>-46.6,-23.5,0 -46.61,-23.5,0 -46.61,-23.51,0 -46.6,-23.5,0</coordinates></LinearRing></outerBoundaryIs></Polygon>';
const fromKml = async (kml: string) => planImportFromLayer(await parseReferenceFile(buf(new TextEncoder().encode(kml)), 'rede.kml', { parseXml }));

let n = 0;
const makeId = () => `id${n++}`;
const empty = (): ProjectPlan => ({ lines: [], points: [] });
const imp = (over: Partial<PlanImport> = {}): PlanImport => ({ lines: [], points: [], polygons: 0, skipped: 0, ...over });
const ln = (count: number): [number, number][] => Array.from({ length: count }, (_, i) => [-23 + (i % 1000) / 1e5, -46 + Math.floor(i / 1000) / 1e5] as [number, number]);

describe('planImportFromLayer: o que o arquivo traz', () => {
  it('linhas viram traçados em [lat, lng]; pontos viram "outro" com o nome como codigo; areas so sao contadas', async () => {
    const r = await fromKml(
      wrap(
        pm('Cabo A', line([-46.63, -23.55], [-46.631, -23.551], [-46.632, -23.552])) +
          pm('Poste 12', point(-46.63, -23.55)) +
          pm('Sem nome', point(-46.64, -23.56)).replace('<name>Sem nome</name>', '') +
          pm('Quadra', poly),
      ),
    );
    expect(r.lines).toEqual([[[-23.55, -46.63], [-23.551, -46.631], [-23.552, -46.632]]]);
    expect(r.points).toEqual([{ lat: -23.55, lng: -46.63, code: 'Poste 12' }, { lat: -23.56, lng: -46.64, code: '' }]);
    expect(r.polygons).toBe(1);
    expect(r.skipped).toBe(0);
    expect(hasUsable(r)).toBe(true);
  });
  it('linha com varias partes (MultiGeometry) vira um traçado por parte; repetidos em sequencia somem', async () => {
    const r = await fromKml(
      wrap(
        `<Placemark><name>M</name><MultiGeometry>${line([-46.1, -23.1], [-46.1, -23.1], [-46.2, -23.2])}${line([-46.3, -23.3], [-46.4, -23.4])}</MultiGeometry></Placemark>`,
      ),
    );
    expect(r.lines).toEqual([[[-23.1, -46.1], [-23.2, -46.2]], [[-23.3, -46.3], [-23.4, -46.4]]]);
  });
  it('dois pontos seguidos com a mesma latitude mas longitudes diferentes sao pontos diferentes', async () => {
    const r = await fromKml(wrap(pm('Leste', line([-46.1, -23.1], [-46.2, -23.1]))));
    expect(r.lines).toEqual([[[-23.1, -46.1], [-23.1, -46.2]]]);
    expect(hasUsable(r)).toBe(true); // so traçado, sem ponto, ja serve
    expect(hasUsable(await fromKml(wrap(pm('So ponto', point(-46.1, -23.1)))))).toBe(true);
  });
  it('linha que sobra com 1 ponto so (tudo repetido) e ignorada e contada', async () => {
    const r = await fromKml(wrap(pm('Ponto vira linha', line([-46.1, -23.1], [-46.1, -23.1])) + pm('ok', point(-46.2, -23.2))));
    expect(r.lines).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(r.points).toHaveLength(1);
  });
  it('so areas: nada aproveitavel, e o texto explica', async () => {
    const r = await fromKml(wrap(pm('Q1', poly) + pm('Q2', poly)));
    expect(hasUsable(r)).toBe(false);
    expect(r.polygons).toBe(2);
    expect(noUsableText(r)).toMatch(/só tem áreas/);
    expect(noUsableText(imp())).toMatch(/nem pontos utilizáveis/);
  });
  it('nome grande e cortado em 60 letras; nome com emoji nao e cortado no meio', async () => {
    const r = await fromKml(wrap(pm('x'.repeat(100), point(-46, -23)) + pm('y'.repeat(59) + '😀😀', point(-46.1, -23.1))));
    expect(r.points[0]!.code).toHaveLength(60);
    expect(r.points[1]!.code).toBe('y'.repeat(59)); // o emoji que passaria do limite nao entra pela metade
  });
  it('funciona com KMZ (zip com doc.kml)', async () => {
    const zip = new JSZip();
    zip.file('doc.kml', wrap(pm('CTO-1', point(-46.5, -23.5))));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const layer = await parseReferenceFile(buf(bytes), 'rede.kmz', { parseXml });
    expect(planImportFromLayer(layer).points).toEqual([{ lat: -23.5, lng: -46.5, code: 'CTO-1' }]);
  });
});

describe('splitLine: linha com pontos demais', () => {
  it('ate o limite fica inteira; acima, vira pedacos que se encostam e cobrem a linha toda', () => {
    expect(splitLine(ln(5000))).toHaveLength(1);
    const pts = ln(5001);
    const parts = splitLine(pts);
    expect(parts.map((p) => p.length)).toEqual([5000, 2]);
    expect(parts[1]![0]).toEqual(parts[0]![4999]); // o 2o pedaco comeca onde o 1o terminou
    expect(parts[1]![1]).toEqual(pts[5000]);
    const big = splitLine(ln(9999));
    expect(big.map((p) => p.length)).toEqual([5000, 5000]);
    expect(big[1]!.at(-1)).toEqual(ln(9999).at(-1));
    expect(splitLine(ln(12000), 100).every((p) => p.length >= 2 && p.length <= 100)).toBe(true);
  });
  it('o arquivo com uma linha de 6000 pontos vira 2 traçados', async () => {
    const layer: ParsedLayer = {
      name: 'x', skipped: 0, counts: { points: 0, lines: 1, polygons: 0 }, bounds: [0, 0, 0, 0],
      features: [{ name: '', description: '', props: [], geom: { kind: 'line', parts: [ln(6000).map(([lat, lng]) => [lng, lat] as [number, number])] } }],
    };
    expect(planImportFromLayer(layer).lines.map((l) => l.length)).toEqual([5000, 1001]);
  });
});

describe('applyImport', () => {
  const imported = imp({ lines: [[[-23, -46], [-23.1, -46.1]]], points: [{ lat: -23.05, lng: -46.05, code: 'P-1' }, { lat: -23.2, lng: -46.2, code: '' }] });
  const current = (): ProjectPlan => ({ lines: [{ id: 'old-l', points: [[1, 1], [2, 2]] }], points: [{ id: 'old-p', type: 'poste', lat: 5, lng: 5 }] });

  it('substituir descarta o desenho atual', () => {
    const out = applyImport(current(), imported, 'substituir', makeId);
    expect(out.plan.lines).toHaveLength(1);
    expect(out.plan.lines[0]!.id).not.toBe('old-l');
    expect(out.plan.points.map((p) => p.type)).toEqual(['outro', 'outro']);
    expect(out.plan.points.map((p) => p.code)).toEqual(['P-1', undefined]);
    expect('code' in out.plan.points[1]!).toBe(false);
    expect([out.addedLines, out.addedPoints, out.droppedLines, out.droppedPoints]).toEqual([1, 2, 0, 0]);
    expect(validatePlan(out.plan)).toBeNull();
  });
  it('acrescentar mantem o atual, sem mexer no objeto recebido, e os ids nao se repetem', () => {
    const cur = current();
    const out = applyImport(cur, imported, 'acrescentar', makeId);
    expect(out.plan.lines.map((l) => l.id)[0]).toBe('old-l');
    expect(out.plan.lines).toHaveLength(2);
    expect(out.plan.points).toHaveLength(3);
    expect(cur.lines).toHaveLength(1);
    expect(cur.points).toHaveLength(1);
    const ids = [...out.plan.lines, ...out.plan.points].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('id que ja existe e sorteado de novo', () => {
    const seq = ['old-l', 'old-p', 'novo1', 'novo2', 'novo3'];
    let i = 0;
    const out = applyImport(current(), imported, 'acrescentar', () => seq[i++]!);
    expect(out.plan.lines[1]!.id).toBe('novo1');
    expect(out.plan.points.slice(1).map((p) => p.id)).toEqual(['novo2', 'novo3']);
  });
  it('os limites: o que passa e deixado de fora e contado (traçados, pontos e pontos de traçado)', () => {
    const many = imp({ lines: Array.from({ length: PLAN_LIMITS.lines + 5 }, () => [[0, 0], [0, 1]] as [number, number][]), points: Array.from({ length: PLAN_LIMITS.points + 3 }, (_, i) => ({ lat: 0, lng: i / 1e4, code: '' })) });
    const out = applyImport(empty(), many, 'substituir', makeId);
    expect(out.plan.lines).toHaveLength(PLAN_LIMITS.lines);
    expect(out.plan.points).toHaveLength(PLAN_LIMITS.points);
    expect([out.droppedLines, out.droppedPoints]).toEqual([5, 3]);
    expect(validatePlan(out.plan)).toBeNull();
    // exatamente no limite cabe; um a mais nao
    const full = applyImport(empty(), imp({ lines: Array.from({ length: PLAN_LIMITS.lines }, () => [[0, 0], [0, 1]] as [number, number][]) }), 'substituir', makeId);
    expect([full.plan.lines.length, full.droppedLines]).toEqual([PLAN_LIMITS.lines, 0]);
  });
  it('limite do total de pontos de traçado: a linha que nao cabe inteira e deixada de fora, a menor ainda entra', () => {
    const big = (count: number) => Array.from({ length: count }, () => [0, 0] as [number, number]); // curtos: o limite de pontos vem antes do de bytes
    const tooMany = imp({ lines: [big(5000), big(5000), big(5000), big(4000), big(2000), big(1000)] });
    const out = applyImport(empty(), tooMany, 'substituir', makeId);
    // 5000+5000+5000+4000 = 19000; a de 2000 passaria de 20000 (fica de fora); a de 1000 chega a 20000 exato (entra)
    expect(out.plan.lines.map((l) => l.points.length)).toEqual([5000, 5000, 5000, 4000, 1000]);
    expect(out.droppedLines).toBe(1);
    expect(out.plan.lines.reduce((s, l) => s + l.points.length, 0)).toBe(20000);
  });
  it('limite de tamanho (bytes): nunca devolve um desenho que o app recusaria ao salvar', () => {
    const fat = imp({ lines: Array.from({ length: 150 }, (_, k) => Array.from({ length: 130 }, (_, i) => [-23.123456 - k / 1e3 - i / 1e6, -46.654321 - i / 1e6] as [number, number])), points: Array.from({ length: 2000 }, (_, i) => ({ lat: -23.1234567 - i / 1e6, lng: -46.7654321, code: 'c'.repeat(60) })) });
    const out = applyImport(empty(), fat, 'substituir', makeId);
    expect(out.droppedLines + out.droppedPoints).toBeGreaterThan(0);
    expect(validatePlan(out.plan)).toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(out.plan)).length).toBeLessThanOrEqual(PLAN_LIMITS.bytes);
    // e o que entrou enche o espaco: quase nada de folga
    expect(PLAN_LIMITS.bytes - new TextEncoder().encode(JSON.stringify(out.plan)).length).toBeLessThan(400);
  });
  it('acrescentar respeita o que o desenho atual ja ocupa', () => {
    const cur: ProjectPlan = { lines: Array.from({ length: PLAN_LIMITS.lines - 1 }, (_, i) => ({ id: `c${i}`, points: [[0, 0], [0, 1]] as [number, number][] })), points: [] };
    const out = applyImport(cur, imp({ lines: [[[1, 1], [1, 2]], [[2, 2], [2, 3]]] }), 'acrescentar', makeId);
    expect([out.plan.lines.length, out.addedLines, out.droppedLines]).toEqual([PLAN_LIMITS.lines, 1, 1]);
    const out2 = applyImport(cur, imp({ lines: [[[1, 1], [1, 2]], [[2, 2], [2, 3]]] }), 'substituir', makeId);
    expect([out2.plan.lines.length, out2.droppedLines]).toEqual([2, 0]);
  });
  it('limites do que entrou: bounds so do que entrou; nada entrou = null', () => {
    const out = applyImport(current(), imported, 'acrescentar', makeId);
    expect(out.bounds).toEqual([-23.2, -46.2, -23, -46]);
    expect(applyImport(current(), imp(), 'acrescentar', makeId).bounds).toBeNull();
  });
});

describe('cleanCode', () => {
  it('apara, corta em 60 e nao deixa metade de emoji', () => {
    expect(cleanCode('  P-1  ')).toBe('P-1');
    expect(cleanCode('a'.repeat(61))).toHaveLength(60);
    expect(cleanCode('a'.repeat(59) + '😀')).toBe('a'.repeat(59));
    expect(cleanCode('a'.repeat(58) + '😀')).toBe('a'.repeat(58) + '😀');
    expect(cleanCode('ab\ud800cd')).toBe('abcd');
    expect(cleanCode('ab\udc00cd')).toBe('abcd');
    expect(cleanCode('😀x')).toBe('😀x');
    expect(cleanCode('')).toBe('');
  });
});

describe('importMessage', () => {
  const out = (over = {}) => ({ plan: empty(), addedLines: 2, addedPoints: 1, droppedLines: 0, droppedPoints: 0, bounds: null, ...over });
  it('conta o que entrou, e so avisa do que aconteceu', () => {
    expect(importMessage(out(), imp())).toBe('Importado: 2 traçados e 1 ponto. Confira no mapa e toque em “Salvar desenho”.');
    expect(importMessage(out({ addedLines: 1, addedPoints: 0 }), imp())).toBe('Importado: 1 traçado. Confira no mapa e toque em “Salvar desenho”.');
    expect(importMessage(out({ addedLines: 0, addedPoints: 4 }), imp())).toMatch(/^Importado: 4 pontos\./);
  });
  it('avisa das areas, dos ignorados e do que nao coube', () => {
    const msg = importMessage(out({ droppedLines: 1, droppedPoints: 2 }), imp({ polygons: 2, skipped: 1 }));
    expect(msg).toContain('2 áreas (polígonos) não entram no desenho.');
    expect(msg).toContain('1 elemento sem coordenadas válidas foi ignorado.');
    expect(msg).toContain('3 itens não couberam no limite do desenho.');
    expect(importMessage(out(), imp({ polygons: 1 }))).toContain('1 área (polígono) não entra no desenho.');
    expect(importMessage(out({ droppedLines: 1 }), imp({ skipped: 2 }))).toContain('2 elementos sem coordenadas válidas foram ignorados.');
    expect(importMessage(out({ droppedLines: 1 }), imp())).toContain('1 item não coube');
  });
  it('nada entrou: diz isso e nao manda salvar', () => {
    expect(importMessage(out({ addedLines: 0, addedPoints: 0, droppedLines: 3 }), imp())).toBe('Nada foi importado. 3 itens não couberam no limite do desenho.');
  });
});
