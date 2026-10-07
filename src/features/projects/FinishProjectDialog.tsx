import '../../components/confirm.css';
import './projects.css';

/** Ao concluir a atividade de um projeto: "O projeto terminou?" Tres saidas; o foco inicial fica em "Voltar" (nada muda). */
export default function FinishProjectDialog({ projectTitle, onChoose, onCancel }: { projectTitle: string; onChoose: (finishesProject: boolean) => void; onCancel: () => void }) {
  return (
    <div className="confirm-backdrop">
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="finish-title" aria-describedby="finish-msg">
        <h2 id="finish-title">Este projeto está concluído?</h2>
        <p id="finish-msg">
          Você está concluindo uma atividade do projeto “{projectTitle}”. Com ela, o projeto terminou? Se faltar fazer, ele continua na sua lista.
        </p>
        <div className="confirm-actions confirm-actions-col">
          <button className="btn btn-primary" onClick={() => onChoose(true)}>Sim, o projeto está concluído</button>
          <button className="btn" onClick={() => onChoose(false)}>Não, ainda falta fazer</button>
          <button className="btn" autoFocus onClick={onCancel}>Voltar (não concluir a atividade)</button>
        </div>
      </div>
    </div>
  );
}
