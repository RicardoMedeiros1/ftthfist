import 'fake-indexeddb/auto';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import type { Cable, ElementType, TrackPoint } from '../../db/types';
import { activityRepo } from '../activities/activityRepo';
import { elementRepo } from '../elements/elementRepo';
import { collectExportData, type ExportData } from './exportData';
import { buildGeoJson } from './geojson';
import { buildKml, coordinate, esc, kmlColor, styleIdForCable } from './kml';
import { buildKmz, KMZ_MIME } from './kmz';

let db: RotaFibraDB;
beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
});

const jpeg = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
const base = (extra: object) => ({ id: crypto.randomUUID(), createdAt: Date.UTC(2026, 9, 6, 12), updatedAt: 5, createdBy: 'Carlos', deleted: false, syncStatus: 'pending', ...extra });
const opts = { iconHref: (t: ElementType) => `icons/${t}.png`, photoHref: undefined };

async function seed() {
  const acts = activityRepo(db);
  const els = elementRepo(db);
  const a = await acts.create({ kind: 'implantacao', title: 'Rua <A> & "B"', osNumber: '77' }, 'Carlos');
  const poste = await els.create(
    { type: 'poste', lat: -23.55, lng: -46.63, accuracy: 8, positionSource: 'gps', code: 'P-1', notes: 'perto da <esquina> & ]]> fim', attrs: { owner: 'concessionaria', ownerCode: 'X9' } },
    'Carlos',
    [{ blob: jpeg(1, 2, 3), takenAt: 1 }],
  );
  const cto = await els.create({ type: 'cto', lat: -23.551, lng: -46.631, positionSource: 'manual', code: 'C-1', attrs: { capacity: 16, splitter: '1:16' } }, 'Carlos');
  const ceo = await els.create({ type: 'ceo', lat: -23.552, lng: -46.632, accuracy: 4, positionSource: 'gps', code: '', attrs: { trays: 2, splices: 12 } }, 'Carlos');
  const oc = await els.create({ type: 'ocorrencia', lat: -23.553, lng: -46.633, accuracy: 3, positionSource: 'gps', code: 'O-1', attrs: { problem: 'rompimento', actionTaken: 'Emenda' } }, 'Carlos');
  const cable = base({
    cableType: 'AS-80', fiberCount: 48,
    vertices: [{ elementId: poste.id, lat: poste.lat, lng: poste.lng }, { elementId: cto.id, lat: cto.lat, lng: cto.lng }],
    lengthMeters: 111.5, reserveMeters: 20, totalMeters: 131.5, activityId: a.id, notes: '',
  }) as Cable;
  await db.cables.add(cable);
  const pts: TrackPoint[] = [
    base({ activityId: a.id, lat: -23.5, lng: -46.6, accuracy: 8, timestamp: 0, segment: 0 }) as TrackPoint,
    base({ activityId: a.id, lat: -23.5005, lng: -46.6, accuracy: 8, timestamp: 30_000, segment: 0 }) as TrackPoint,
    base({ activityId: a.id, lat: -23.51, lng: -46.61, accuracy: 8, timestamp: 90_000, segment: 1 }) as TrackPoint,
    base({ activityId: a.id, lat: -23.5105, lng: -46.61, accuracy: 8, timestamp: 120_000, segment: 1 }) as TrackPoint,
  ];
  await db.trackPoints.bulkAdd(pts);
  return { a, poste, cto, ceo, oc, cable };
}

const parse = (xml: string) => new DOMParser({ onError: (_l, m) => { throw new Error(m); } }).parseFromString(xml, 'text/xml');
const collect = async (): Promise<ExportData> => collectExportData(db, { kind: 'network' }, { now: Date.UTC(2026, 9, 6, 15), appVersion: 'abc1234' });
const childNames = (el: XmlElement) => Array.from(el.childNodes).filter((n) => n.nodeType === 1).map((n) => (n as XmlElement).tagName);

