import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// O "Como usar" (public/demo) é uma página estática: estes testes garantem que o texto, as telas de exemplo e os destaques
// continuam combinando (cada passo tem sua tela, nenhuma tela sobra, destaques dentro da imagem, POP completo).

interface Passo { img?: string; titulo: string; texto: string; acao?: string; dica?: string; atencao?: string }
interface Pop { codigo: string; quem: string; objetivo: string; antes: string[]; conferir: string[]; seDerErrado: string[] }
interface Capitulo { id: string; papel: string; titulo: string; resumo: string; pop: Pop; passos: Passo[] }
interface Papel { id: string; titulo: string; sub: string; device: string }
interface Destaque { device: 'phone' | 'desktop'; tap: { x: number; y: number; w: number; h: number } | null }

const DEMO = resolve(__dirname, '../../../public/demo');
const load = async <T,>(file: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(resolve(DEMO, file)).href)) as T;
const { PAPEIS, CAPITULOS } = await load<{ PAPEIS: Papel[]; CAPITULOS: Capitulo[] }>('conteudo.js');
const { HOTSPOTS } = await load<{ HOTSPOTS: Record<string, Destaque> }>('hotspots.js');
const imgsUsadas = [...new Set(CAPITULOS.flatMap((c) => c.passos.map((p) => p.img)).filter((i): i is string => !!i))];

describe('Como usar: conteúdo', () => {
  it('tem os dois públicos e capítulos para cada um', () => {
    expect(PAPEIS.map((p) => p.id)).toEqual(['tecnico', 'escritorio']);
    for (const p of PAPEIS) expect(CAPITULOS.filter((c) => c.papel === p.id).length).toBeGreaterThanOrEqual(5);
  });
  it('ids de capítulo únicos e só de papéis conhecidos', () => {
    const ids = CAPITULOS.map((c) => `${c.papel}/${c.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAPITULOS) expect(PAPEIS.some((p) => p.id === c.papel)).toBe(true);
  });
  it('todo passo tem título e texto, e a ação (quando há) vem com verbo de toque ou clique', () => {
    for (const c of CAPITULOS) {
      expect(c.passos.length, c.id).toBeGreaterThanOrEqual(2);
      for (const p of c.passos) {
        expect(p.titulo.trim().length, `${c.id}: título`).toBeGreaterThan(2);
        expect(p.texto.trim().length, `${c.id}/${p.titulo}: texto`).toBeGreaterThan(10);
        if (p.acao) expect(/^(Toque|Clique|Para |Escolha|Se |Importar)/.test(p.acao), `${c.id}/${p.titulo}: ação "${p.acao}"`).toBe(true);
      }
    }
  });
  it('cada capítulo tem POP completo, com código único', () => {
    const codigos = CAPITULOS.map((c) => c.pop.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of CAPITULOS) {
      expect(c.pop.codigo, c.id).toMatch(/^POP-\d{2}$/);
      expect(c.pop.quem.length, c.id).toBeGreaterThan(5);
      expect(c.pop.objetivo.length, c.id).toBeGreaterThan(15);
      expect(c.pop.antes.length, `${c.id}: antes`).toBeGreaterThan(0);
      expect(c.pop.conferir.length, `${c.id}: conferir`).toBeGreaterThan(0);
      expect(c.pop.seDerErrado.length, `${c.id}: se der errado`).toBeGreaterThan(0);
    }
  });
});

describe('Como usar: telas de exemplo', () => {
  it('cada tela citada existe em img/ e tem destaque registrado', () => {
    for (const id of imgsUsadas) {
      expect(existsSync(resolve(DEMO, 'img', `${id}.webp`)), `img/${id}.webp`).toBe(true);
      expect(HOTSPOTS[id], `hotspots.js: ${id}`).toBeDefined();
    }
  });
  it('nenhuma imagem nem destaque sobra sem passo que use', () => {
    const arquivos = readdirSync(resolve(DEMO, 'img')).filter((f) => f.endsWith('.webp')).map((f) => f.replace('.webp', ''));
    expect(arquivos.filter((a) => !imgsUsadas.includes(a))).toEqual([]);
    expect(Object.keys(HOTSPOTS).filter((a) => !imgsUsadas.includes(a))).toEqual([]);
  });
  it('os destaques ficam dentro da tela', () => {
    for (const [id, h] of Object.entries(HOTSPOTS)) {
      expect(['phone', 'desktop']).toContain(h.device);
      if (!h.tap) continue;
      const { x, y, w, h: alt } = h.tap;
      expect(x, id).toBeGreaterThanOrEqual(0); expect(y, id).toBeGreaterThanOrEqual(0);
      expect(w, id).toBeGreaterThan(0.01); expect(alt, id).toBeGreaterThan(0.01);
      expect(x + w, id).toBeLessThanOrEqual(1.001); expect(y + alt, id).toBeLessThanOrEqual(1.001);
    }
  });
  it('as imagens são leves (para caber no cache do celular)', () => {
    let total = 0;
    for (const id of imgsUsadas) { const t = readFileSync(resolve(DEMO, 'img', `${id}.webp`)).length; total += t; expect(t, id).toBeLessThan(160 * 1024); }
    expect(total).toBeLessThan(8 * 1024 * 1024);
  });
});

describe('Como usar: página', () => {
  const html = readFileSync(resolve(DEMO, 'index.html'), 'utf8');
  it('carrega o script e o estilo e tem o botão de voltar ao app', () => {
    expect(html).toContain('demo.js'); expect(html).toContain('demo.css'); expect(html).toContain('id="back-app"');
  });
  it('usa o mesmo tema do app (rf-theme)', () => {
    expect(html).toContain("localStorage.getItem('rf-theme')");
  });
});
