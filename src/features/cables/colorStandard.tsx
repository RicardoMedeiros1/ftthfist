import { useLiveQuery } from 'dexie-react-hooks';
import { SETTING_KEYS, getSetting, setSetting } from '../../db/db';
import { Chips } from '../elements/fields';
import { COLOR_STANDARDS, DEFAULT_COLOR_STANDARD, STANDARD_LABEL, isColorStandard, type ColorStandard } from './fibers';

const OPTIONS = COLOR_STANDARDS.map((s) => ({ value: s, label: STANDARD_LABEL[s] }));

/** Padrão de cores dos cabos novos (Configurações). `undefined` enquanto carrega; valor inválido gravado = ABNT. */
export function useColorStandard(): ColorStandard | undefined {
  return useLiveQuery(async () => {
    const v = await getSetting<unknown>(SETTING_KEYS.colorStandard, DEFAULT_COLOR_STANDARD);
    return isColorStandard(v) ? v : DEFAULT_COLOR_STANDARD;
  });
}

/** Escolha do padrão de cores (sem poder desmarcar: um dos dois sempre vale). */
export function ColorStandardChips({ label = 'Cores das fibras', value, onChange }: { label?: string; value: ColorStandard; onChange: (v: ColorStandard) => void }) {
  return <Chips label={label} className="color-standard" value={value} options={OPTIONS} onChange={(v) => isColorStandard(v) && onChange(v)} />;
}

/** Nas Configurações: o padrão que os cabos novos vão usar. */
export function ColorStandardSetting() {
  const value = useColorStandard();
  if (value === undefined) return null;
  return (
    <section className="card" aria-label="Cores das fibras">
      <div className="card-title">Cores das fibras</div>
      <ColorStandardChips label="Padrão dos cabos novos" value={value} onChange={(v) => void setSetting(SETTING_KEYS.colorStandard, v)} />
      <p className="hint">ABNT é o padrão do Brasil. Cada cabo guarda o seu próprio padrão (dá para trocar na ficha do cabo), então mudar aqui não altera os cabos que já existem.</p>
    </section>
  );
}
