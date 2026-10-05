import { useState, type FormEvent } from 'react';
import { SETTING_KEYS, setSetting } from '../../db/db';
import { DEFAULT_CABLE_TYPES, MAX_CABLE_TYPES, MAX_TYPE_LENGTH, normalizeCableTypes, useCableTypes } from './cableTypes';

/** Lista editável dos tipos de cabo (Configurações). Cabos já lançados não mudam ao editar a lista. */
export default function CableTypesEditor() {
  const types = useCableTypes();
  const [text, setText] = useState('');
  if (!types) return null;

  const save = (list: string[]) => setSetting(SETTING_KEYS.cableTypes, normalizeCableTypes(list));

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await save([...types!, text]);
    setText('');
  }

  return (
    <section className="card" aria-label="Tipos de cabo">
      <div className="card-title">Tipos de cabo</div>
      <ul className="type-list">
        {types.map((t) => (
          <li key={t}>
            <span>{t}</span>
            <button
              type="button"
              className="btn btn-small"
              aria-label={`Remover ${t}`}
              disabled={types.length <= 1}
              onClick={() => void save(types.filter((x) => x !== t))}
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
      <form className="field" onSubmit={(e) => void add(e)}>
        <label htmlFor="new-cable-type">Novo tipo</label>
        <input
          id="new-cable-type"
          type="text"
          maxLength={MAX_TYPE_LENGTH}
          value={text}
          placeholder="Ex.: ASU-100"
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-block" type="submit" disabled={!text.trim() || types.length >= MAX_CABLE_TYPES}>
          Adicionar tipo
        </button>
      </form>
      <button type="button" className="btn btn-small" onClick={() => void save(DEFAULT_CABLE_TYPES)}>
        Restaurar padrão
      </button>
    </section>
  );
}
