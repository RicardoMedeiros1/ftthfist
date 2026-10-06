import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Principio do projeto: nenhuma credencial secreta no frontend. Estes testes vigiam o codigo e o workflow.

const root = new URL('../../../', import.meta.url).pathname;
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('sem segredos no codigo do app', () => {
  const files = walk(join(root, 'src')).filter((f) => /\.(ts|tsx|css|html)$/.test(f) && !/\.test\.ts$/.test(f));

  it('o app nao menciona chave de servico (service_role / sb_secret_) fora da trava que a recusa', () => {
    const offenders = files
      .filter((f) => !f.endsWith('/features/account/supabaseKey.ts'))
      .filter((f) => /service_role|sb_secret_|SERVICE_KEY|SUPABASE_SERVICE/i.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('nenhuma chave de verdade (JWT ou sb_publishable_/sb_secret_ longos) esta escrita no codigo', () => {
    const offenders = files.filter((f) => /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.|sb_(publishable|secret)_[A-Za-z0-9_-]{20,}/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('so o cliente do Supabase e importado, e so dentro da pasta account (carregado sob demanda)', () => {
    // `import type` some no build (nao entra no pacote), entao pode aparecer em qualquer pasta; importar o VALOR so na pasta account
    const importers = files.filter((f) => /^import (?!type\b)[^;]*from '@supabase\/supabase-js'|import\('@supabase\/supabase-js'\)/m.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => f.replace(root, '')).filter((f) => !f.includes('/features/account/'))).toEqual([]);
    const staticValueImport = files.filter((f) => /^import (?!type)[^;]*from '@supabase\/supabase-js'/m.test(readFileSync(f, 'utf8')));
    expect(staticValueImport.map((f) => f.replace(root, ''))).toEqual([]); // import estatico de valor entraria no pacote inicial
  });
});

describe('o service worker e o unico a montar clientes de dados e arquivos sem o supabase-js', () => {
  const files = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f));
  it('postgrest-js e storage-js so sao importados (como valor) por src/sw.ts', () => {
    const importers = files.filter((f) => /^import (?!type\b)[^;]*from '@supabase\/(postgrest|storage)-js'/m.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => f.replace(root, ''))).toEqual(['src/sw.ts']);
  });
  it('o service worker so le a chave PUBLICA que o app espelhou (nunca variavel de ambiente)', () => {
    const sw = readFileSync(join(root, 'src/sw.ts'), 'utf8');
    expect(/import\.meta\.env|process\.env/.test(sw)).toBe(false);
  });
});

describe('workflow de publicacao', () => {
  const wf = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
  it('as chaves entram como VARIAVEIS do repositorio (publicas), nunca como segredos', () => {
    expect(wf).toContain('${{ vars.VITE_SUPABASE_URL }}');
    expect(wf).toContain('${{ vars.VITE_SUPABASE_ANON_KEY }}');
    expect(/secrets\.[A-Z_]*SUPABASE/i.test(wf)).toBe(false);
    expect(/service_role|SERVICE_KEY/i.test(wf)).toBe(false);
  });
});
