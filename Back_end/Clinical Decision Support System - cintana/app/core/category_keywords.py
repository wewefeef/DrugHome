"""
Disease-category → keyword mapping.

Used by:
  - app/core/category_cache.py   (resolves keywords → category_id list at startup)
  - app/routers/api_drugs.py     (fallback LIKE query if cache not warmed)
"""

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "pain":        ["Analgesic", "Antipyretic", "Anti-Inflammatory", "Opioid", "Migraine", "Nonsteroidal"],
    "cardio":      ["Cardiovascular", "Antihypertensive", "Antiarrhythmic", "Vasodilator", "Anticoagulant", "Antiplatelet", "Cardiac", "Diuretic"],
    "antibiotics": ["Anti-Bacterial", "Antibiotic", "Antimicrobial", "Anti-Infective", "Bactericidal"],
    "cns":         ["Central Nervous System", "Antidepressant", "Antipsychotic", "Anxiolytic", "Sedative", "Hypnotic", "Stimulant"],
    "diabetes":    ["Hypoglycemic", "Antidiabetic", "Insulin", "Endocrine", "Hormones"],
    "neuro":       ["Anticonvulsant", "Parkinson", "Alzheimer", "Multiple Sclerosis", "Neuropathy", "Neurology"],
    "oncology":    ["Antineoplastic", "Chemotherapy", "Cancer", "Immunotherapy", "Cytotoxic"],
    "gi":          ["Gastrointestinal", "Antacid", "Proton Pump", "Laxative", "Antiemetic", "Digestive"],
    "immuno":      ["Immunosuppressive", "Immunomodulatory", "Autoimmune", "Antibodies", "Monoclonal"],
    "antiviral":   ["Antiviral", "Antifungal", "Antiparasitic", "HIV", "Hepatitis", "Antiretroviral"],
    "cholesterol": ["Lipid", "Statin", "Cholesterol", "Fibrate", "Antilipemic"],
    "respiratory": ["Respiratory", "Bronchodilator", "Antiasthmatic", "Expectorant", "Antitussive"],
    "rheuma":      ["Rheumatoid", "Anti-Rheumatic", "Gout", "Bone", "Arthritis", "NSAID"],
}
