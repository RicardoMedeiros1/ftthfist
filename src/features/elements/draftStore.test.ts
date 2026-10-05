import { beforeEach, describe, expect, it } from 'vitest';
import { draftStore } from './draftStore';

const s = () => draftStore.getState();
beforeEach(() => draftStore.cancel());

describe('rascunho de marcação', () => {
  it('"+" abre a escolha de tipo; escolher o tipo já começa a buscar GPS', () => {
    draftStore.startAdd();
    expect(s().phase).toBe('tipo');
    draftStore.chooseType('poste');
    expect(s()).toMatchObject({ phase: 'posicao', type: 'poste', mode: 'gps', capture: 'buscando', position: null });
  });

  it('a melhor leitura vira a posição; concluir exige haver posição', () => {
    draftStore.chooseType('cto');
    draftStore.finishCapture();
    expect(s().capture).toBe('buscando');
    draftStore.setGpsBest({ lat: -23.5, lng: -46.6, accuracy: 8 });
    draftStore.finishCapture();
    expect(s().capture).toBe('concluido');
    expect(s().position).toEqual({ lat: -23.5, lng: -46.6, accuracy: 8, source: 'gps' });
  });

  it('arrastar o marcador torna a posição manual e descarta a precisão', () => {
    draftStore.chooseType('poste');
    draftStore.setGpsBest({ lat: 1, lng: 2, accuracy: 40 });
    draftStore.finishCapture();
    draftStore.dragTo(1.0001, 2.0001);
    expect(s().position).toEqual({ lat: 1.0001, lng: 2.0001, source: 'manual' });
    expect(s().position && 'accuracy' in s().position!).toBe(false);
  });

  it('tocar no mapa: começa sem posição e a marcação é manual', () => {
    draftStore.chooseType('ceo');
    draftStore.setGpsBest({ lat: 1, lng: 2, accuracy: 9 });
    draftStore.useManual();
    expect(s()).toMatchObject({ mode: 'manual', position: null });
    draftStore.setManualPosition(3, 4);
    expect(s().position).toEqual({ lat: 3, lng: 4, source: 'manual' });
  });

  it('falha só vale enquanto está buscando; "buscar de novo" reinicia', () => {
    draftStore.chooseType('poste');
    const run = s().captureRun;
    draftStore.failCapture('Sem sinal');
    expect(s()).toMatchObject({ capture: 'erro', error: 'Sem sinal' });
    draftStore.retryGps();
    expect(s()).toMatchObject({ capture: 'buscando', error: null, position: null });
    expect(s().captureRun).toBe(run + 1);
  });

  it('cancelar limpa tudo; salvar limpa e deixa o aviso', () => {
    draftStore.chooseType('poste');
    draftStore.setGpsBest({ lat: 1, lng: 2, accuracy: 3 });
    draftStore.cancel();
    expect(s()).toMatchObject({ phase: 'idle', type: null, position: null });
    draftStore.chooseType('poste');
    draftStore.saved('Salvo: Poste');
    expect(s()).toMatchObject({ phase: 'idle', notice: 'Salvo: Poste', position: null });
  });

  it('mover: o marcador começa onde o elemento está, manual e sem precisão', () => {
    draftStore.startMove({ id: 'e1', type: 'poste', lat: 5, lng: 6 });
    expect(s()).toMatchObject({
      phase: 'mover',
      type: 'poste',
      movingId: 'e1',
      movingFrom: { lat: 5, lng: 6 },
      position: { lat: 5, lng: 6, source: 'manual' },
    });
    draftStore.dragTo(5.1, 6.1);
    expect(s().position).toEqual({ lat: 5.1, lng: 6.1, source: 'manual' });
    expect(s().movingFrom).toEqual({ lat: 5, lng: 6 });
  });

  it('cancelar a movimentação limpa o estado de mover', () => {
    draftStore.startMove({ id: 'e1', type: 'cto', lat: 1, lng: 2 });
    draftStore.cancel();
    expect(s()).toMatchObject({ phase: 'idle', movingId: null, movingFrom: null, position: null });
  });
});
