export interface Protein {
  id: number;
  uniprot_id: string;
  name: string;
  gene_name: string;
  organism: string;
  types: string[];
  actions: string[];
  drug_count: number;
}

let cache: Protein[] | null = null;
let promise: Promise<Protein[]> | null = null;

export function getProteins(): Promise<Protein[]> {
  if (cache) return Promise.resolve(cache);
  if (!promise) {
    promise = fetch('/data/proteins.json')
      .then(r => r.json())
      .then((data: Protein[]) => { cache = data; return data; });
  }
  return promise;
}
