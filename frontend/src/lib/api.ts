/**
 * Central API client — all fetch calls to the FastAPI backend go through here.
 * Maps backend field names → frontend types used throughout the app.
 */

import type { Drug } from '../types/drug';
import type { Protein } from './proteinCache';

const BASE = '/api/v1';

// ── Raw API response types (as returned by backend) ───────────────────────────

export interface ApiDrug {
  drugbank_id: string;
  name: string;
  drug_type: string | null;
  atc_codes: string | null;
  inchikey: string | null;
  cas_number: string | null;
  unii: string | null;
  state: string | null;
  groups: string[];
  categories: string[];
  aliases: string[];
  description: string | null;
  indication: string | null;
  pharmacodynamics: string | null;
  mechanism_of_action: string | null;
  toxicity: string | null;
  absorption: string | null;
  metabolism: string | null;
  half_life: string | null;
  protein_binding: string | null;
  route_of_elimination: string | null;
  smiles: string | null;
  molecular_formula: string | null;
  average_mass: number | null;
  target_count: number;
  enzyme_count: number;
  transporter_count: number;
}

export interface ApiProtein {
  id: number;
  name: string;
  uniprot_id: string | null;
  entrez_gene_id: string | null;
  gene_name: string | null;
  organism: string | null;
  protein_type: string | null;
  drug_count: number;
  actions: string[];
  general_function: string | null;
  specific_function: string | null;
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  items: T[];
}

// ── Normalizers: API → frontend types ─────────────────────────────────────────

/** Maps backend DrugOut → frontend Drug interface */
export function normalizeDrug(d: ApiDrug): Drug {
  return {
    id: d.drugbank_id,
    drug_code: d.drugbank_id,
    name: d.name,
    generic_name: d.name,
    type: d.drug_type ?? '',
    groups: d.groups ?? [],
    state: d.state ?? '',
    categories: Array.isArray(d.categories) ? d.categories.filter((c): c is string => typeof c === 'string') : [],
    description: d.description ?? '',
    indication: d.indication ?? '',
    mechanism: d.mechanism_of_action ?? '',
    pharmacodynamics: d.pharmacodynamics ?? '',
    toxicity: d.toxicity ?? '',
    absorption: d.absorption ?? '',
    metabolism: d.metabolism ?? '',
    half_life: d.half_life ?? '',
    protein_binding: d.protein_binding ?? '',
    route_of_elimination: d.route_of_elimination ?? '',
    molecular_formula: d.molecular_formula ?? '',
    molecular_weight: d.average_mass ?? '',
    smiles: d.smiles ?? '',
    inchikey: d.inchikey ?? '',
    atc_codes: d.atc_codes ? d.atc_codes.split('|').filter(Boolean) : [],
    aliases: d.aliases ?? [],
    targets: d.target_count ?? 0,
    enzymes: d.enzyme_count ?? 0,
    transporters: d.transporter_count ?? 0,
  };
}

/** Maps backend ProteinOut → frontend Protein interface */
export function normalizeProtein(p: ApiProtein): Protein {
  return {
    id: p.id,
    uniprot_id: p.uniprot_id ?? '',
    name: p.name,
    gene_name: p.gene_name ?? '',
    organism: p.organism ?? '',
    types: p.protein_type ? [p.protein_type] : [],
    actions: p.actions ?? [],
    drug_count: p.drug_count ?? 0,
  };
}

// ── Drug API ───────────────────────────────────────────────────────────────────

export interface DrugListParams {
  q?: string;
  group?: string;
  drug_type?: string;
  state?: string;
  category_key?: string;
  page?: number;
  per_page?: number;
  signal?: AbortSignal;
}

/** Paginated drug list with server-side search and filtering */
export async function apiFetchDrugs(params: DrugListParams = {}): Promise<Paginated<Drug>> {
  const sp = new URLSearchParams();
  if (params.q)             sp.set('q', params.q);
  if (params.group)         sp.set('group', params.group);
  if (params.drug_type)     sp.set('drug_type', params.drug_type);
  if (params.state)         sp.set('state', params.state);
  if (params.category_key)  sp.set('category_key', params.category_key);
  sp.set('page',     String(params.page ?? 1));
  sp.set('per_page', String(params.per_page ?? 24));

  const res = await fetch(`${BASE}/drugs?${sp}`, { signal: params.signal });
  if (!res.ok) throw new Error(`Drugs API error: ${res.status}`);
  const data: Paginated<ApiDrug> = await res.json();
  return { ...data, items: data.items.map(normalizeDrug) };
}

/** Fetch a single drug by DrugBank ID. Returns null if 404. */
export async function apiFetchDrug(drugbankId: string): Promise<Drug | null> {
  const res = await fetch(`${BASE}/drugs/${encodeURIComponent(drugbankId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Drug API error: ${res.status}`);
  return normalizeDrug(await res.json() as ApiDrug);
}

/** Fetch all drugs for a disease category from backend */
export async function apiFetchDrugsByCategory(
  categoryKey: string,
  perPage = 300,
  hasNetwork = false,
): Promise<{ id: string; name: string; targetCount?: number; enzymeCount?: number }[]> {
  try {
    const params = new URLSearchParams({ page: '1', per_page: String(perPage) });
    if (hasNetwork) params.set('has_network', 'true');
    const res = await fetch(`${BASE}/drugs/categories/${encodeURIComponent(categoryKey)}?${params}`);
    if (!res.ok) return [];
    const data: Paginated<ApiDrug> = await res.json();
    return data.items.map(d => ({
      id: d.drugbank_id,
      name: d.name,
      targetCount: d.target_count,
      enzymeCount: d.enzyme_count,
    }));
  } catch {
    return [];
  }
}

