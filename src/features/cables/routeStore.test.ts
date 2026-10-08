import { afterEach, describe, expect, it } from 'vitest';
import { routeStore } from './routeStore';

afterEach(() => routeStore.clear());

describe('routeStore', () => {
  it('começa sem cabo escolhido; escolher e limpar avisam quem acompanha', () => {
    expect(routeStore.get()).toBeNull();
    let n = 0;
    const off = routeStore.subscribe(() => n++);
    routeStore.select('a');
    expect(routeStore.get()).toBe('a');
    routeStore.select('b');
    expect(routeStore.get()).toBe('b');
    routeStore.clear();
    expect(routeStore.get()).toBeNull();
    expect(n).toBe(3);
    off();
    routeStore.select('c');
    expect(n).toBe(3); // quem deixou de acompanhar não é avisado
  });
  it('repetir a mesma coisa não avisa de novo', () => {
    let n = 0;
    routeStore.subscribe(() => n++);
    routeStore.clear();
    expect(n).toBe(0);
    routeStore.select('a');
    routeStore.select('a');
    expect(n).toBe(1);
  });
});
