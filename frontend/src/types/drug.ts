export interface DrugProduct {
  id: number;
  name: string | null;
  labeller: string | null;
  dosage_form: string | null;
  strength: string | null;
  route: string | null;
  country: string | null;
  source: string | null;
}

export interface Drug {
  id: string;
  drug_code: string;
  name: string;
  generic_name: string;
  type: string;
  groups: string[];
  state: string;
  categories: string[];
  description: string;
  indication: string;
  mechanism: string;
  pharmacodynamics: string;
  toxicity: string;
  absorption: string;
  metabolism: string;
  half_life: string;
  protein_binding: string;
  route_of_elimination: string;
  molecular_formula: string;
  molecular_weight: string | number;
  smiles: string;
  inchikey: string;
  atc_codes: string[];
  aliases: string[];
  targets: number;
  enzymes: number;
  transporters: number;
  products: DrugProduct[];
}
