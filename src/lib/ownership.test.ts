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
