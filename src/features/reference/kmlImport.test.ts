import 'fake-indexeddb/auto';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import { activityRepo } from '../activities/activityRepo';
import { elementRepo } from '../elements/elementRepo';
import { collectExportData } from '../export/exportData';
import { buildKml } from '../export/kml';
import { ReferenceImportError, parseReferenceFile, type ParseXml } from './kmlImport';

const parseXml: ParseXml = (text) =>
  new DOMParser({ onError: (level, msg) => { if (level !== 'warning') throw new Error(msg); } }).parseFromString(text, 'text/xml') as unknown as Document;
const enc = (s: string) => new TextEncoder().encode(s);
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const parse = (kml: string, name = 'rede.kml', limits = {}) => parseReferenceFile(buf(enc(kml)), name, { parseXml, limits });
const wrap = (body: string, name = '') =>
  `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${name ? `<name>${name}</name>` : ''}${body}</Document></kml>`;
const pm = (name: string, geom: string, extra = '') => `<Placemark><name>${name}</name>${extra}${geom}</Placemark>`;
const pt = (lng: number, lat: number) => `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;

describe('parseReferenceFile: KML', () => {
  it('lê pontos, linhas e polígonos, com lon/lat na ordem certa e sem altitude', async () => {
    const r = await parse(
      wrap(
        pm('CTO-1', pt(-46.63, -23.55)) +
          pm('Cabo A', '<LineString><coordinates>-46.63,-23.55,10 -46.631,-23.551,12</coordinates></LineString>') +
          pm('Quadra', '<Polygon><outerBoundaryIs><LinearRing><coordinates>-46.6,-23.5,0 -46.61,-23.5,0 -46.61,-23.51,0 -46.6,-23.5,0</coordinates></LinearRing></outerBoundaryIs></Polygon>'),
        'Rede da Rua A',
      ),
    );
    expect(r.name).toBe('Rede da Rua A');
    expect(r.counts).toEqual({ points: 1, lines: 1, polygons: 1 });
    expect(r.features[0]).toMatchObject({ name: 'CTO-1', geom: { kind: 'point', coord: [-46.63, -23.55] } });
    expect(r.features[1]!.geom).toEqual({ kind: 'line', parts: [[[-46.63, -23.55], [-46.631, -23.551]]] });
    expect(r.features[2]!.geom.kind).toBe('polygon');
    expect(r.bounds).toEqual([-23.551, -46.631, -23.5, -46.6]);
    expect(r.skipped).toBe(0);
  });

  it('percorre pastas aninhadas e usa o nome do arquivo quando o KML não tem nome', async () => {
    const r = await parse(
      `<kml xmlns="http://www.opengis.net/kml/2.2"><Folder><Folder>${pm('A', pt(-46, -23))}</Folder>${pm('B', pt(-46.1, -23.1))}</Folder></kml>`,
      'Minha Rede 2026.kml',
    );
    expect(r.features.map((f) => f.name)).toEqual(['A', 'B']);
    expect(r.name).toBe('Minha Rede 2026');
  });

  it('descrição em HTML vira texto puro (nada de tag, script ou imagem)', async () => {
    const html = '<![CDATA[<h3>Poste 12</h3><img src="http://x/y.png" onerror="alert(1)"><script>alert(2)</script><table><tr><td>Dono</td><td>Enel &amp; Cia</td></tr></table>]]>';
    const r = await parse(wrap(pm('P', pt(-46, -23), `<description>${html}</description>`)));
    expect(r.features[0]!.description).toBe('Poste 12\nDono Enel & Cia');
    expect(r.features[0]!.description).not.toMatch(/[<>]|alert|http/);
  });

  it('nome com HTML também vira texto puro', async () => {
    const r = await parse(wrap(pm('<![CDATA[<b>CEO</b> <i>7</i>]]>', pt(-46, -23))));
    expect(r.features[0]!.name).toBe('CEO 7');
  });

  it('ExtendedData vira atributos legíveis; estilo e metadados do KML ficam de fora', async () => {
    const r = await parse(
      wrap(
        '<Style id="s"><IconStyle><color>ff0000ff</color></IconStyle></Style>' +
          pm('P', pt(-46, -23), '<styleUrl>#s</styleUrl><ExtendedData><Data name="Dono"><value>Enel</value></Data><Data name="Plaqueta"><value>X9</value></Data></ExtendedData>'),
      ),
    );
    expect(r.features[0]!.props).toEqual([['Dono', 'Enel'], ['Plaqueta', 'X9']]);
  });

  it('MultiGeometry vira uma peça por geometria (ponto + linha)', async () => {
    const r = await parse(wrap(pm('Mista', `<MultiGeometry>${pt(-46, -23)}<LineString><coordinates>-46,-23 -46.1,-23.1</coordinates></LineString></MultiGeometry>`)));
    expect(r.features.map((f) => f.geom.kind).sort()).toEqual(['line', 'point']);
    expect(r.features.every((f) => f.name === 'Mista')).toBe(true);
  });

  it('polígono: só o anel externo (furos ignorados)', async () => {
    const ring = (c: string) => `<LinearRing><coordinates>${c}</coordinates></LinearRing>`;
    const r = await parse(wrap(pm('Q', `<Polygon><outerBoundaryIs>${ring('0,0 1,0 1,1 0,0')}</outerBoundaryIs><innerBoundaryIs>${ring('0.2,0.2 0.4,0.2 0.4,0.4 0.2,0.2')}</innerBoundaryIs></Polygon>`)));
    expect(r.features[0]!.geom).toEqual({ kind: 'polygon', rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
  });

  it('descarta coordenadas inválidas e conta o que ficou de fora', async () => {
    const r = await parse(
      wrap(
        pm('ok', pt(-46, -23)) +
          pm('lat inválida', pt(-46, 95)) +
          pm('lon inválida', pt(200, -23)) +
          pm('sem geometria', '') +
          pm('linha de 1 ponto', '<LineString><coordinates>-46,-23</coordinates></LineString>') +
          pm('linha com 1 ponto ruim', '<LineString><coordinates>-46,-23 -46.1,95 -46.2,-23.2</coordinates></LineString>'),
      ),
    );
    expect(r.features.map((f) => f.name)).toEqual(['ok', 'linha com 1 ponto ruim']);
    expect(r.features[1]!.geom).toEqual({ kind: 'line', parts: [[[-46, -23], [-46.2, -23.2]]] });
    expect(r.skipped).toBe(4);
  });

  it('só elementos inválidos: mensagem clara', async () => {
    await expect(parse(wrap(pm('x', pt(-46, 95)) + pm('y', '')))).rejects.toThrow(/sem coordenadas válidas/);
  });

  it('KML sem nenhum elemento: mensagem clara', async () => {
    await expect(parse(wrap(''))).rejects.toThrow(/não tem nenhum ponto/);
  });

  it('arrredonda para 7 casas decimais (cerca de 1 cm)', async () => {
    const r = await parse(wrap(pm('p', pt(-46.123456789012, -23.987654321098))));
    expect(r.features[0]!.geom).toEqual({ kind: 'point', coord: [-46.1234568, -23.9876543] });
  });
});

describe('parseReferenceFile: arquivos que não servem', () => {
  it('vazio, texto qualquer, XML que não é KML e KML quebrado', async () => {
    await expect(parseReferenceFile(new ArrayBuffer(0), 'a.kml', { parseXml })).rejects.toThrow(/vazio/);
    await expect(parse('isto não é xml')).rejects.toBeInstanceOf(ReferenceImportError);
    await expect(parse('<gpx><trk/></gpx>')).rejects.toThrow(/não é um KML/);
    await expect(parse('<kml><Document><Placemark></Document>')).rejects.toThrow(/XML válido/);
  });

  it('arquivo maior que o limite é recusado antes de ler', async () => {
    await expect(parse(wrap(pm('a', pt(-46, -23))), 'a.kml', { maxFileBytes: 50 })).rejects.toThrow(/grande demais/);
  });

  it('mais elementos que o limite: orienta a dividir o arquivo', async () => {
    const many = Array.from({ length: 6 }, (_, i) => pm(`p${i}`, pt(-46 - i / 1000, -23))).join('');
    await expect(parse(wrap(many), 'a.kml', { maxFeatures: 5 })).rejects.toThrow(/Divida/);
  });
});

describe('parseReferenceFile: codificação', () => {
  it('ISO-8859-1 declarado no XML (acentos de arquivos antigos)', async () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?><kml><Document>${pm('Conceição', pt(-46, -23))}</Document></kml>`;
    const bytes = Uint8Array.from(Array.from(xml, (ch) => ch.charCodeAt(0)));
    const r = await parseReferenceFile(buf(bytes), 'a.kml', { parseXml });
    expect(r.features[0]!.name).toBe('Conceição');
  });

  it('UTF-8 com BOM', async () => {
    const body = enc(wrap(pm('Ação', pt(-46, -23))));
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(body, 3);
    const r = await parseReferenceFile(buf(bytes), 'a.kml', { parseXml });
    expect(r.features[0]!.name).toBe('Ação');
  });

  it('UTF-16 com BOM', async () => {
    const text = wrap(pm('São Paulo', pt(-46, -23)));
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) {
      bytes[2 + i * 2] = text.charCodeAt(i) & 0xff;
      bytes[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    const r = await parseReferenceFile(buf(bytes), 'a.kml', { parseXml });
    expect(r.features[0]!.name).toBe('São Paulo');
  });
});

