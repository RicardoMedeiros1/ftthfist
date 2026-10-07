import { navigate } from '../../lib/route';
import { useAccount } from '../account/accountStore';
import { panelAccess } from './access';

/** Cartao das Configuracoes: so para quem pode abrir o painel (escritorio e administrador). */
export default function PanelCard() {
  const allowed = useAccount((a) => panelAccess(a.status, a.profile?.role) === 'liberado');
  if (!allowed) return null;
  return (
    <section className="card" aria-label="Painel">
      <div className="card-title">Painel</div>
      <div className="card-meta">A rede inteira em tela grande, para acompanhar pelo computador. Só leitura.</div>
      <button className="btn btn-block" onClick={() => navigate('painel')}>Abrir o painel</button>
    </section>
  );
}
