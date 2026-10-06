import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScreenShell from '../../components/ScreenShell';
import { db } from '../../db/db';
import { isMine } from '../../lib/ownership';
import { formatBytes, formatDateTime, formatKm, plural } from '../../lib/format';
import { formatMeters } from '../../lib/geo';
import { goBack, useRouteId } from '../../lib/route';
import { canShareFile, downloadFile, shareFile, shareableFile } from '../../lib/share';
import { activities } from '../activities/activityRepo';
import { elementSvg } from '../elements/elementSvg';
import { collectExportData, exportFileName, summarizeExport, type ExportData, type ExportScope } from './exportData';
import { GEOJSON_MIME, buildGeoJson } from './geojson';
import { KMZ_MIME, buildKmz, renderElementIconPng } from './kmz';
import './backup.css';
import './export.css';

type Format = 'kmz' | 'geojson';

type Prepared =
  | { s: 'idle' }
  | { s: 'building'; pct: number }
  | { s: 'ready'; file: File; shareable: File | null }
  | { s: 'saved'; file: File; how: 'shared' | 'downloaded' }
  | { s: 'error'; message: string };

const NETWORK = 'rede';
/** So os registros de quem usa o app (sem os dos colegas baixados pela sincronizacao). */
const MINE = 'rede-minha';
const toScope = (v: string): ExportScope =>
  v === NETWORK ? { kind: 'network' } : v === MINE ? { kind: 'network', onlyMine: true } : { kind: 'activity', activityId: v };
const isScope = (d: ExportData, v: string) =>
  d.scope.kind === 'network' ? v === (d.scope.onlyMine ? MINE : NETWORK) : d.scope.activityId === v;

