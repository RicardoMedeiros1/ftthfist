import { describe, expect, it } from 'vitest';
import { toOneLine, toPlainText } from './plainText';

describe('toPlainText', () => {
  it('tira as tags e mantém o texto', () => {
    expect(toPlainText('<b>Poste</b> <i>12</i>')).toBe('Poste 12');
  });
  it('quebras de linha onde o HTML quebrava', () => {
    expect(toPlainText('a<br>b<br/>c<p>d</p>e')).toBe('a\nb\nc\nd\ne');
  });
  it('tabela do Google Earth vira linhas legíveis', () => {
    expect(toPlainText('<table><tr><td>Código</td><td>P-1</td></tr><tr><td>Dono</td><td>Enel</td></tr></table>')).toBe('Código P-1\nDono Enel');
  });
  it('script, style e comentários somem com o conteúdo', () => {
    expect(toPlainText('oi<script>alert(1)</script><style>p{}</style><!-- x -->fim')).toBe('oi fim');
  });
  it('não executa nem preserva HTML perigoso: vira texto', () => {
    const out = toPlainText('<img src=x onerror=alert(1)><a href="javascript:alert(2)">clique</a>');
    expect(out).toBe('clique');
    expect(out).not.toContain('<');
  });
  it('entidades viram caracteres, mas o resultado não é reinterpretado como tag', () => {
    expect(toPlainText('Tom &amp; Jerry &quot;ok&quot; &#233; &#xe9; &ccedil;&atilde;o')).toBe('Tom & Jerry "ok" é é ção');
    expect(toPlainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
  });
  it('entidade desconhecida ou inválida não quebra', () => {
    expect(toPlainText('a &foo; b &#0; c &#99999999;')).toBe('a &foo; b c');
  });
  it('normaliza espaços, remove caracteres de controle e limita linhas em branco', () => {
    expect(toPlainText('a \t  b\u0000\u0007\n\n\n\n c')).toBe('a b\n\nc');
  });
  it('limita o tamanho com reticências', () => {
    const out = toPlainText('x'.repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });
  it('entrada que não é texto vira vazio', () => {
    expect(toPlainText(undefined)).toBe('');
    expect(toPlainText(42)).toBe('');
    expect(toPlainText(null)).toBe('');
  });
});

describe('toOneLine', () => {
  it('junta tudo numa linha e corta', () => {
    expect(toOneLine('Poste<br>12\n  A')).toBe('Poste 12 A');
    expect(toOneLine('y'.repeat(300), 20)).toHaveLength(20);
  });
});
