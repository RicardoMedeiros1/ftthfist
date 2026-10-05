import { db, newBase, touch, type RotaFibraDB } from '../../db/db';
import type { NetworkElement, Photo } from '../../db/types';

export class PhotoRuleError extends Error {
  constructor(
    readonly code: 'ELEMENT_NOT_FOUND' | 'PHOTO_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'PhotoRuleError';
  }
}

export interface NewPhotoInput {
  blob: Blob;
  /** Momento em que a foto foi tirada (pode ser anterior ao salvamento do elemento). */
  takenAt?: number;
}

/** Monta o registro da foto. A posição da foto é a do elemento a que ela pertence. */
export function buildPhoto(el: NetworkElement, input: NewPhotoInput, createdBy: string, now = Date.now()): Photo {
  return {
    ...newBase(createdBy, now),
    blob: input.blob,
    lat: el.lat,
    lng: el.lng,
    takenAt: input.takenAt ?? now,
    elementId: el.id,
    activityId: el.activityId,
  };
}

export function photoRepo(database: RotaFibraDB = db) {
  return {
    /** Fotos do elemento, da mais antiga para a mais nova, sem as excluídas. */
    async listFor(elementId: string): Promise<Photo[]> {
      const all = await database.photos
        .where('elementId')
        .equals(elementId)
        .filter((p) => !p.deleted)
        .toArray();
      return all.sort((a, b) => a.takenAt - b.takenAt);
    },

    async add(elementId: string, input: NewPhotoInput, technician: string): Promise<Photo> {
      return database.transaction('rw', database.elements, database.photos, async () => {
        const el = await database.elements.get(elementId);
        if (!el || el.deleted) throw new PhotoRuleError('ELEMENT_NOT_FOUND', 'Elemento não encontrado.');
        const photo = buildPhoto(el, input, technician.trim() || el.createdBy);
        await database.photos.add(photo);
        return photo;
      });
    },

    /** Exclusão lógica. */
    async remove(id: string): Promise<void> {
      await database.transaction('rw', database.photos, async () => {
        const p = await database.photos.get(id);
        if (!p || p.deleted) throw new PhotoRuleError('PHOTO_NOT_FOUND', 'Foto não encontrada.');
        await database.photos.update(id, touch<Photo>({ deleted: true }));
      });
    },
  };
}

export const photoStore = photoRepo();
