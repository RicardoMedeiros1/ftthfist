import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScreenShell from '../../components/ScreenShell';
import { formatDateTime, plural } from '../../lib/format';
import { goBack, navigate } from '../../lib/route';
import { mapCommands } from '../map/mapCommands';
import { useTechnician } from '../settings/useTechnician';
import { ReferenceImportError, browserParseXml, parseReferenceFile, type ParsedLayer } from './kmlImport';
import { references } from './referenceRepo';
import type { ReferenceLayer } from '../../db/types';
import './reference.css';

type Import =
  | { s: 'idle' }
  | { s: 'reading' }
  | { s: 'preview'; parsed: ParsedLayer; fileName: string; name: string }
  | { s: 'saving' }
  | { s: 'done'; layer: ReferenceLayer }
  | { s: 'error'; message: string };

export const describeCounts = (c: { points: number; lines: number; polygons: number }) =>
  [c.points && plural(c.points, 'ponto', 'pontos'), c.lines && plural(c.lines, 'linha', 'linhas'), c.polygons && plural(c.polygons, 'polígono', 'polígonos')]
    .filter(Boolean)
    .join(' · ');

export function viewOnMap(layer: Pick<ReferenceLayer, 'bounds' | 'id' | 'visible'>) {
  if (!layer.visible) void references.setVisible(layer.id, true);
  mapCommands.fitBounds(layer.bounds);
  navigate('map');
}

export default function CamadasScreen() {
  const list = useLiveQuery(() => references.list());
  const technician = useTechnician();
  const [imp, setImp] = useState<Import>({ s: 'idle' });
  const picker = useRef<HTMLInputElement>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImp({ s: 'reading' });
    // deixa a tela mostrar "Lendo…" antes do trabalho pesado de ler o arquivo
    await new Promise((r) => setTimeout(r, 30));
    try {
      const parsed = await parseReferenceFile(await file.arrayBuffer(), file.name, { parseXml: browserParseXml });
      setImp({ s: 'preview', parsed, fileName: file.name, name: parsed.name });
    } catch (err) {
      setImp({ s: 'error', message: err instanceof ReferenceImportError ? err.message : 'Não foi possível ler este arquivo.' });
    }
  }

  async function save(p: Extract<Import, { s: 'preview' }>) {
    setImp({ s: 'saving' });
    try {
      const layer = await references.importLayer(p.parsed, { name: p.name, fileName: p.fileName }, technician ?? '');
      setImp({ s: 'done', layer });
    } catch {
      setImp({ s: 'error', message: 'Não foi possível salvar a camada neste aparelho (falta espaço?). Nada foi gravado.' });
    }
  }

  return (
    <ScreenShell title="Camadas de referência" onBack={() => goBack('config')}>
      <p className="hint">
        Importe um arquivo KML ou KMZ de uma rede existente para consultar no mapa. A camada é só para consulta (não é editada) e fica salva neste aparelho,
        mesmo sem internet. Ela não entra no backup: se precisar, importe o arquivo de novo.
      </p>

      <section className="section" aria-label="Importar">
        <input
          ref={picker}
          type="file"
          accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
          hidden
          onChange={(e) => void pick(e)}
        />
        {(imp.s === 'idle' || imp.s === 'error' || imp.s === 'done') && (
          <button className="btn btn-primary btn-block" onClick={() => picker.current?.click()}>
            Importar arquivo KML/KMZ
          </button>
        )}
        {imp.s === 'reading' && <div role="status">Lendo o arquivo…</div>}
        {imp.s === 'saving' && <div role="status">Salvando a camada…</div>}
        {imp.s === 'error' && <div className="alert" role="alert">{imp.message}</div>}

        {imp.s === 'preview' && (
          <>
            <div className="card">
              <div className="card-title">{imp.fileName}</div>
              <div className="card-meta">{describeCounts(imp.parsed.counts)}</div>
              {imp.parsed.skipped > 0 && (
                <div className="card-meta">
                  {plural(imp.parsed.skipped, 'item ficou', 'itens ficaram')} de fora por não ter coordenadas válidas.
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="layer-name">Nome da camada</label>
              <input id="layer-name" type="text" value={imp.name} maxLength={100} onChange={(e) => setImp({ ...imp, name: e.target.value })} />
            </div>
            <div className="placement-row">
              <button className="btn" onClick={() => setImp({ s: 'idle' })}>Cancelar</button>
              <button className="btn btn-primary" onClick={() => void save(imp)}>Importar</button>
            </div>
          </>
        )}

        {imp.s === 'done' && (
          <>
            <div className="ok-note" role="status">
              Camada “{imp.layer.name}” importada: {describeCounts(imp.layer.counts)}.
            </div>
            <button className="btn btn-block" onClick={() => viewOnMap(imp.layer)}>Ver no mapa</button>
          </>
        )}
      </section>

      <section className="section" aria-label="Camadas importadas">
        <h2>Camadas neste aparelho</h2>
        {list === undefined ? null : list.length === 0 ? (
          <p className="hint">Nenhuma camada importada ainda.</p>
        ) : (
          list.map((l) => (
            <article key={l.id} className="card" aria-label={`Camada ${l.name}`}>
              <div className="card-title">
                <span className="ref-dot" style={{ background: l.color }} aria-hidden="true" />
                {l.name}
              </div>
              <div className="card-meta">{describeCounts(l.counts)}</div>
              <div className="card-meta">{l.fileName} · importada em {formatDateTime(l.createdAt)}</div>
              <div className="card-actions">
                <button className="btn btn-small" aria-pressed={l.visible} onClick={() => void references.setVisible(l.id, !l.visible)}>
                  {l.visible ? 'Ocultar' : 'Mostrar'}
                </button>
                <button className="btn btn-small" onClick={() => viewOnMap(l)}>Ver no mapa</button>
                <button className="btn btn-small" onClick={() => navigate('camada', { id: l.id })}>Abrir</button>
              </div>
            </article>
          ))
        )}
      </section>
    </ScreenShell>
  );
}
