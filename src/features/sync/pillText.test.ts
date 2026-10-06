import { describe, expect, it } from 'vitest';
import { pillView, stateSentence } from './pillText';

const base = { phase: 'ocioso' as const, pending: 0, blocked: 0, progress: null, firstSync: false };

describe('indicador do mapa', () => {
  it('sem conta ativa continua sendo só Online/Offline', () => {
    expect(pillView({ ...base, phase: 'desligado' }, true)).toEqual({ text: 'Online', tone: 'ok' });
    expect(pillView({ ...base, phase: 'desligado' }, false)).toEqual({ text: 'Offline', tone: 'ok' });
  });
  it('mostra quantos aguardam envio', () => {
    expect(pillView({ ...base, pending: 3 }, true).text).toBe('Online · 3 pend.');
    expect(pillView({ ...base, phase: 'sem-rede', pending: 12 }, false).text).toBe('Offline · 12 pend.');
    expect(pillView(base, true).text).toBe('Online');
  });
  it('recusados chamam atenção', () => {
    expect(pillView({ ...base, pending: 1, blocked: 2 }, true)).toEqual({ text: 'Online · 1 pend. · ⚠ 2 recusados', tone: 'atencao' });
    expect(pillView({ ...base, blocked: 1 }, true).text).toBe('Online · ⚠ 1 recusado');
  });
  it('enquanto sincroniza, diz isso; na primeira vez, mostra o andamento do download', () => {
    expect(pillView({ ...base, phase: 'sincronizando' }, true).text).toBe('Sincronizando…');
    expect(pillView({ ...base, phase: 'sincronizando', firstSync: true, progress: { phase: 'baixando', done: 420 } }, true).text).toBe('Baixando a rede… 420');
  });
  it('sessão vencida e erro pedem atenção', () => {
    expect(pillView({ ...base, phase: 'precisa-entrar' }, true)).toEqual({ text: 'Entre de novo', tone: 'atencao' });
    expect(pillView({ ...base, phase: 'erro', pending: 2 }, true)).toEqual({ text: 'Online · 2 pend. · falha', tone: 'atencao' });
  });
});

describe('frase do estado', () => {
  const s = (o: Partial<Parameters<typeof stateSentence>[0]>) => stateSentence({ phase: 'ocioso', pending: 0, blocked: 0, lastSyncAt: null, ...o }, 10 * 60_000);
  it('cobre cada situação', () => {
    expect(s({})).toBe('Ainda não sincronizou neste aparelho');
    expect(s({ lastSyncAt: 10 * 60_000 })).toBe('Tudo enviado · agora há pouco');
    expect(s({ lastSyncAt: 5 * 60_000 })).toBe('Tudo enviado · há 5 min');
    expect(s({ lastSyncAt: 1 })).toBe('Tudo enviado · há 9 min');
    expect(s({ lastSyncAt: -3 * 3600_000 })).toBe('Tudo enviado');
    expect(s({ pending: 4, lastSyncAt: 1 })).toBe('4 aguardando envio');
    expect(s({ phase: 'sem-rede', pending: 4 })).toBe('Sem rede · 4 aguardando envio');
    expect(s({ phase: 'sem-rede' })).toBe('Sem rede');
    expect(s({ blocked: 1 })).toBe('1 registro recusado pelo servidor');
    expect(s({ blocked: 3 })).toBe('3 registros recusados pelo servidor');
    expect(s({ phase: 'precisa-entrar' })).toBe('Sua sessão expirou. Entre de novo.');
    expect(s({ phase: 'sincronizando' })).toBe('Sincronizando…');
  });
});
