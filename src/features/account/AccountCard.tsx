import { navigate } from '../../lib/route';
import { useAccount } from './accountStore';
import { ROLE_LABEL } from './AccountScreen';

/** Cartao das Configuracoes. Some quando o app nao esta ligado a um servidor (nada muda para quem nao usa conta). */
export default function AccountCard() {
  const status = useAccount((s) => s.status);
  const profile = useAccount((s) => s.profile);
  const email = useAccount((s) => s.email);
  if (status === 'sem-configuracao') return null;

  const line =
    status === 'carregando' ? 'Carregando…'
    : status === 'deslogado' ? 'Você não está conectado. Entre ou peça acesso para enviar seus dados ao servidor.'
    : status === 'pendente' ? 'Aguardando o administrador aprovar o seu pedido.'
    : status === 'desativado' ? 'Acesso desativado pelo administrador.'
    : status === 'verificando' ? `Conectado como ${email}. Falta confirmar a aprovação.`
    : `${profile?.fullName ?? email} · ${profile ? ROLE_LABEL[profile.role] : ''}`;

  return (
    <section className="card" aria-label="Conta">
      <div className="card-title">Conta</div>
      <div className="card-meta">{line}</div>
      <button className="btn btn-block" onClick={() => navigate('conta')}>
        {status === 'deslogado' ? 'Entrar ou pedir acesso' : 'Abrir conta'}
      </button>
    </section>
  );
}