/** Lightweight drug search for autocomplete — returns [{id, name}] */
export async function apiSearchDrugs(
  query: string,
  signal?: AbortSignal,
): Promise<{ id: string; name: string }[]> {
  const sp = new URLSearchParams({ q: query, per_page: '10', page: '1' });
  const res = await fetch(`${BASE}/drugs?${sp}`, { signal });
  if (!res.ok) return [];
  const data: Paginated<ApiDrug> = await res.json();
  return data.items.map(d => ({ id: d.drugbank_id, name: d.name }));
}

// ── Protein API ────────────────────────────────────────────────────────────────

export interface ProteinListParams {
  q?: string;
  protein_type?: string;
  organism?: string;
  page?: number;
  per_page?: number;
  signal?: AbortSignal;
}

/** Paginated protein list with server-side search and filtering */
export async function apiFetchProteins(params: ProteinListParams = {}): Promise<Paginated<Protein>> {
  const sp = new URLSearchParams();
  if (params.q)            sp.set('q', params.q);
  if (params.protein_type) sp.set('protein_type', params.protein_type);
  if (params.organism)     sp.set('organism', params.organism);
  sp.set('page',     String(params.page ?? 1));
  sp.set('per_page', String(params.per_page ?? 25));

  const res = await fetch(`${BASE}/substances?${sp}`, { signal: params.signal });
  if (!res.ok) throw new Error(`Substances API error: ${res.status}`);
  const data: Paginated<ApiProtein> = await res.json();
  return { ...data, items: data.items.map(normalizeProtein) };
}

/** Lightweight protein search for autocomplete — used by Header */
export async function apiSearchProteins(
  query: string,
  signal?: AbortSignal,
): Promise<Protein[]> {
  const sp = new URLSearchParams({ q: query, per_page: '8', page: '1' });
  const res = await fetch(`${BASE}/substances?${sp}`, { signal });
  if (!res.ok) return [];
  const data: Paginated<ApiProtein> = await res.json();
  return data.items.map(normalizeProtein);
}

// ── Stats API (live counts for HomePage) ──────────────────────────────────────

export interface SiteStats {
  drug_count: number;
  protein_count: number;
}

/** Fetch live totals from the backend (2 lightweight calls) */
export async function apiFetchSiteStats(): Promise<SiteStats> {
  const [drugRes, proteinRes] = await Promise.all([
    fetch(`${BASE}/drugs?per_page=1&page=1`),
    fetch(`${BASE}/substances?per_page=1&page=1`),
  ]);
  const drugData: Paginated<unknown> = drugRes.ok ? await drugRes.json() : { total: 17590 };
  const proteinData: Paginated<unknown> = proteinRes.ok ? await proteinRes.json() : { total: 5309 };
  return {
    drug_count: (drugData as Paginated<unknown>).total,
    protein_count: (proteinData as Paginated<unknown>).total,
  };
}

// ── Drug Interactions API ───────────────────────────────────────────────

export interface DrugInteraction {
  id: number;
  drug_id: string;
  interacting_drug_id: string;
  interacting_drug_name: string | null;
  severity: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Fetch drug-drug interactions for a given DrugBank ID (paginated) */
export async function apiFetchDrugInteractions(
  drugbankId: string,
  page = 1,
  perPage = 10,
): Promise<Paginated<DrugInteraction>> {
  const sp = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  const res = await fetch(`${BASE}/interactions/drug/${encodeURIComponent(drugbankId)}?${sp}`);
  if (!res.ok) return { total: 0, page: 1, per_page: perPage, total_pages: 0, items: [] };
  return res.json() as Promise<Paginated<DrugInteraction>>;
}

// ── Drug Network API ───────────────────────────────────────────────────────────

export interface DrugNetworkProtein {
  uniprot_id: string;
  name: string;
  gene_name: string;
  type: 'target' | 'enzyme' | 'transporter' | 'carrier';
  actions: string[];
}

export interface DrugNetworkInteraction {
  drug_id: string;
  name: string;
  severity: string;
  description: string;
}

export interface DrugNetworkData {
  drug: {
    id: string;
    name: string;
    drug_type: string;
    description: string;
    mechanism: string;
    groups: string[];
  };
  proteins: DrugNetworkProtein[];
  interactions: DrugNetworkInteraction[];
  stats: {
    targets: number;
    enzymes: number;
    transporters: number;
    carriers: number;
    drug_interactions: number;
  };
}

/** Fetch full molecular network data for a drug (targets, enzymes, transporters, interactions) */
export async function apiFetchDrugNetwork(
  drugbankId: string,
  maxInteractions = 80,
): Promise<DrugNetworkData | null> {
  try {
    const res = await fetch(
      `${BASE}/drugs/${encodeURIComponent(drugbankId)}/network?max_interactions=${maxInteractions}`,
    );
    if (!res.ok) return null;
    return await res.json() as DrugNetworkData;
  } catch {
    return null;
  }
}
