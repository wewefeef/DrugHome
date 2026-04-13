import type { Drug } from '../types/drug';

let cache: Drug[] | null = null;
let promise: Promise<Drug[]> | null = null;

export function getDrugs(): Promise<Drug[]> {
  if (cache) return Promise.resolve(cache);
  if (!promise) {
    promise = fetch(`${import.meta.env.BASE_URL}data/drugs.json`)
      .then(r => r.json())
      .then((data: Drug[]) => { cache = data; return data; })
      .catch(() => { promise = null; return []; });
  }
  return promise;
}