describe('helpers do KML', () => {
  it('esc escapa os 5 caracteres do XML', () => {
    expect(esc(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
  });
  it('cor em aabbggrr (a ordem do KML é o inverso do CSS)', () => {
    expect(kmlColor('#2979ff')).toBe('ffff7929');
    expect(kmlColor('#ff1744')).toBe('ff4417ff');
    expect(kmlColor('#ffffff', 0.5)).toBe('80ffffff');
  });
  it('coordenada é lon,lat,alt (e não lat,lon)', () => {
    expect(coordinate(-23.55, -46.63)).toBe('-46.6300000,-23.5500000,0');
  });
  it('estilo do cabo pelo grupo de fibras, com reserva para valor desconhecido', () => {
    expect(styleIdForCable(1)).toBe('cabo-0');
    expect(styleIdForCable(12)).toBe('cabo-1');
    expect(styleIdForCable(144)).toBe('cabo-5');
    expect(styleIdForCable(999)).toBe('cabo-x');
  });
});

describe('buildKml', () => {
  it('é XML válido, KML 2.2, e o togeojson lê pontos, cabo e trilha com lon/lat certos', async () => {
    const s = await seed();
    const xml = buildKml(await collect(), opts);
    const doc = parse(xml);
    expect(doc.documentElement!.tagName).toBe('kml');
    expect(doc.documentElement!.getAttribute('xmlns')).toBe('http://www.opengis.net/kml/2.2');

    const gj = kmlToGeoJson(doc);
    const points = gj.features.filter((f) => f.geometry?.type === 'Point');
    expect(points).toHaveLength(4);
    const p1 = points.find((f) => f.properties?.name === 'P-1')!;
    expect(p1.geometry).toMatchObject({ coordinates: [-46.63, -23.55, 0] });
    const line = gj.features.find((f) => f.geometry?.type === 'LineString' && String(f.properties?.name).includes('AS-80'))!;
    expect((line.geometry as { coordinates: number[][] }).coordinates).toEqual([
      [s.poste.lng, s.poste.lat, 0],
      [s.cto.lng, s.cto.lat, 0],
    ]);
    const track = gj.features.find((f) => String(f.properties?.name).startsWith('Trilha'))!;
    expect(track.geometry!.type).toBe('GeometryCollection');
  });

  it('pastas na ordem fixa, só as que têm conteúdo', async () => {
    await seed();
    const doc = parse(buildKml(await collect(), opts));
    const names = Array.from(doc.getElementsByTagName('Folder')).map((f) => f.getElementsByTagName('name')[0]!.textContent);
    expect(names).toEqual(['Postes', 'CTOs', 'CEOs', 'Ocorrências', 'Cabos', 'Trilhas']);
  });

  it('rede vazia: documento válido sem pastas', async () => {
    const doc = parse(buildKml(await collect(), opts));
    expect(doc.getElementsByTagName('Folder')).toHaveLength(0);
    expect(doc.getElementsByTagName('Placemark')).toHaveLength(0);
  });

  it('segue a ordem de elementos do esquema do KML (Placemark e Style)', async () => {
    await seed();
    const doc = parse(buildKml(await collect(), opts));
    const pm = doc.getElementsByTagName('Placemark')[0]!;
    expect(childNames(pm)).toEqual(['name', 'description', 'styleUrl', 'ExtendedData', 'Point']);
    const style = Array.from(doc.getElementsByTagName('Style')).find((s) => s.getAttribute('id') === 'el-poste')!;
    expect(childNames(style)).toEqual(['IconStyle', 'LabelStyle']);
    expect(childNames(style.getElementsByTagName('IconStyle')[0]!)).toEqual(['scale', 'Icon', 'hotSpot']);
    const lineStyle = Array.from(doc.getElementsByTagName('Style')).find((s) => s.getAttribute('id') === 'cabo-3')!;
    expect(lineStyle.getElementsByTagName('color')[0]!.textContent).toBe(kmlColor('#ffab00'));
  });

  it('todo styleUrl aponta para um Style que existe, e cada tipo usado tem seu ícone', async () => {
    await seed();
    const doc = parse(buildKml(await collect(), opts));
    const ids = new Set(Array.from(doc.getElementsByTagName('Style')).map((s) => s.getAttribute('id')));
    for (const u of Array.from(doc.getElementsByTagName('styleUrl'))) expect(ids.has(u.textContent!.slice(1))).toBe(true);
    const hrefs = Array.from(doc.getElementsByTagName('href')).map((h) => h.textContent);
    expect(hrefs.sort()).toEqual(['icons/ceo.png', 'icons/cto.png', 'icons/ocorrencia.png', 'icons/poste.png']);
  });

  it('texto do técnico é escapado: título, notas e ]]> não quebram o XML nem injetam HTML', async () => {
    await seed();
    const xml = buildKml(await collect(), opts);
    const doc = parse(xml); // lança se o XML estiver quebrado
    expect(doc.getElementsByTagName('name')[0]!.textContent).toBe('RotaFibra — Rede inteira');
    const poste = Array.from(doc.getElementsByTagName('Placemark')).find((p) => p.getElementsByTagName('name')[0]!.textContent === 'P-1')!;
    const html = poste.getElementsByTagName('description')[0]!.textContent!;
    expect(html).toContain('perto da &lt;esquina&gt; &amp; ]]&gt; fim');
    expect(html).not.toContain('<esquina>');
    const ext = Array.from(poste.getElementsByTagName('Data')).find((d) => d.getAttribute('name') === 'atividade')!;
    expect(ext.getElementsByTagName('value')[0]!.textContent).toBe('Rua <A> & "B"');
  });

  it('descrição do poste/CTO/ocorrência traz os atributos do tipo; cabo traz as metragens', async () => {
    await seed();
    const doc = parse(buildKml(await collect(), opts));
    const desc = (name: string) =>
      Array.from(doc.getElementsByTagName('Placemark')).find((p) => p.getElementsByTagName('name')[0]!.textContent!.includes(name))!.getElementsByTagName('description')[0]!.textContent!;
    expect(desc('P-1')).toContain('Concessionária');
    expect(desc('P-1')).toContain('X9');
    expect(desc('C-1')).toContain('16 portas');
    expect(desc('C-1')).toContain('1:16');
    expect(desc('C-1')).toContain('Marcada no mapa');
    expect(desc('O-1')).toContain('Rompimento');
    expect(desc('O-1')).toContain('Emenda');
    const cable = desc('AS-80');
    expect(cable).toContain('111,5 m');
    expect(cable).toContain('20,0 m');
    expect(cable).toContain('131,5 m');
    expect(cable).toContain('48');
  });

  it('elemento sem código usa o nome do tipo; nome nunca fica vazio', async () => {
    await seed();
    const doc = parse(buildKml(await collect(), opts));
    const names = Array.from(doc.getElementsByTagName('Placemark')).map((p) => p.getElementsByTagName('name')[0]!.textContent);
    expect(names).toContain('CEO');
    expect(names.every((n) => !!n)).toBe(true);
  });

  it('trilha: um LineString por trecho, sem ligar os trechos, com distância e duração', async () => {
    await seed();
    const doc = parse(buildKml(await collect(), opts));
    const pm = Array.from(doc.getElementsByTagName('Placemark')).find((p) => p.getElementsByTagName('name')[0]!.textContent!.startsWith('Trilha'))!;
    expect(pm.getElementsByTagName('LineString')).toHaveLength(2);
    const html = pm.getElementsByTagName('description')[0]!.textContent!;
    expect(html).toContain('01:00'); // 30 s + 30 s (o intervalo de 60 s entre trechos fica fora)
    expect(html).toContain('Trechos');
  });

  it('só inclui <img> das fotos quando photoHref é informado', async () => {
    const { poste } = await seed();
    const d = await collect();
    expect(buildKml(d, opts)).not.toContain('<img');
    const ph = d.photosByElement.get(poste.id)![0]!;
    const withPhotos = buildKml(d, { ...opts, photoHref: (p) => `photos/${p.id}.jpg` });
    expect(withPhotos).toContain(`photos/${ph.id}.jpg`);
  });

  it('atividade só: não vaza elementos de outras atividades', async () => {
    const s = await seed();
    const acts = activityRepo(db);
    await acts.complete(s.a.id);
    const b = await acts.create({ kind: 'manutencao', title: 'Outra' }, 'Carlos');
    await elementRepo(db).create({ type: 'outro', lat: -23.6, lng: -46.7, positionSource: 'manual', code: 'ZZ' }, 'Carlos');
    const d = await collectExportData(db, { kind: 'activity', activityId: b.id });
    const doc = parse(buildKml(d, opts));
    expect(Array.from(doc.getElementsByTagName('name')).map((n) => n.textContent)).not.toContain('P-1');
    expect(d.title).toBe('Outra');
  });
});

describe('buildGeoJson', () => {
  it('FeatureCollection com Point, LineString e MultiLineString e propriedades legíveis', async () => {
    await seed();
    const gj = JSON.parse(buildGeoJson(await collect())) as { type: string; features: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[] };
    expect(gj.type).toBe('FeatureCollection');
    const types = gj.features.map((f) => f.geometry.type);
    expect(types.filter((t) => t === 'Point')).toHaveLength(4);
    expect(types).toContain('LineString');
    const track = gj.features.find((f) => f.geometry.type === 'MultiLineString')!;
    expect((track.geometry.coordinates as unknown[]).length).toBe(2);
    expect(track.properties.kind).toBe('track');
    const poste = gj.features.find((f) => f.properties.code === 'P-1')!;
    expect(poste.geometry.coordinates).toEqual([-46.63, -23.55]);
    expect(poste.properties).toMatchObject({ kind: 'element', type: 'poste', photos: 1, accuracyMeters: 8, positionSource: 'gps', activity: 'Rua <A> & "B"' });
    const cto = gj.features.find((f) => f.properties.code === 'C-1')!;
    expect(cto.properties.accuracyMeters).toBeNull();
    const cable = gj.features.find((f) => f.properties.kind === 'cable')!;
    expect(cable.properties).toMatchObject({ lengthMeters: 111.5, reserveMeters: 20, totalMeters: 131.5, fiberCount: 48 });
  });

  it('rede vazia vira coleção vazia', async () => {
    expect(JSON.parse(buildGeoJson(await collect()))).toEqual({ type: 'FeatureCollection', features: [] });
  });
});

describe('buildKmz', () => {
  const renderIcon = async (t: ElementType) => new Blob([`png-${t}`], { type: 'image/png' });

  it('doc.kml na raiz + um ícone por tipo usado, sem fotos por padrão', async () => {
    await seed();
    const blob = await buildKmz(await collect(), { includePhotos: false, renderIcon });
    expect(blob.type).toBe(KMZ_MIME);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !n.endsWith('/')).sort();
    expect(names).toEqual(['doc.kml', 'icons/ceo.png', 'icons/cto.png', 'icons/ocorrencia.png', 'icons/poste.png']);
    expect(await zip.file('icons/cto.png')!.async('string')).toBe('png-cto');
    const kml = await zip.file('doc.kml')!.async('string');
    expect(kml).not.toContain('photos/');
    parse(kml);
  });

  it('com fotos: cada foto vai para photos/<id>.jpg com os mesmos bytes e o KML aponta para ela', async () => {
    const { poste } = await seed();
    const d = await collect();
    const ph = d.photosByElement.get(poste.id)![0]!;
    const zip = await JSZip.loadAsync(await (await buildKmz(d, { includePhotos: true, renderIcon })).arrayBuffer());
    expect(Array.from(await zip.file(`photos/${ph.id}.jpg`)!.async('uint8array'))).toEqual([1, 2, 3]);
    expect(await zip.file('doc.kml')!.async('string')).toContain(`src="photos/${ph.id}.jpg"`);
  });

  it('só gera ícone dos tipos que aparecem no que foi exportado', async () => {
    const s = await seed();
    const d = await collectExportData(db, { kind: 'activity', activityId: s.a.id });
    d.elements = d.elements.filter((e) => e.type === 'poste');
    const zip = await JSZip.loadAsync(await (await buildKmz(d, { includePhotos: false, renderIcon })).arrayBuffer());
    expect(Object.keys(zip.files).filter((n) => n.startsWith('icons/') && !n.endsWith('/'))).toEqual(['icons/poste.png']);
  });
});

describe('fibras e rota na exportação', () => {
  async function withFibers() {
    const { a, cto, poste, cable } = await seed();
    // a CTO pegou a fibra 19 do cabo (48 fibras, padrão internacional) e um segundo cabo está ligado a ele no poste
    await db.elements.update(cto.id, { attrs: { capacity: 16, feedCableId: cable.id, feedFiber: 19 } });
    await db.cables.update(cable.id, { colorStandard: 'tia598' });
    const other = base({
      cableType: 'drop', fiberCount: 2, vertices: [{ elementId: poste.id, lat: poste.lat, lng: poste.lng }, { lat: -23.56, lng: -46.64 }],
      lengthMeters: 10, reserveMeters: 0, totalMeters: 10, activityId: a.id, notes: '', links: [{ elementId: poste.id, cableId: cable.id }],
    }) as Cable;
    await db.cables.add(other);
    return { cto, cable, other, poste };
  }
  const placemark = (doc: ReturnType<typeof parse>, name: string) => Array.from(doc.getElementsByTagName('Placemark')).find((p) => p.getElementsByTagName('name')[0]?.textContent === name);

  it('a CTO leva a fibra de entrada (cor, tubo e cabo) na descrição e nos dados', async () => {
    const { cable } = await withFibers();
    const xml = buildKml(await collect(), opts);
    const pm = placemark(parse(xml), 'C-1')!;
    const desc = pm.getElementsByTagName('description')[0]!.textContent!;
    expect(desc).toContain('Fibra de entrada');
    expect(desc).toContain('Fibra 19 · Vermelho · Tubo 2 Laranja (AS-80 · 48 fibras)');
    const data = Object.fromEntries(Array.from(pm.getElementsByTagName('Data')).map((x) => [x.getAttribute('name'), x.getElementsByTagName('value')[0]?.textContent]));
    expect(data.cabo_entrada).toBe(cable.id);
    expect(data.fibra_entrada).toBe('19');
  });
  it('CTO sem fibra e outros elementos não ganham a linha', async () => {
    await seed();
    const xml = buildKml(await collect(), opts);
    expect(xml).not.toContain('Fibra de entrada');
    expect(xml).not.toContain('fibra_entrada');
  });
  it('o cabo diz o padrão de cores e quantos cabos tem a rota', async () => {
    const { cable, other } = await withFibers();
    const doc = parse(buildKml(await collect(), opts));
    const pm = placemark(doc, 'AS-80 · 48 fibras · 131,5 m')!;
    const desc = pm.getElementsByTagName('description')[0]!.textContent!;
    expect(desc).toContain('Internacional (TIA-598)');
    expect(desc).toContain('2 cabos ligados');
    const data = Object.fromEntries(Array.from(pm.getElementsByTagName('Data')).map((x) => [x.getAttribute('name'), x.getElementsByTagName('value')[0]?.textContent]));
    expect(data.padrao_cores).toBe('tia598');
    expect(data.cabos_na_rota).toBe('2');
    const pm2 = placemark(doc, 'drop · 2 fibras · 10,0 m')!;
    expect(pm2.getElementsByTagName('description')[0]!.textContent).toContain('ABNT');
    expect(cable.id).not.toBe(other.id);
  });
  it('cabo sem ligação não fala em rota; o padrão sem nada gravado é ABNT', async () => {
    await seed();
    const doc = parse(buildKml(await collect(), opts));
    const desc = placemark(doc, 'AS-80 · 48 fibras · 131,5 m')!.getElementsByTagName('description')[0]!.textContent!;
    expect(desc).not.toContain('cabos ligados');
    expect(desc).toContain('ABNT');
  });
  it('o GeoJSON leva o padrão e as ligações do cabo e a fibra da CTO nos atributos', async () => {
    const { cto, cable, poste } = await withFibers();
    const gj = JSON.parse(buildGeoJson(await collect())) as { features: { properties: Record<string, unknown> }[] };
    const cables = gj.features.filter((f) => f.properties.kind === 'cable');
    const main = cables.find((f) => f.properties.id === cable.id)!;
    expect(main.properties.colorStandard).toBe('tia598');
    expect(main.properties.links).toEqual([]);
    const drop = cables.find((f) => f.properties.fiberCount === 2)!;
    expect(drop.properties.colorStandard).toBe('abnt');
    expect(drop.properties.links).toEqual([{ elementId: poste.id, cableId: cable.id }]);
    const c = gj.features.find((f) => f.properties.id === cto.id)!;
    expect(c.properties.attrs).toMatchObject({ feedCableId: cable.id, feedFiber: 19 });
  });
});
