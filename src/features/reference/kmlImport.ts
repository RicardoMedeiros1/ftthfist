import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import type { Geometry, Position } from 'geojson';
import JSZip from 'jszip';
import type { RefCoord, RefGeometry } from '../../db/types';
import { toOneLine, toPlainText } from './plainText';

// Lê um .kml ou .kmz de terceiros e devolve só o que o app usa: pontos, linhas e polígonos com nome e texto puro.

export class ReferenceImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceImportError';
  }
}

export interface ParsedFeature {
  name: string;
  description: string;
  props: [string, string][];
  geom: RefGeometry;
}

export interface ParsedLayer {
  name: string;
  features: ParsedFeature[];
  counts: { points: number; lines: number; polygons: number };
  /** Elementos do arquivo sem geometria utilizável. */
  skipped: number;
  /** [sul, oeste, norte, leste] */
  bounds: [number, number, number, number];
}

export interface ImportLimits {
  maxFileBytes: number;
  maxKmlBytes: number;
  maxFeatures: number;
}

export const DEFAULT_LIMITS: ImportLimits = {
  maxFileBytes: 40 * 1024 * 1024,
  maxKmlBytes: 80 * 1024 * 1024,
  maxFeatures: 20_000,
};

export type ParseXml = (text: string) => Document;

/** No navegador. (Nos testes, entra o xmldom.) */
export const browserParseXml: ParseXml = (text) => {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new ReferenceImportError('O arquivo não é um XML válido.');
  return doc;
};

const fmt = (n: number) => n.toLocaleString('pt-BR');

function decode(bytes: Uint8Array): string {
  let label = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  else {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    const declared = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase();
    if (declared && declared !== 'utf-8' && declared !== 'utf8') label = declared;
  }
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function kmlBytesFrom(data: ArrayBuffer, limits: ImportLimits): Promise<Uint8Array> {
  const bytes = new Uint8Array(data);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!isZip) {
    if (bytes.length > limits.maxKmlBytes) throw new ReferenceImportError('O arquivo KML é grande demais.');
    return bytes;
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ReferenceImportError('Este KMZ está corrompido (não abriu como .zip).');
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name));
  // doc.kml na raiz é o padrão do KMZ; senão, o KML mais raso.
  const entry =
    entries.find((f) => f.name.toLowerCase() === 'doc.kml') ??
    entries.sort((a, b) => a.name.split('/').length - b.name.split('/').length || a.name.length - b.name.length)[0];
  if (!entry) throw new ReferenceImportError('Este KMZ não tem nenhum arquivo .kml dentro.');
  // O tamanho declarado no zip é conferido pelo JSZip ao descompactar; recusar antes evita encher a memória.
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === 'number' && declared > limits.maxKmlBytes) throw new ReferenceImportError('O KML dentro do KMZ é grande demais.');
  let out: Uint8Array;
  try {
    out = await entry.async('uint8array');
  } catch {
    throw new ReferenceImportError('Este KMZ está corrompido (não deu para ler o KML).');
  }
  if (out.length > limits.maxKmlBytes) throw new ReferenceImportError('O KML dentro do KMZ é grande demais.');
  return out;
}

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
const validPos = (p: Position): p is [number, number] | [number, number, number] =>
  Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]!) <= 180 && Math.abs(p[1]!) <= 90;
const coords = (list: Position[]): RefCoord[] => list.filter(validPos).map((p) => [r7(p[0]!), r7(p[1]!)]);

/** Geometria do GeoJSON → peças simples. Coleções e "Multi" viram várias peças; inválidas são descartadas. */
function pieces(g: Geometry): RefGeometry[] {
  switch (g.type) {
    case 'Point': {
      const c = coords([g.coordinates]);
      return c[0] ? [{ kind: 'point', coord: c[0] }] : [];
    }
    case 'MultiPoint':
      return coords(g.coordinates).map((coord) => ({ kind: 'point' as const, coord }));
    case 'LineString': {
      const c = coords(g.coordinates);
      return c.length >= 2 ? [{ kind: 'line', parts: [c] }] : [];
    }
    case 'MultiLineString': {
      const parts = g.coordinates.map(coords).filter((c) => c.length >= 2);
      return parts.length ? [{ kind: 'line', parts }] : [];
    }
    case 'Polygon': {
      const ring = coords(g.coordinates[0] ?? []);
      return ring.length >= 3 ? [{ kind: 'polygon', rings: [ring] }] : [];
    }
    case 'MultiPolygon': {
      const rings = g.coordinates.map((poly) => coords(poly[0] ?? [])).filter((r) => r.length >= 3);
      return rings.length ? [{ kind: 'polygon', rings }] : [];
    }
    case 'GeometryCollection':
      return g.geometries.flatMap(pieces);
    default:
      return [];
  }
}

