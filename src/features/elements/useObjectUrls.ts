import { useEffect, useState } from 'react';

export interface BlobItem {
  id: string;
  /** Ausente: a foto ainda nao esta neste aparelho (foto de colega, a baixar). */
  blob?: Blob;
  /** Texto do quadrinho enquanto nao ha arquivo ("Baixando…", "Sem internet"...). */
  note?: string;
}

/** URLs temporárias para exibir blobs. São criadas e liberadas junto com a lista (não vazam memória). `items` deve ser estável. */
export function useObjectUrls(items: BlobItem[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const it of items) if (it.blob) next[it.id] = URL.createObjectURL(it.blob);
    setUrls(next);
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u));
  }, [items]);
  return urls;
}
