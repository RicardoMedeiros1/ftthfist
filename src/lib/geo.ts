// Utilidades geográficas e regras de precisão do GPS.

/** Acima disso o app avisa e oferece ajustar o ponto arrastando (CLAUDE.md, princípio 3). */
export const ACCURACY_WARN_M = 15;

export type AccuracyLevel = 'boa' | 'ruim';

export function classifyAccuracy(accuracyMeters: number): AccuracyLevel {
  return accuracyMeters > ACCURACY_WARN_M ? 'ruim' : 'boa';
}

export function formatAccuracy(accuracyMeters: number): string {
  return `±${Math.round(accuracyMeters)} m`;
}
