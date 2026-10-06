// Arquivos de terceiros (KML) trazem descrições em HTML. Aqui viram texto puro: nada de HTML do arquivo
// chega à tela como HTML (a tela sempre escreve texto, e o React escapa).

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°', middot: '·',
  ccedil: 'ç', Ccedil: 'Ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Atilde: 'Ã', Otilde: 'Õ', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Agrave: 'À',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[e] ?? m;
  });
}

/** HTML (ou texto) → texto puro, com quebras de linha onde o HTML quebrava. `max` limita o tamanho (com "…"). */
export function toPlainText(input: unknown, max = 2000): string {
  if (typeof input !== 'string') return '';
  const BREAK = '\u0001'; // quebras de bloco seguidas (</tr><tr>) viram uma só
  let s = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*\/?\s*(?:br|p|div|tr|li|h[1-6]|table)\b[^>]*>/gi, BREAK)
    .replace(/<\/t[dh]\s*>/gi, '  ')
    .replace(/<[^>]*>/g, '');
  s = decodeEntities(s)
    .replace(/\u0001(?:[ \t]*\u0001)*/g, '\n')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Texto de uma linha só (nomes e rótulos). */
export const toOneLine = (input: unknown, max = 200): string => toPlainText(input, max * 2).replace(/\s+/g, ' ').slice(0, max).trim();
