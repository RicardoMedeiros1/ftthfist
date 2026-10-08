import type { Activity, Cable, ElementType, NetworkElement, Photo } from '../../db/types';
import { formatMeters, formatAccuracy } from '../../lib/geo';
import { formatKm, formatClock } from '../../lib/format';
import { KIND_LABEL } from '../activities/labels';
import { cableLabel } from '../cables/cableChoices';
import { LEGEND } from '../cables/style';
import { describeAttrs } from '../elements/attrsView';
import { feedText, readFeed } from '../cables/feed';
import { DEFAULT_COLOR_STANDARD, STANDARD_LABEL } from '../cables/fibers';
import { routeOf } from '../cables/routes';
import { ELEMENT_META } from '../elements/meta';
import { trackDistanceMeters, groupSegments } from '../tracking/trackStats';
import { trackDurationMs, type ExportData } from './exportData';

// Gerador de KML 2.2 (Google Earth). A ordem dos elementos segue o esquema do KML:
//   Placemark: name, description, styleUrl, ExtendedData, geometria · Style: IconStyle, LabelStyle, LineStyle.

/** Pastas, na ordem em que aparecem (vazias são omitidas). */
export const FOLDERS: { type: ElementType; label: string }[] = [
  { type: 'poste', label: 'Postes' },
  { type: 'cto', label: 'CTOs' },
  { type: 'ceo', label: 'CEOs' },
  { type: 'reserva', label: 'Reservas' },
  { type: 'ocorrencia', label: 'Ocorrências' },
  { type: 'outro', label: 'Outros' },
];

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Conteúdo HTML do balão. `]]>` dentro do texto encerraria o CDATA: é quebrado em dois. */
const cdata = (html: string): string => `<![CDATA[${html.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

/** "#2979ff" → "ff ff79 29" no formato do KML: aabbggrr. */
export function kmlColor(hex: string, alpha = 1): string {
  const h = hex.replace('#', '');
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase();
}

export const coordinate = (lat: number, lng: number): string => `${lng.toFixed(7)},${lat.toFixed(7)},0`;

const when = (ms: number) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms);

const table = (rows: [string, string | undefined][]): string =>
  `<table>${rows
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v!)}</td></tr>`)
    .join('')}</table>`;

const activityText = (a: Activity | undefined) =>
  a ? `${a.title} · ${KIND_LABEL[a.kind]} · ${a.status === 'aberta' ? 'aberta' : 'concluída'}` : undefined;

