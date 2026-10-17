import { howToUseUrl } from './howToUse';
import './howto.css';

/** Cartão das Configurações: abre o passo a passo ilustrado (demonstrativo). */
export default function HowToUseCard() {
  return (
    <section className="card" aria-label="Como usar">
      <div className="card-title">Como usar o app</div>
      <div className="card-meta">
        Passo a passo com telas de exemplo, para o técnico no celular e para o administrador e o escritório. Abra uma vez com internet; depois
        funciona sem.
      </div>
      <a className="btn btn-block how-to-use-link" href={howToUseUrl()}>
        Como usar
      </a>
    </section>
  );
}
