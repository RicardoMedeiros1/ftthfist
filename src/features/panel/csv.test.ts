import { describe, expect, it } from 'vitest';
import { buildCsv, csvNumber, csvText } from './csv';

describe('csvNumber', () => {
  it('virgula decimal e duas casas; zeros e valores invalidos viram 0', () => {
    expect(csvNumber(1234.5)).toBe('1234,50');
    expect(csvNumber(0)).toBe('0,00');
    expect(csvNumber(7, 0)).toBe('7');
    expect(csvNumber(0.005)).toBe('0,01');
    expect(csvNumber(NaN)).toBe('0,00');
    expect(csvNumber(Infinity)).toBe('0,00');
    expect(csvNumber(-2.5)).toBe('-2,50');
  });
});

describe('csvText', () => {
  it('texto simples passa como esta', () => {
    expect(csvText('Ana Souza')).toBe('Ana Souza');
    expect(csvText('')).toBe('');
  });
  it('";" e aspas pedem aspas (e aspas dobram); quebra de linha vira espaco', () => {
    expect(csvText('Rua A; casa 2')).toBe('"Rua A; casa 2"');
    expect(csvText('disse "oi"')).toBe('"disse ""oi"""');
    expect(csvText('linha 1\nlinha 2\r\nlinha 3')).toBe('linha 1 linha 2 linha 3');
  });
  it('quem comeca com = + - @ ou tab ganha um apostrofo (nao vira formula na planilha)', () => {
    for (const bad of ['=SOMA(A1:A2)', '+55 11', '-1+1', '@cmd', '\tx']) expect(csvText(bad), bad).toBe(`'${bad}`);
    expect(csvText('a=b')).toBe('a=b');
  });
  it('o apostrofo e as aspas se combinam', () => {
    expect(csvText('=1;2')).toBe('"\'=1;2"');
  });
});

describe('buildCsv', () => {
  it('BOM, cabecalho, linhas com ";" e CRLF no fim de cada linha', () => {
    const out = buildCsv(['Técnico', 'Cabos', 'Metros'], [['Ana', { n: 3, decimals: 0 }, { n: 1234.5 }], ['Bruno; Jr', { n: 0, decimals: 0 }, { n: 0 }]]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.slice(1)).toBe('Técnico;Cabos;Metros\r\nAna;3;1234,50\r\n"Bruno; Jr";0;0,00\r\n');
  });
  it('sem linhas: so o cabecalho', () => {
    expect(buildCsv(['A', 'B'], []).slice(1)).toBe('A;B\r\n');
  });
});