const extended = (pairs: [string, string | number | undefined][]): string => {
  const items = pairs
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(String(v))}</value></Data>`)
    .join('');
  return items ? `<ExtendedData>${items}</ExtendedData>` : '';
};

export const styleIdForElement = (t: ElementType) => `el-${t}`;
export const styleIdForCable = (fiberCount: number): string => {
  const i = LEGEND.findIndex((g) => g.counts.includes(fiberCount));
  return i >= 0 ? `cabo-${i}` : 'cabo-x';
};

export interface KmlOptions {
  /** Caminho do ícone dentro do KMZ (ex.: icons/poste.png). */
  iconHref: (t: ElementType) => string;
  /** Caminho da foto dentro do KMZ; null/ausente = foto não incluída. */
  photoHref?: (p: Photo) => string | null;
}

function styles(usedTypes: ElementType[], opts: KmlOptions): string {
  const icons = usedTypes
    .map(
      (t) =>
        `<Style id="${styleIdForElement(t)}"><IconStyle><scale>1.0</scale><Icon><href>${esc(opts.iconHref(t))}</href></Icon><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>`,
    )
    .join('');
  const cables = LEGEND.map(
    (g, i) => `<Style id="cabo-${i}"><LineStyle><color>${kmlColor(g.color)}</color><width>${g.weight + 1}</width></LineStyle></Style>`,
  ).join('');
  const fallback = `<Style id="cabo-x"><LineStyle><color>${kmlColor('#9e9e9e')}</color><width>3</width></LineStyle></Style>`;
  const track = `<Style id="trilha"><LineStyle><color>${kmlColor('#ffffff', 0.9)}</color><width>2</width></LineStyle></Style>`;
  return icons + cables + fallback + track;
}

function elementPlacemark(e: NetworkElement, d: ExportData, opts: KmlOptions): string {
  const meta = ELEMENT_META[e.type];
  const cable = e.type === 'reserva' ? d.cables.find((c) => c.id === (e.attrs as { cableId?: string }).cableId) : undefined;
  const where =
    e.positionSource === 'gps' && e.accuracy !== undefined ? `GPS ${formatAccuracy(e.accuracy)}` : 'Marcada no mapa';
  const rows: [string, string | undefined][] = [
    ['Tipo', meta.label],
    ['Código', e.code],
    ['Atividade', activityText(d.activities.get(e.activityId))],
    ['Posição', `${e.lat.toFixed(6)}, ${e.lng.toFixed(6)} (${where})`],
    ...describeAttrs(e).map((r): [string, string] => [r.label, r.value]),
    ['Fibra de entrada', e.type === 'cto' ? (feedText(e.attrs, d.cables) ?? undefined) : undefined],
    ['Cabo', cable ? cableLabel(cable) : undefined],
    ['Observações', e.notes],
    ['Registrado', `${e.createdBy} · ${when(e.createdAt)}`],
  ];
  const photos = (d.photosByElement.get(e.id) ?? [])
    .map((p) => opts.photoHref?.(p))
    .filter((h): h is string => !!h)
    .map((h) => `<p><img src="${esc(h)}" width="360"/></p>`)
    .join('');
  const name = e.code || meta.label;
  return `<Placemark><name>${esc(name)}</name><description>${cdata(table(rows) + photos)}</description><styleUrl>#${styleIdForElement(e.type)}</styleUrl>${extended([
    ['id', e.id],
    ['tipo', e.type],
    ['codigo', e.code],
    ['atividade', d.activities.get(e.activityId)?.title],
    ['criado_por', e.createdBy],
    ['criado_em', new Date(e.createdAt).toISOString()],
    ['precisao_m', e.accuracy],
    ['fonte_posicao', e.positionSource],
    ['cabo_entrada', e.type === 'cto' ? readFeed(e.attrs)?.cableId : undefined],
    ['fibra_entrada', e.type === 'cto' ? readFeed(e.attrs)?.fiber : undefined],
  ])}<Point><coordinates>${coordinate(e.lat, e.lng)}</coordinates></Point></Placemark>`;
}

function cablePlacemark(c: Cable, d: ExportData): string {
  const route = routeOf(c.id, d.cables).cableIds;
  const rows: [string, string | undefined][] = [
    ['Tipo', c.cableType],
    ['Fibras', String(c.fiberCount)],
    ['Cores das fibras', STANDARD_LABEL[c.colorStandard ?? DEFAULT_COLOR_STANDARD]],
    ['Rota', route.length > 1 ? `${route.length} cabos ligados` : undefined],
    ['Traçado', formatMeters(c.lengthMeters)],
    ['Reservas', formatMeters(c.reserveMeters)],
    ['Total', formatMeters(c.totalMeters)],
    ['Pontos', String(c.vertices.length)],
    ['Atividade', activityText(d.activities.get(c.activityId))],
    ['Observações', c.notes],
    ['Registrado', `${c.createdBy} · ${when(c.createdAt)}`],
  ];
  return `<Placemark><name>${esc(`${c.cableType} · ${c.fiberCount} fibras · ${formatMeters(c.totalMeters)}`)}</name><description>${cdata(table(rows))}</description><styleUrl>#${styleIdForCable(c.fiberCount)}</styleUrl>${extended([
    ['id', c.id],
    ['tipo_cabo', c.cableType],
    ['fibras', c.fiberCount],
    ['padrao_cores', c.colorStandard ?? DEFAULT_COLOR_STANDARD],
    ['cabos_na_rota', route.length],
    ['tracado_m', c.lengthMeters],
    ['reservas_m', c.reserveMeters],
    ['total_m', c.totalMeters],
    ['atividade', d.activities.get(c.activityId)?.title],
    ['criado_por', c.createdBy],
    ['criado_em', new Date(c.createdAt).toISOString()],
  ])}<LineString><tessellate>1</tessellate><coordinates>${c.vertices.map((v) => coordinate(v.lat, v.lng)).join(' ')}</coordinates></LineString></Placemark>`;
}

function trackPlacemark(t: ExportData['tracks'][number]): string | null {
  const segs = groupSegments(t.points).filter((s) => s.length >= 2);
  if (segs.length === 0) return null;
  const dist = trackDistanceMeters(t.points);
  const rows: [string, string | undefined][] = [
    ['Atividade', activityText(t.activity)],
    ['Distância', formatKm(dist)],
    ['Duração', formatClock(trackDurationMs(t.points))],
    ['Pontos', String(t.points.length)],
    ['Trechos', String(segs.length)],
  ];
  const lines = segs
    .map((s) => `<LineString><tessellate>1</tessellate><coordinates>${s.map((p) => coordinate(p.lat, p.lng)).join(' ')}</coordinates></LineString>`)
    .join('');
  return `<Placemark><name>${esc(`Trilha — ${t.activity.title}`)}</name><description>${cdata(table(rows))}</description><styleUrl>#trilha</styleUrl>${extended([
    ['atividade', t.activity.title],
    ['distancia_m', Math.round(dist * 100) / 100],
    ['pontos', t.points.length],
    ['trechos', segs.length],
  ])}<MultiGeometry>${lines}</MultiGeometry></Placemark>`;
}

const folder = (name: string, items: string[]) => (items.length ? `<Folder><name>${esc(name)}</name>${items.join('')}</Folder>` : '');

/** O KML completo (doc.kml). Pastas por tipo; as vazias são omitidas. */
export function buildKml(d: ExportData, opts: KmlOptions): string {
  const usedTypes = FOLDERS.map((f) => f.type).filter((t) => d.elements.some((e) => e.type === t));
  const folders = FOLDERS.map((f) =>
    folder(
      f.label,
      d.elements.filter((e) => e.type === f.type).map((e) => elementPlacemark(e, d, opts)),
    ),
  );
  folders.push(folder('Cabos', d.cables.map((c) => cablePlacemark(c, d))));
  folders.push(folder('Trilhas', d.tracks.flatMap((t) => trackPlacemark(t) ?? [])));

  const intro = `Exportado do RotaFibra em ${when(d.generatedAt)} (versão ${d.appVersion}).`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>` +
    `<name>${esc(`RotaFibra — ${d.title}`)}</name><description>${esc(intro)}</description>` +
    styles(usedTypes, opts) +
    folders.join('') +
    `</Document></kml>\n`
  );
}
