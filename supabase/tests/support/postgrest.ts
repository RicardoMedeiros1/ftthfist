import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import type { TestDb } from './harness';

// Sobe um PostgREST de verdade (o mesmo que o Supabase usa) na frente do banco de teste e assina JWTs para ele.
// Precisa de POSTGREST_BIN (caminho do binario); veja supabase/README.md.

export const POSTGREST_BIN = process.env.POSTGREST_BIN;
export const SECRET = 'segredo-so-para-teste-local-com-mais-de-32-caracteres';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function mint(sub: string): string {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}

export async function startPostgrest(db: TestDb): Promise<{ rest: string; stop(): void }> {
  const port = 3200 + Math.floor(Math.random() * 500);
  const rest = `http://127.0.0.1:${port}`;
  let log = '';
  const proc: ChildProcess = spawn(POSTGREST_BIN!, [], {
    env: { ...process.env, PGRST_DB_URI: db.url, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port) },
  });
  proc.stderr?.on('data', (d) => (log += String(d)));
  proc.stdout?.on('data', (d) => (log += String(d)));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${rest}/`)).ok) return { rest, stop: () => proc.kill() };
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  proc.kill();
  throw new Error(`PostgREST não subiu:\n${log}`);
}
