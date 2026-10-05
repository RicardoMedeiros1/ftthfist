// Compressão das fotos de campo: JPEG ~1600 px no maior lado, qualidade ~0.7 (CLAUDE.md).

export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.7;

/** Reduz mantendo a proporção até o maior lado caber em `max`. Nunca amplia. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Decodifica já aplicando a orientação EXIF (fotos de celular em pé não podem ficar deitadas). */
async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    // Navegadores sem as opções do createImageBitmap: o <img> aplica a orientação sozinho.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function compressImage(file: Blob): Promise<Blob> {
  const img = await decode(file);
  try {
    const { width, height } = fitWithin(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível');
    ctx.drawImage(img.source, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao comprimir a foto'))), 'image/jpeg', JPEG_QUALITY),
    );
  } finally {
    img.close();
  }
}
