/**
 * proteinCache — Protein type definition and lazy API loader.
 * The Protein interface is shared between this cache and api.ts normalizer.
 */
import { apiFetchProteins } from './api';

export interface Protein {
  id: number;
  uniprot_id: string;
  name: string;
  gene_name: string;
  organism: string;
  types: string[];    // ['target'] | ['enzyme'] | etc.
  actions: string[];  // ['inhibitor', 'activator', ...]
  drug_count: number;
}

let cache: Protein[] | null = null;
let promise: Promise<Protein[]> | null = null;

/**
 * Returns all proteins from the backend API (lazy, cached).
 * For paginated/filtered access use apiFetchProteins() from api.ts directly.
 */
export function getProteins(): Promise<Protein[]> {
  if (cache) return Promise.resolve(cache);
  if (!promise) {
    promise = (async () => {
      const all: Protein[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const result = await apiFetchProteins({ page, per_page: 200 });
        all.push(...result.items);
        totalPages = result.total_pages;
        page++;
      } while (page <= totalPages);
      cache = all;
      return all;
    })().catch(() => { promise = null; return [] as Protein[]; });
  }
  return promise;
}

/** Clear cache */
export function clearProteinCache(): void {
  cache = null;
  promise = null;
}
