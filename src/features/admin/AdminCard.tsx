import { navigate } from '../../lib/route';
import { useAccount } from '../account/accountStore';

/** Cartao das Configuracoes: so aparece para um administrador ativo. */
export default function AdminCard() {
  const isAdmin = useAccount((a) => a.status === 'ativo' && a.profile?.role === 'admin');
  if (!isAdmin) return null;
  return (
    <section className="card" aria-label="Administração">
      <div className="card-title">Administração</div>
      <div className="card-meta">Aprovar pessoas, ver o que foi alterado e abrir a trilha GPS de um técnico. Precisa de internet.</div>
      <button className="btn btn-block" onClick={() => navigate('pessoas')}>Pessoas</button>
      <button className="btn btn-block" onClick={() => navigate('alteracoes')}>Alterações e conflitos</button>
      <button className="btn btn-block" onClick={() => navigate('atividades')}>Projetos dos técnicos</button>
    </section>
  );
}
