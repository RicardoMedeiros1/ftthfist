import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regras do texto das migrations (não precisam de banco; rodam no `npm test` normal).

const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8');

describe('migrations do Supabase: texto', () => {
  it('há migrations e o nome segue AAAAMMDDHHMMSS_nome.sql (a ordem de aplicação é a do nome)', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('só ASCII: o SQL Editor do Supabase ("Run and enable RLS") reescreveu um script com acentos e o quebrou', () => {
    for (const f of files) {
      const bad = [...read(f)].filter((c) => c.charCodeAt(0) > 127);
      expect(bad, `${f} tem caracteres fora do ASCII: ${[...new Set(bad)].join(' ')}`).toEqual([]);
    }
  });

  it('toda tabela criada em public liga a RLS na instrução seguinte (nunca fica um intervalo sem proteção)', () => {
    let tables = 0;
    for (const f of files) {
      const sql = read(f);
      for (const m of sql.matchAll(/create table public\.(\w+) \(/g)) {
        tables++;
        const rest = sql.slice(m.index);
        const end = rest.indexOf('\n);\n') + 4;
        expect(rest.slice(end).startsWith(`alter table public.${m[1]} enable row level security;`), `${f}: ${m[1]} sem RLS logo após o create table`).toBe(true);
      }
    }
    expect(tables).toBe(7);
  });
});
