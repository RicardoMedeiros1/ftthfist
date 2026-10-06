import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ConfirmDialog from '../../components/ConfirmDialog';
import ScreenShell from '../../components/ScreenShell';
import { SETTING_KEYS, db, getSetting, setSetting } from '../../db/db';
import { formatAgo, formatBytes, formatDateTime } from '../../lib/format';
import { goBack } from '../../lib/route';
import { canShareFile, downloadFile, shareFile } from '../../lib/share';
import { requestPersistence, useStorageInfo } from '../../lib/storage';
import {
  BackupError,
  applyBackup,
  backupFileName,
  buildBackup,
  dataSummary,
  describeCounts,
  parseBackup,
  summarizeBackup,
  type ParsedBackup,
  type RestoreResult,
} from './backup';
import './backup.css';

type Exported =
  | { s: 'idle' }
  | { s: 'building'; pct: number }
  | { s: 'ready'; file: File }
  | { s: 'saved'; file: File; how: 'shared' | 'downloaded' }
  | { s: 'error'; message: string };

type Restore =
  | { s: 'idle' }
  | { s: 'reading' }
  | { s: 'preview'; parsed: ParsedBackup; name: string; mode: 'merge' | 'replace' }
  | { s: 'applying' }
  | { s: 'done'; result: RestoreResult }
  | { s: 'error'; message: string };

function totals(r: RestoreResult) {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const [table, c] of Object.entries(r.counts)) {
    if (table === 'settings') continue;
    added += c.added;
    updated += c.updated;
    skipped += c.skipped;
  }
  return { added, updated, skipped };
}

