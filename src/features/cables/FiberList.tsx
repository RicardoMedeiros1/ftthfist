import { fiberGroups, fiberLabel, type ColorStandard, type FiberColor, type FiberInfo } from './fibers';
import './fibers.css';

/** Bolinha da cor da fibra (o nome da cor sempre aparece ao lado: a cor sozinha não basta no sol). */
export function FiberSwatch({ color, size = 22 }: { color: FiberColor; size?: number }) {
  return <span className="fiber-swatch" style={{ background: color.hex, width: size, height: size }} aria-hidden="true" />;
}

function Item({ info, note }: { info: FiberInfo; note?: string }) {
  return (
    <li className="fiber-item">
      <FiberSwatch color={info.color} />
      <span className="fiber-name">{fiberLabel({ ...info, tube: undefined })}</span>
      {note && <span className="fiber-note">{note}</span>}
    </li>
  );
}

/**
 * As fibras do cabo, com cor, agrupadas por tubo (cabo com mais de 12 fibras). `notes` põe uma observação numa fibra
 * (por exemplo, "CTO-12" quando ela já alimenta uma CTO).
 */
export default function FiberList({ fiberCount, standard, notes }: { fiberCount: number; standard: ColorStandard; notes?: ReadonlyMap<number, string> }) {
  const groups = fiberGroups(fiberCount, standard);
  if (groups.length === 1 && !groups[0]!.tube) {
    return (
      <ul className="fiber-list">
        {groups[0]!.fibers.map((f) => (
          <Item key={f.number} info={f} note={notes?.get(f.number)} />
        ))}
      </ul>
    );
  }
  return (
    <div className="fiber-tubes">
      {groups.map((g, i) => {
        const first = g.fibers[0]!.number;
        const last = g.fibers[g.fibers.length - 1]!.number;
        const used = g.fibers.filter((f) => notes?.has(f.number)).length;
        return (
          <details key={g.tube!.number} open={i === 0 || used > 0}>
            <summary>
              <FiberSwatch color={g.tube!.color} />
              <span>Tubo {g.tube!.number} · {g.tube!.color.name} · fibras {first} a {last}{used > 0 ? ` · ${used} em uso` : ''}</span>
            </summary>
            <ul className="fiber-list">
              {g.fibers.map((f) => (
                <Item key={f.number} info={f} note={notes?.get(f.number)} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
