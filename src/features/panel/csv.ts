// CSV para abrir direto no Excel brasileiro: separador ";", numero com virgula, UTF-8 com marca (BOM) e quebra de linha CRLF.

/** Numero no formato brasileiro, com `decimals` casas ("1234.5" -> "1234,50"). Sem separador de milhar (o Excel converte sozinho). */
export function csvNumber(n: number, decimals = 2): string {
  return (Number.isFinite(n) ? n : 0).toFixed(decimals).replace('.', ',');
}

/**
 * Uma celula de TEXTO. Aspas e ";" e quebras de linha pedem aspas; e quem comeca com = + - @ (ou tab/CR) viraria formula
 * ao abrir na planilha (nome de tecnico, observacao...), entao ganha um apostrofo na frente.
 */
export function csvText(value: string): string {
  let v = value.replace(/\r\n|\r|\n/g, ' ');
  if (/^[=+\-@\t]/.test(v)) v = `'${v}`;
  return /[";]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export type CsvCell = string | { n: number; decimals?: number };

export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  const cell = (c: CsvCell) => (typeof c === 'string' ? csvText(c) : csvNumber(c.n, c.decimals ?? 2));
  const lines = [headers.map(csvText).join(';'), ...rows.map((r) => r.map(cell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