export default function BackupScreen() {
  const summary = useLiveQuery(() => dataSummary(db));
  const lastBackupAt = useLiveQuery(() => getSetting<number | null>(SETTING_KEYS.lastBackupAt, null));
  const { info: storage, refresh: refreshStorage } = useStorageInfo();
  const [exp, setExp] = useState<Exported>({ s: 'idle' });
  const [restore, setRestore] = useState<Restore>({ s: 'idle' });
  const [confirmReplace, setConfirmReplace] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const markSaved = () => setSetting(SETTING_KEYS.lastBackupAt, Date.now());

  async function prepare() {
    setExp({ s: 'building', pct: 0 });
    try {
      const { blob } = await buildBackup(db, {
        appVersion: __BUILD_ID__,
        onProgress: (pct) => setExp({ s: 'building', pct }),
      });
      setExp({ s: 'ready', file: new File([blob], backupFileName(new Date()), { type: 'application/zip' }) });
    } catch {
      setExp({ s: 'error', message: 'Não foi possível gerar o backup. Tente de novo.' });
    }
  }

  // O menu de compartilhar exige um toque "fresco": por isso o backup é preparado antes e entregue por outro botão.
  async function share(file: File) {
    try {
      if ((await shareFile(file, 'Backup RotaFibra')) === 'shared') {
        await markSaved();
        setExp({ s: 'saved', file, how: 'shared' });
      }
    } catch {
      setExp({ s: 'error', message: 'Não foi possível abrir o compartilhamento. Use "Baixar arquivo".' });
    }
  }

  async function download(file: File) {
    downloadFile(file);
    await markSaved();
    setExp({ s: 'saved', file, how: 'downloaded' });
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRestore({ s: 'reading' });
    try {
      setRestore({ s: 'preview', parsed: await parseBackup(file), name: file.name, mode: 'merge' });
    } catch (err) {
      setRestore({
        s: 'error',
        message: err instanceof BackupError ? err.message : 'Não foi possível ler este arquivo.',
      });
    }
  }

  async function runRestore(parsed: ParsedBackup, mode: 'merge' | 'replace') {
    setRestore({ s: 'applying' });
    try {
      setRestore({ s: 'done', result: await applyBackup(db, parsed, mode) });
    } catch {
      setRestore({ s: 'error', message: 'A restauração falhou e nada foi alterado neste aparelho. Tente de novo.' });
    }
  }

  return (
    <ScreenShell title="Backup e restauração" onBack={() => goBack('config')}>
      <section className="card" aria-label="Situação">
        <div className="card-title">
          {lastBackupAt ? `Último backup ${formatAgo(Date.now() - lastBackupAt)}` : 'Nenhum backup feito ainda'}
        </div>
        {lastBackupAt && <div className="card-meta">{formatDateTime(lastBackupAt)}</div>}
        <div className="card-meta">
          Neste aparelho: {summary ? describeCounts(summary) : '…'}
          {summary && summary.photoBytes > 0 ? ` (fotos: ${formatBytes(summary.photoBytes)})` : ''}
        </div>
        <p className="hint">Os dados ficam só neste aparelho. Se ele for perdido ou o navegador limpar os dados, sem backup não há como recuperar. As camadas de referência (KML/KMZ importados) não entram no backup: se precisar, importe o arquivo de novo.</p>
      </section>

      <section className="section" aria-label="Fazer backup">
        <h2>Fazer backup</h2>
        {exp.s === 'idle' || exp.s === 'error' ? (
          <button className="btn btn-primary btn-block" onClick={() => void prepare()}>
            Preparar backup
          </button>
        ) : null}
        {exp.s === 'building' && (
          <div role="status">
            Gerando o backup… {Math.round(exp.pct)}%
            <div className="progress"><div style={{ width: `${exp.pct}%` }} /></div>
          </div>
        )}
        {exp.s === 'ready' && (
          <>
            <div className="ok-note" role="status">Backup pronto: {exp.file.name} ({formatBytes(exp.file.size)})</div>
            {canShareFile(exp.file) && (
              <button className="btn btn-primary btn-block" onClick={() => void share(exp.file)}>
                Compartilhar / salvar
              </button>
            )}
            <button className={`btn btn-block ${canShareFile(exp.file) ? '' : 'btn-primary'}`} onClick={() => void download(exp.file)}>
              Baixar arquivo
            </button>
          </>
        )}
        {exp.s === 'saved' && (
          <>
            <div className="ok-note" role="status">
              {exp.how === 'shared' ? 'Backup enviado pelo menu de compartilhar.' : 'Backup baixado.'} Guarde o arquivo em um lugar seguro (nuvem, e-mail, computador).
            </div>
            <button className="btn btn-block" onClick={() => setExp({ s: 'idle' })}>
              Fazer outro
            </button>
          </>
        )}
        {exp.s === 'error' && <div className="alert" role="alert">{exp.message}</div>}
      </section>

      <section className="section" aria-label="Restaurar">
        <h2>Restaurar de um backup</h2>
        <input ref={picker} type="file" accept=".zip,application/zip" hidden onChange={(e) => void pick(e)} />
        {(restore.s === 'idle' || restore.s === 'error' || restore.s === 'done') && (
          <button className="btn btn-block" onClick={() => picker.current?.click()}>
            Escolher arquivo de backup
          </button>
        )}
        {restore.s === 'reading' && <div role="status">Lendo o backup…</div>}
        {restore.s === 'applying' && <div role="status">Restaurando…</div>}
        {restore.s === 'error' && <div className="alert" role="alert">{restore.message}</div>}

        {restore.s === 'preview' && (
          <>
            <div className="card">
              <div className="card-title">{restore.name}</div>
              <div className="card-meta">Feito em {formatDateTime(restore.parsed.file.createdAt)} · versão {restore.parsed.file.appVersion}</div>
              <div className="card-meta">Contém: {describeCounts(summarizeBackup(restore.parsed))}</div>
            </div>
            {restore.parsed.missingPhotos > 0 && (
              <div className="alert" role="alert">
                {restore.parsed.missingPhotos} foto(s) citadas no backup não estão no arquivo e não serão restauradas.
              </div>
            )}
            <div className="chips" role="group" aria-label="Como restaurar">
              <button
                type="button"
                aria-pressed={restore.mode === 'merge'}
                onClick={() => setRestore({ ...restore, mode: 'merge' })}
              >
                Mesclar (recomendado)
              </button>
              <button
                type="button"
                aria-pressed={restore.mode === 'replace'}
                onClick={() => setRestore({ ...restore, mode: 'replace' })}
              >
                Substituir tudo
              </button>
            </div>
            <p className="hint">
              {restore.mode === 'merge'
                ? 'Junta o backup com o que já está aqui. Em caso de conflito, fica o registro mais recente.'
                : 'Apaga os dados de campo deste aparelho (atividades, elementos, cabos, trilhas e fotos) e deixa só o conteúdo do backup. As camadas de referência não são afetadas.'}
            </p>
            <div className="placement-row">
              <button className="btn" onClick={() => setRestore({ s: 'idle' })}>Cancelar</button>
              <button
                className={`btn ${restore.mode === 'replace' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => (restore.mode === 'replace' ? setConfirmReplace(true) : void runRestore(restore.parsed, 'merge'))}
              >
                Restaurar
              </button>
            </div>
          </>
        )}
        {restore.s === 'done' && (
          <div className="ok-note" role="status">
            Restauração concluída: {totals(restore.result).added} novos, {totals(restore.result).updated} atualizados e{' '}
            {totals(restore.result).skipped} já estavam iguais ou mais recentes aqui.
            {restore.result.concludedOpenActivities > 0 &&
              ` ${restore.result.concludedOpenActivities} atividade(s) aberta(s) do backup foram marcadas como concluídas, porque só pode haver uma aberta.`}
            {restore.result.skippedPhotos > 0 && ` ${restore.result.skippedPhotos} foto(s) ficaram de fora (ausentes no arquivo).`}
          </div>
        )}
      </section>

      <section className="section" aria-label="Proteção do armazenamento">
        <h2>Proteção dos dados</h2>
        <div className="card-meta">
          {storage?.persisted === true && 'Proteção ativa: o navegador não apaga os dados do app por falta de espaço.'}
          {storage?.persisted === false && 'Sem proteção: o navegador pode apagar os dados do app se faltar espaço no aparelho.'}
          {storage?.persisted === null && 'Este navegador não informa se os dados estão protegidos.'}
          {storage === null && '…'}
        </div>
        {storage?.usage != null && storage.quota != null && (
          <div className="card-meta">Em uso: {formatBytes(storage.usage)} de {formatBytes(storage.quota)} disponíveis.</div>
        )}
        {storage?.persisted === false && (
          <button className="btn btn-block" onClick={() => void requestPersistence().then(refreshStorage)}>
            Proteger os dados
          </button>
        )}
        <p className="hint">Instalar o app na tela inicial ajuda o navegador a conceder a proteção. Ela não substitui o backup.</p>
      </section>

      {confirmReplace && restore.s === 'preview' && (
        <ConfirmDialog
          title="Substituir tudo?"
          message="Isto apaga os dados atuais deste aparelho e coloca no lugar os do backup. Se não tiver certeza, cancele e faça um backup antes."
          confirmLabel="Substituir"
          danger
          onCancel={() => setConfirmReplace(false)}
          onConfirm={() => {
            setConfirmReplace(false);
            void runRestore(restore.parsed, 'replace');
          }}
        />
      )}
    </ScreenShell>
  );
}
