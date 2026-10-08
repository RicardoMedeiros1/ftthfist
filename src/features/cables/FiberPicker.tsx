import { useState } from 'react';
import { FiberSwatch } from './FiberList';
import { FIBERS_PER_TUBE, fiberGroups, type ColorStandard } from './fibers';
import './fibers.css';

/**
 * Escolha de uma fibra do cabo: em cabo com tubos, primeiro o tubo (com a cor dele), depois as 12 fibras daquele tubo, cada uma
 * com bolinha, número e nome da cor. `used` marca fibras que já alimentam outra CTO (dá para escolher mesmo assim; a tela avisa).
 */
export default function FiberPicker({
  fiberCount,
  standard,
  value,
  onChange,
  used,
}: {
  fiberCount: number;
  standard: ColorStandard;
  value: number | null;
  onChange: (fiber: number) => void;
  used?: ReadonlyMap<number, string>;
}) {
  const groups = fiberGroups(fiberCount, standard);
  const valueTube = value ? Math.floor((value - 1) / FIBERS_PER_TUBE) : 0;
  const [picked, setPicked] = useState<number | null>(null); // índice do tubo escolhido na tela
  const index = Math.min(picked ?? valueTube, groups.length - 1);
  const group = groups[index]!;
  return (
    <div className="fiber-picker">
      {groups.length > 1 && (
        <div className="field">
          <span className="label">Tubo</span>
          <div className="chips color-standard" role="group" aria-label="Tubo">
            {groups.map((g, i) => (
              <button type="button" key={g.tube!.number} aria-pressed={i === index} onClick={() => setPicked(i)}>
                <FiberSwatch color={g.tube!.color} size={18} /> {g.tube!.number} · {g.tube!.color.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="fiber-grid" role="group" aria-label="Fibra">
        {group.fibers.map((f) => {
          const other = used?.get(f.number);
          return (
            <button type="button" key={f.number} className="fiber-btn" aria-pressed={value === f.number} onClick={() => onChange(f.number)}>
              <FiberSwatch color={f.color} />
              <span className="fiber-btn-text">
                <strong>{f.number}</strong> {f.color.name}
                {other && <small>{other}</small>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
