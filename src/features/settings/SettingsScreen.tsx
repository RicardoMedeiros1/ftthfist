import { useEffect, useState, type FormEvent } from 'react';
import ScreenShell from '../../components/ScreenShell';
import { useLiveQuery } from 'dexie-react-hooks';
import { SETTING_KEYS, getSetting, setSetting } from '../../db/db';
import { formatAgo } from '../../lib/format';
import { goBack, navigate } from '../../lib/route';
import AccountCard from '../account/AccountCard';
import AdminCard from '../admin/AdminCard';
import PanelCard from '../panel/PanelCard';
import { useAccount } from '../account/accountStore';
import { isSupabaseConfigured } from '../account/supabaseClient';
import CableTypesEditor from '../cables/CableTypesEditor';
import { useTechnician } from './useTechnician';

export default function SettingsScreen() {
  const saved = useTechnician();
  const lastBackupAt = useLiveQuery(() => getSetting<number | null>(SETTING_KEYS.lastBackupAt, null));
  const [name, setName] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  // Depois de aprovado, o nome vem do cadastro (e o que vai para o servidor): nao se edita aqui.
  const locked = useAccount((a) => a.status === 'ativo');

  useEffect(() => {
    if (saved !== undefined) setName(saved);
  }, [saved]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await setSetting(SETTING_KEYS.technician, name.trim());
    setJustSaved(true);
  }

  // Espera o nome carregar do banco para o campo não aparecer vazio e ser sobrescrito.
  if (saved === undefined) return <ScreenShell title="Configurações" onBack={() => goBack('map')}>{null}</ScreenShell>;

  return (
    <ScreenShell title="Configurações" onBack={() => goBack('map')}>
      <form onSubmit={onSubmit} className="screen-body" style={{ padding: 0 }}>
        <div className="field">
          <label htmlFor="technician">Nome do técnico</label>
          <input
            id="technician"
            type="text"
            autoComplete="name"
            disabled={locked}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setJustSaved(false);
            }}
          />
          <p className="hint">{locked ? 'Definido pelo seu cadastro. Para mudar, fale com o administrador.' : 'Aparece em tudo o que você registrar. Defina uma vez só.'}</p>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={locked || name.trim() === saved}>
          Salvar
        </button>
        {justSaved && <div className="ok-note" role="status">Salvo.</div>}
      </form>
      <AccountCard />
      <PanelCard />
      <AdminCard />
      <CableTypesEditor />
      <section className="card" aria-label="Camadas de referência">
        <div className="card-title">Camadas de referência</div>
        <div className="card-meta">Importe um KML/KMZ de uma rede existente para consultar no mapa.</div>
        <button className="btn btn-block" onClick={() => navigate('camadas')}>
          Abrir camadas
        </button>
      </section>
      <section className="card" aria-label="Exportar">
        <div className="card-title">Exportar para Google Earth</div>
        <div className="card-meta">Gera um arquivo KMZ (ou GeoJSON) com a rede, os cabos e as trilhas.</div>
        <button className="btn btn-block" onClick={() => navigate('exportar')}>
          Exportar rede
        </button>
      </section>
      <section className="card" aria-label="Backup">
        <div className="card-title">Backup e restauração</div>
        <div className="card-meta">
          {lastBackupAt ? `Último backup ${formatAgo(Date.now() - lastBackupAt)}` : 'Nenhum backup feito ainda'}
        </div>
        <button className="btn btn-block" onClick={() => navigate('backup')}>
          Abrir backup
        </button>
      </section>
      <p className="hint">Versão do app: {__BUILD_ID__}</p>
      <p className="hint">Servidor (conta): {isSupabaseConfigured ? 'ligado neste app' : 'não configurado neste app — a conta fica desligada'}</p>
    </ScreenShell>
  );
}
