/**
 * drugCache — loads all drugs from the backend API (lazy, in-memory cache).
 * Used by InteractionsPage for autocomplete drug-meta lookup.
 * For paginated list/search use apiFetchDrugs() from api.ts directly.
 */
import type { Drug } from '../types/drug';
import { apiFetchDrugs } from './api';

let cache: Drug[] | null = null;
let promise: Promise<Drug[]> | null = null;

/**
 * Returns all drugs from the backend API.
 * First call fetches all pages (per_page=500); subsequent calls return the cache instantly.
 */
export function getDrugs(): Promise<Drug[]> {
  if (cache) return Promise.resolve(cache);
  if (!promise) {
    promise = (async () => {
      const all: Drug[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const result = await apiFetchDrugs({ page, per_page: 500 });
        all.push(...result.items);
        totalPages = result.total_pages;
        page++;
      } while (page <= totalPages);
      cache = all;
      return all;
    })().catch(() => { promise = null; return [] as Drug[]; });
  }
  return promise;
}

/** Clear cache (useful after DB updates) */
export function clearDrugCache(): void {
  cache = null;
  promise = null;
}
