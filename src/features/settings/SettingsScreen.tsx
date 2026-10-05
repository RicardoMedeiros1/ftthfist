import { useEffect, useState, type FormEvent } from 'react';
import ScreenShell from '../../components/ScreenShell';
import { SETTING_KEYS, setSetting } from '../../db/db';
import { goBack } from '../../lib/route';
import { useTechnician } from './useTechnician';

export default function SettingsScreen() {
  const saved = useTechnician();
  const [name, setName] = useState('');
  const [justSaved, setJustSaved] = useState(false);

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
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setJustSaved(false);
            }}
          />
          <p className="hint">Aparece em tudo o que você registrar. Defina uma vez só.</p>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={name.trim() === saved}>
          Salvar
        </button>
        {justSaved && <div className="ok-note" role="status">Salvo.</div>}
      </form>
    </ScreenShell>
  );
}