describe('parseReferenceFile: KMZ', () => {
  const kmz = async (files: Record<string, string | Uint8Array>) => {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    return zip.generateAsync({ type: 'arraybuffer' });
  };
  const kml = wrap(pm('CTO-1', pt(-46.63, -23.55)), 'Do KMZ');

  it('lê doc.kml e ignora ícones e imagens', async () => {
    const r = await parseReferenceFile(await kmz({ 'doc.kml': kml, 'icons/a.png': new Uint8Array([1, 2, 3]) }), 'rede.kmz', { parseXml });
    expect(r.name).toBe('Do KMZ');
    expect(r.counts.points).toBe(1);
  });

  it('sem doc.kml: usa o .kml mais raso', async () => {
    const r = await parseReferenceFile(await kmz({ 'sub/fundo/b.kml': wrap(pm('B', pt(-1, -1))), 'a.kml': kml }), 'x.kmz', { parseXml });
    expect(r.features[0]!.name).toBe('CTO-1');
  });

  it('KMZ sem nenhum .kml', async () => {
    await expect(parseReferenceFile(await kmz({ 'leia-me.txt': 'oi' }), 'x.kmz', { parseXml })).rejects.toThrow(/nenhum arquivo \.kml/);
  });

  it('zip corrompido (começa com PK mas não abre)', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9, 9, 9, 9, 9]);
    await expect(parseReferenceFile(buf(bytes), 'x.kmz', { parseXml })).rejects.toThrow(/corrompido/);
  });

  it('KML gigante dentro do KMZ (bomba de descompressão) é recusado pelo tamanho declarado', async () => {
    const big = wrap('<!-- ' + 'a'.repeat(5000) + ' -->' + pm('p', pt(-46, -23)));
    await expect(parseReferenceFile(await kmz({ 'doc.kml': big }), 'x.kmz', { parseXml, limits: { maxKmlBytes: 1000 } })).rejects.toThrow(/grande demais/);
  });
});

