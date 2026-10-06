import { afterEach, describe, expect, it } from 'vitest';
import { actingUserId, isMine, setActingUser } from './ownership';

afterEach(() => setActingUser(null));

describe('isMine', () => {
  it('sem ninguém identificado no aparelho, tudo é meu (app sem conta)', () => {
    expect(isMine({ ownerId: 'a' })).toBe(true);
    expect(isMine({})).toBe(true);
  });

  it('com alguém identificado, só vale o que é dele ou o que não tem dono', () => {
    setActingUser('ana');
    expect(isMine({ ownerId: 'ana' })).toBe(true);
    expect(isMine({ ownerId: 'bia' })).toBe(false);
    expect(isMine({})).toBe(true);
    expect(actingUserId()).toBe('ana');
  });
});

describe('texto de "é de outro técnico"', () => {
  it('concorda com o gênero da coisa e não presume o de quem registrou', async () => {
    const { otherOwnerText } = await import('./ownership');
    expect(otherOwnerText('elemento', 'Ana Souza')).toBe('Este elemento foi registrado por Ana Souza. Só quem registrou pode alterar.');
    expect(otherOwnerText('cabo')).toBe('Este cabo foi registrado por outro técnico. Só quem registrou pode alterar.');
    expect(otherOwnerText('atividade', '  Bia ')).toBe('Esta atividade foi registrada por Bia. Só quem registrou pode alterar.');
    expect(otherOwnerText('atividade', '')).toContain('por outro técnico');
  });
});
