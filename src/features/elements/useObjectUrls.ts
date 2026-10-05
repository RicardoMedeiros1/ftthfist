import { useEffect, useState } from 'react';

export interface BlobItem {
  id: string;
  blob: Blob;
}

/** URLs temporárias para exibir blobs. São criadas e liberadas junto com a lista (não vazam memória). `items` deve ser estável. */
export function useObjectUrls(items: BlobItem[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const it of items) next[it.id] = URL.createObjectURL(it.blob);
    setUrls(next);
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u));
  }, [items]);
  return urls;
}