export default function ExportScreen() {
  const routeId = useRouteId();
  // `null` = o que o app escolhe sozinho: com dados de colegas no aparelho, so os meus; senao, a rede toda.
  const [scopeChoice, setScopeChoice] = useState<string | null>(null);
  const hasOthers = useLiveQuery(async () => {
    const other = (r: { deleted: boolean; ownerId?: string }) => !r.deleted && !isMine(r);
    const found = await Promise.all([db.activities.filter(other).first(), db.elements.filter(other).first(), db.cables.filter(other).first()]);
    return found.some(Boolean);
  }, []);
  const scopeValue = scopeChoice ?? routeId ?? (hasOthers ? MINE : NETWORK);
  const setScopeValue = setScopeChoice;
  const [format, setFormat] = useState<Format>('kmz');
  const [photos, setPhotos] = useState(false);
  const [prepared, setPrepared] = useState<Prepared>({ s: 'idle' });
  const run = useRef(0);

  // O id da rota mudou com a tela aberta (histórico, link colado): segue a rota.
  const [seenRouteId, setSeenRouteId] = useState(routeId);
  if (seenRouteId !== routeId) {
    setSeenRouteId(routeId);
    setScopeValue(null);
    setPrepared({ s: 'idle' });
    run.current++;
  }

  const list = useLiveQuery(() => activities.list());
  // `null` = atividade não existe mais (apagada ou link antigo).
  const found = useLiveQuery(
    () => collectExportData(db, toScope(scopeValue), { appVersion: __BUILD_ID__ }).catch(() => null),
    [scopeValue],
  );
  // Ao trocar a seleção o hook pode devolver, por um instante, o resultado da anterior: não vale.
  const data = found && !isScope(found, scopeValue) ? undefined : found;
  const summary = data ? summarizeExport(data) : null;
  const empty = summary !== null && summary.elements === 0 && summary.cables === 0 && summary.trackPoints === 0;
  // "Incluir fotos" só vale para KMZ e quando a seleção tem fotos.
  const withPhotos = format === 'kmz' && photos && (summary?.photos ?? 0) > 0;

  // Mudou qualquer opção: o arquivo pronto não vale mais (e uma geração em andamento é descartada).
  // A trilha continua gravando em segundo plano, então um arquivo antigo pode estar defasado.
  function change(apply: () => void) {
    run.current++;
    setPrepared({ s: 'idle' });
    apply();
  }

  async function prepare() {
    if (!data) return;
    const id = ++run.current;
    const put = (p: Prepared) => {
      if (id === run.current) setPrepared(p);
    };
    put({ s: 'building', pct: 0 });
    try {
      // Dados recolhidos agora, não os do resumo: a trilha pode ter ganhado pontos desde que a tela abriu.
      const fresh = await collectExportData(db, toScope(scopeValue), { appVersion: __BUILD_ID__ });
      const name = exportFileName(fresh.title, format === 'kmz' ? 'kmz' : 'geojson', new Date());
      let blob: Blob;
      let mimes: string[];
      if (format === 'kmz') {
        blob = await buildKmz(fresh, {
          includePhotos: withPhotos,
          renderIcon: (t) => renderElementIconPng(t, elementSvg(t, { size: 64 })),
          onProgress: (pct) => put({ s: 'building', pct }),
        });
        mimes = [KMZ_MIME, 'application/zip'];
      } else {
        blob = new Blob([buildGeoJson(fresh)], { type: GEOJSON_MIME });
        mimes = [GEOJSON_MIME, 'application/json', 'text/plain'];
      }
      const file = new File([blob], name, { type: mimes[0] });
      // O menu de compartilhar do celular só aceita certos tipos de arquivo; se nenhum servir, só o download.
      put({ s: 'ready', file, shareable: shareableFile(blob, name, mimes) });
    } catch {
      put({ s: 'error', message: 'Não foi possível gerar o arquivo. Tente de novo.' });
    }
  }

  // O menu de compartilhar exige um toque "fresco": o arquivo é preparado antes e entregue por outro botão.
  async function share(file: File, original: File) {
    try {
      if ((await shareFile(file, 'Exportação RotaFibra')) === 'shared') setPrepared({ s: 'saved', file: original, how: 'shared' });
    } catch {
      setPrepared({ s: 'error', message: 'Não foi possível abrir o compartilhamento. Prepare de novo e use "Baixar arquivo".' });
    }
  }

  function download(file: File) {
    downloadFile(file);
    setPrepared({ s: 'saved', file, how: 'downloaded' });
  }

  const missing = data === null;

  return (
    <ScreenShell title="Exportar" onBack={() => goBack(routeId ? 'atividades' : 'config')}>
      <section className="section" aria-label="O que exportar">
        <div className="field">
          <label htmlFor="export-scope">O que exportar</label>
          <select id="export-scope" value={scopeValue} onChange={(e) => change(() => setScopeValue(e.target.value))}>
            {hasOthers ? (
              <>
                <option value={MINE}>Só os meus registros</option>
                <option value={NETWORK}>Rede inteira (inclui os dos colegas)</option>
              </>
            ) : (
              <option value={NETWORK}>Rede inteira (todas as atividades)</option>
            )}
            {list?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} · {formatDateTime(a.startedAt)}
              </option>
            ))}
            {/* Link para uma atividade que a lista ainda não trouxe: mantém o valor selecionado visível. */}
            {list !== undefined && scopeValue !== NETWORK && scopeValue !== MINE && !list.some((a) => a.id === scopeValue) && (
              <option value={scopeValue}>Atividade não encontrada</option>
            )}
          </select>
        </div>

        <div className="field">
          <span className="label" id="export-format-label">Formato</span>
          <div className="seg" role="group" aria-labelledby="export-format-label">
            <button type="button" aria-pressed={format === 'kmz'} onClick={() => change(() => setFormat('kmz'))}>
              KMZ
              <small>Google Earth</small>
            </button>
            <button type="button" aria-pressed={format === 'geojson'} onClick={() => change(() => setFormat('geojson'))}>
              GeoJSON
              <small>QGIS e sistemas</small>
            </button>
          </div>
        </div>

        {format === 'kmz' && (
          <div className="field">
            <span className="label" id="export-photos-label">Fotos</span>
            <div className="seg" role="group" aria-labelledby="export-photos-label">
              <button type="button" aria-pressed={!withPhotos} onClick={() => change(() => setPhotos(false))}>
                Sem fotos
              </button>
              <button type="button" aria-pressed={withPhotos} onClick={() => change(() => setPhotos(true))} disabled={summary?.photos === 0}>
                Incluir fotos
              </button>
            </div>
            {summary && (
              <p className="hint">
                {summary.photos === 0
                  ? 'Não há fotos nesta seleção.'
                  : `${plural(summary.photos - summary.photosMissing, 'foto', 'fotos')}, cerca de ${formatBytes(summary.photoBytes)}. Com fotos o arquivo fica bem maior.`}
                {summary.photosMissing > 0 &&
                  ` ${plural(summary.photosMissing, 'foto de colega ainda não foi baixada', 'fotos de colegas ainda não foram baixadas')} e ficará de fora (abra o elemento, com internet, para baixar).`}
              </p>
            )}
          </div>
        )}
        {format === 'geojson' && <p className="hint">O GeoJSON não leva fotos (só quantas há em cada elemento).</p>}
      </section>

      {missing && <div className="alert" role="alert">Esta atividade não existe mais. Escolha outra ou exporte a rede inteira.</div>}

      {summary && !missing && (
        <section className="card" aria-label="Resumo">
          <div className="card-title">{data!.title}</div>
          <div className="card-meta">
            {plural(summary.elements, 'elemento', 'elementos')} · {plural(summary.cables, 'cabo', 'cabos')}
            {summary.cables > 0 ? ` (${formatMeters(summary.cableMeters)})` : ''}
          </div>
          <div className="card-meta">
            Trilha: {summary.trackPoints > 0 ? `${formatKm(summary.trackKm * 1000)} em ${plural(summary.trackPoints, 'ponto', 'pontos')}` : 'nenhuma'}
          </div>
        </section>
      )}
      {empty && !missing && <p className="hint">Não há nada para exportar nesta seleção.</p>}

      <section className="section" aria-label="Arquivo">
        {(prepared.s === 'idle' || prepared.s === 'error') && (
          <button className="btn btn-primary btn-block" disabled={!data || empty} onClick={() => void prepare()}>
            Preparar arquivo
          </button>
        )}
        {prepared.s === 'building' && (
          <div role="status">
            Gerando o arquivo… {Math.round(prepared.pct)}%
            <div className="progress"><div style={{ width: `${prepared.pct}%` }} /></div>
          </div>
        )}
        {prepared.s === 'ready' && (
          <>
            <div className="ok-note" role="status">
              Arquivo pronto: {prepared.file.name} ({formatBytes(prepared.file.size)})
              {withPhotos ? ' · com fotos' : ''}
            </div>
            {prepared.shareable && canShareFile(prepared.shareable) && (
              <button className="btn btn-primary btn-block" onClick={() => void share(prepared.shareable!, prepared.file)}>
                Compartilhar / salvar
              </button>
            )}
            <button className={`btn btn-block ${prepared.shareable ? '' : 'btn-primary'}`} onClick={() => download(prepared.file)}>
              Baixar arquivo
            </button>
          </>
        )}
        {prepared.s === 'saved' && (
          <>
            <div className="ok-note" role="status">
              {prepared.how === 'shared' ? 'Arquivo enviado pelo menu de compartilhar.' : 'Arquivo baixado.'} {prepared.file.name}
            </div>
            <button className="btn btn-block" onClick={() => setPrepared({ s: 'idle' })}>
              Exportar de novo
            </button>
          </>
        )}
        {prepared.s === 'error' && <div className="alert" role="alert">{prepared.message}</div>}
        {format === 'kmz' && <p className="hint">No celular: abra o .kmz com o app Google Earth. No computador: arraste o arquivo para o Google Earth.</p>}
      </section>
    </ScreenShell>
  );
}