const STYLE_KEYS = /^(name|description|styleurl|stylehash|stylemaphash|stroke.*|fill.*|icon.*|label-.*|visibility|open|snippet|timestamp|begin|end|draworder|altitudemode|tessellate|extrude|coordproperties|@.*|_.*)$/i;

/** O togeojson entrega texto com HTML como `{ "@type": "html", value }`. */
function rawText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'string') return (v as { value: string }).value;
  return undefined;
}

function propsOf(properties: Record<string, unknown> | null | undefined): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(properties ?? {})) {
    if (out.length >= 20) break;
    const raw = rawText(v);
    if (STYLE_KEYS.test(k) || raw === undefined) continue;
    const value = toOneLine(raw, 200);
    const key = toOneLine(k, 60);
    if (key && value) out.push([key, value]);
  }
  return out;
}

const childText = (el: Element, tag: string): string => {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 1 && ((n as Element).localName || n.nodeName) === tag) return n.textContent ?? '';
  }
  return '';
};

function documentName(doc: Document): string {
  const root = doc.documentElement;
  const holder = doc.getElementsByTagName('Document')[0] ?? doc.getElementsByTagName('Folder')[0] ?? root;
  return toOneLine(childText(holder, 'name'), 100);
}

/**
 * Lê um KML/KMZ. `parseXml` entra de fora porque no navegador é o DOMParser e nos testes é o xmldom.
 * Lança ReferenceImportError (mensagem pronta para o técnico) quando o arquivo não serve.
 */
export async function parseReferenceFile(
  data: ArrayBuffer,
  fileName: string,
  opts: { parseXml: ParseXml; limits?: Partial<ImportLimits> },
): Promise<ParsedLayer> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  if (data.byteLength === 0) throw new ReferenceImportError('O arquivo está vazio.');
  if (data.byteLength > limits.maxFileBytes) {
    throw new ReferenceImportError(`O arquivo é grande demais (limite de ${Math.round(limits.maxFileBytes / 1048576)} MB).`);
  }

  const text = decode(await kmlBytesFrom(data, limits));
  let doc: Document;
  try {
    doc = opts.parseXml(text);
  } catch (e) {
    throw e instanceof ReferenceImportError ? e : new ReferenceImportError('O arquivo não é um XML válido.');
  }
  const rootName = (doc.documentElement?.localName || doc.documentElement?.nodeName || '').toLowerCase();
  if (rootName !== 'kml') throw new ReferenceImportError('Este arquivo não é um KML. Escolha um .kml ou .kmz.');

  const collection = kmlToGeoJson(doc);
  const features: ParsedFeature[] = [];
  const counts = { points: 0, lines: 0, polygons: 0 };
  let skipped = 0;
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;
  const grow = ([lng, lat]: RefCoord) => {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  };

  for (const f of collection.features) {
    const made = f.geometry ? pieces(f.geometry) : [];
    if (made.length === 0) {
      skipped++;
      continue;
    }
    const name = toOneLine(rawText(f.properties?.name), 200);
    const description = toPlainText(rawText(f.properties?.description), 2000);
    const props = propsOf(f.properties as Record<string, unknown> | null);
    for (const geom of made) {
      if (geom.kind === 'point') {
        counts.points++;
        grow(geom.coord);
      } else if (geom.kind === 'line') {
        counts.lines++;
        geom.parts.flat().forEach(grow);
      } else {
        counts.polygons++;
        geom.rings.flat().forEach(grow);
      }
      features.push({ name, description, props, geom });
    }
    if (features.length > limits.maxFeatures) {
      throw new ReferenceImportError(`O arquivo tem mais de ${fmt(limits.maxFeatures)} elementos. Divida em arquivos menores e importe um por vez.`);
    }
  }

  if (features.length === 0) {
    throw new ReferenceImportError(
      skipped > 0
        ? `Nenhum ponto, linha ou polígono utilizável (${fmt(skipped)} elemento(s) sem coordenadas válidas).`
        : 'O arquivo não tem nenhum ponto, linha ou polígono.',
    );
  }

  const base = fileName.replace(/\.(kml|kmz)$/i, '').trim();
  return {
    name: documentName(doc) || toOneLine(base, 100) || 'Camada de referência',
    features,
    counts,
    skipped,
    bounds: [south, west, north, east],
  };
}
