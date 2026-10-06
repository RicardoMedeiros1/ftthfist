import JSZip from 'jszip';
import type { ElementType, Photo } from '../../db/types';
import type { ExportData } from './exportData';
import { buildKml } from './kml';

export const KMZ_MIME = 'application/vnd.google-earth.kmz';

const iconPath = (t: ElementType) => `icons/${t}.png`;
const photoPath = (p: Photo) => `photos/${p.id}.jpg`;

export interface KmzOptions {
  includePhotos: boolean;
  /** Desenha o ícone do tipo como PNG (no navegador, via canvas). Nos testes, um stub. */
  renderIcon: (type: ElementType) => Promise<Blob>;
  /** 0–100 enquanto o zip é montado (fotos podem demorar). */
  onProgress?: (percent: number) => void;
}

/** KMZ = zip com doc.kml na raiz, ícones em icons/ e (opcional) fotos em photos/. */
export async function buildKmz(d: ExportData, opts: KmzOptions): Promise<Blob> {
  const photos = opts.includePhotos ? [...d.photosByElement.values()].flat() : [];
  const kml = buildKml(d, {
    iconHref: iconPath,
    photoHref: opts.includePhotos ? photoPath : undefined,
  });

  const zip = new JSZip();
  zip.file('doc.kml', kml, { compression: 'DEFLATE' });
  const types = [...new Set(d.elements.map((e) => e.type))];
  for (const t of types) zip.file(iconPath(t), await opts.renderIcon(t), { compression: 'STORE' });
  // JPEG já é comprimido: STORE evita gastar CPU sem ganho.
  for (const p of photos) zip.file(photoPath(p), p.blob, { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: KMZ_MIME }, (m) => opts.onProgress?.(m.percent));
}

/** Ícone do elemento em PNG (64 px, fundo transparente), desenhado a partir do mesmo SVG do mapa. */
export async function renderElementIconPng(type: ElementType, svg: string, px = 64): Promise<Blob> {
  const clean = svg.replace(' style="overflow:visible"', '').replace(/width="\d+" height="\d+"/, `width="${px}" height="${px}"`);
  const url = URL.createObjectURL(new Blob([clean], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Não consegui desenhar o ícone ${type}.`));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    canvas.getContext('2d')!.drawImage(img, 0, 0, px, px);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar o ícone.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