describe('ida e volta com o nosso próprio KML exportado', () => {
  let db: RotaFibraDB;
  beforeEach(async () => {
    db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
    await db.open();
  });

  it('reimporta o que o passo 4 exporta: pontos, cabo e trilha, com texto puro', async () => {
    await activityRepo(db).create({ kind: 'implantacao', title: 'Rua <A> & B' }, 'Carlos');
    const els = elementRepo(db);
    await els.create({ type: 'poste', lat: -23.55, lng: -46.63, accuracy: 8, positionSource: 'gps', code: 'P-1', notes: 'perto da <esquina>' }, 'Carlos');
    await els.create({ type: 'cto', lat: -23.551, lng: -46.631, positionSource: 'manual', code: 'CTO-7' }, 'Carlos');
    const act = (await db.activities.toArray())[0]!;
    await db.cables.add({
      id: 'c1', createdAt: 1, updatedAt: 1, createdBy: 'C', deleted: false, syncStatus: 'pending', cableType: 'AS-80', fiberCount: 12,
      vertices: [{ lat: -23.55, lng: -46.63 }, { lat: -23.551, lng: -46.631 }], lengthMeters: 150, reserveMeters: 0, totalMeters: 150, activityId: act.id, notes: '',
    });
    const exported = buildKml(await collectExportData(db, { kind: 'network' }), { iconHref: (t) => `icons/${t}.png` });
    const r = await parse(exported, 'export.kml');
    expect(r.counts).toEqual({ points: 2, lines: 1, polygons: 0 });
    const p1 = r.features.find((f) => f.name === 'P-1')!;
    expect(p1.geom).toEqual({ kind: 'point', coord: [-46.63, -23.55] });
    expect(p1.description).toContain('perto da <esquina>'); // texto, não HTML
    expect(p1.description).toContain('Poste');
    expect(r.features.find((f) => f.geom.kind === 'line')!.name).toContain('AS-80');
  });
});
