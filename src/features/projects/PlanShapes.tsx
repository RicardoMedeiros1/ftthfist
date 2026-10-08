import { Fragment, memo } from 'react';
import { Marker, Polyline, Popup, useMap } from 'react-leaflet';
import { codeText, lineText, pointTitle, type PlannedProject } from './planInfo';
import { PLAN_CASING, PLAN_COLOR, planPointIcon } from './planStyle';
import './plan.css';

// O desenho do projeto no mapa de quem so le (tecnico e escritorio): linha tracejada e pontos com anel tracejado, para nunca
// se confundir com o que ja foi feito em campo. Tocar mostra o que e. Nada aqui vira cabo ou elemento.

interface PopupBodyProps {
  title: string;
  lines: (string | null)[];
  projectTitle: string;
  onOpen?: () => void;
}

function PopupBody({ title, lines, projectTitle, onOpen }: PopupBodyProps) {
  const map = useMap();
  return (
    <div className="plan-popup">
      <strong>{title}</strong>
      {lines.filter(Boolean).map((l) => (
        <div key={l}>{l}</div>
      ))}
      <div className="plan-popup-project">Projeto: {projectTitle}</div>
      <div className="plan-popup-note">Desenho do projeto: só um guia.</div>
      {onOpen && (
        <button
          className="btn btn-block"
          onClick={() => {
            map.closePopup(); // o mapa continua montado atras da tela do projeto: nao deixa o popup aberto para quando voltar
            onOpen();
          }}
        >
          Abrir o projeto
        </button>
      )}
    </div>
  );
}

interface Props {
  plans: readonly PlannedProject[];
  /** Falso enquanto o tecnico esta marcando algo no mapa: o desenho fica so de fundo e nao pega toque. */
  interactive: boolean;
  /** Abre o projeto (so o tecnico tem essa tela). */
  onOpenProject?: (projectId: string) => void;
  /** Pixels livres no alto do mapa, para o popup nao abrir por baixo da faixa da atividade (ou do aviso do painel). */
  topInset?: number;
}

function PlanShapes({ plans, interactive, onOpenProject, topInset = 24 }: Props) {
  return (
    <>
      {plans.map((pr) => {
        const open = onOpenProject ? () => onOpenProject(pr.id) : undefined;
        return (
          <Fragment key={pr.id}>
            {pr.plan.lines.map((l) => (
              <Fragment key={l.id}>
                <Polyline positions={l.points} pathOptions={{ color: PLAN_CASING, weight: 8, opacity: 0.7, interactive: false, lineCap: 'round', lineJoin: 'round' }} />
                <Polyline positions={l.points} pathOptions={{ color: PLAN_COLOR, weight: 4, dashArray: '10 8', interactive: false, lineCap: 'butt', lineJoin: 'round' }} />
                {interactive && (
                  <Polyline positions={l.points} pathOptions={{ color: '#000', weight: 22, opacity: 0, bubblingMouseEvents: false }}>
                    <Popup className="plan-popup-box" closeButton={false} autoPanPaddingTopLeft={[24, topInset]} autoPanPaddingBottomRight={[24, 24]}>
                      <PopupBody title="Traçado projetado" lines={[lineText(l)]} projectTitle={pr.title} onOpen={open} />
                    </Popup>
                  </Polyline>
                )}
              </Fragment>
            ))}
            {pr.plan.points.map((p) => (
              // `interactive` so e lido quando o marcador nasce: mudar de fase recria o ponto
              <Marker key={`${p.id}-${interactive ? 'i' : 'n'}`} position={[p.lat, p.lng]} icon={planPointIcon(p.type)} interactive={interactive} zIndexOffset={-200}>
                {interactive && (
                  <Popup className="plan-popup-box" closeButton={false} autoPanPaddingTopLeft={[24, topInset]} autoPanPaddingBottomRight={[24, 24]}>
                    <PopupBody title={pointTitle(p.type)} lines={[codeText(p.code)]} projectTitle={pr.title} onOpen={open} />
                  </Popup>
                )}
              </Marker>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

export default memo(PlanShapes);
