export type LabInvestigationSuggestion = {
  id: string;
  name: string;
  category: string;
  aliases: string[];
};

const investigationNames = [
  "2 Hour Post Prandial Blood Glucose",
  "24hr Urine for Protein",
  "Acid Phosphatase",
  "AEC",
  "Alanine Aminotransferase (ALT)",
  "Alpha Amylase (Serum/Urine)",
  "Alpha-Fetoprotein (AFP)",
  "Anti-streptolysin test",
  "Ap-Prothrombin Time",
  "Arterial Blood Gas (ABG)",
  "A-scan",
  "ASO titre",
  "Aspartate Aminotransferase (AST)",
  "B/F for Malaria Parasites",
  "Barium Enema",
  "Barium Meal",
  "Barium Meal & Follow Through",
  "Barium Swallow",
  "Bilirubin",
  "Biopsy L/A",
  "Bleeding and Clotting Time",
  "Blood for C/S",
  "Blood Grouping",
  "Blood Grouping & Antibody Screen",
  "Blood Parasites",
  "Blood Sugar PP",
  "Blood Urea",
  "Blood Urea & Electrolytes",
  "Bone Marrow - Trephine Biopsy",
  "Bone Marrow Aspirate",
  "Bone Scan",
  "Breast tissue Biopsy",
  "Bue & Creatinine",
  "C Reactive Protein",
  "Calcium Infusion test",
  "Cancer antigen 19-9",
  "Carcino Embryonic Antigen (CEA)",
  "Cerebrospinal Fluid for C/S",
  "Chloride",
  "Clusters Of Differentiation Cells (CD4)",
  "Coombs Test (Direct)",
  "Creatine Kinase - Mb (CK - Mb)",
  "Creatine Kinase (CK)",
  "CSF Latex Agglutination",
  "Cystogram",
  "Cytology",
  "Demonstration of Heinz bodies",
  "Digoxin Level",
  "Dihydroxy Epiandesterone Sulphate (Dhea-S)",
  "Direct Bilirubin/Total Bilirubin",
  "Donor Screening for HBsAg",
  "Doppler Scan",
  "Ductologram/Galactography",
  "ECG",
  "EEG (Electroencephalogram)",
  "Erythrocyte Sedimentation Rate (ESR)",
  "Estrogen",
  "Factor IX",
  "Factor VIII",
  "Fasting Blood Sugar",
  "Fistulogram",
  "Follicle Stimulating Hormone (FSH)",
  "FT3",
  "FT4",
  "Full Blood Count FBC (Auto) & Film Comment",
  "Full Blood Count FBC (Automation)",
  "Full Blood Count with Film Comment (Manual)",
  "Fungal Cultures",
  "Gamma Glutamyl Transferase (GGT)",
  "Glucose-6-Phosphate Dehydrogenase (G6PD)",
  "Glycosylated Haemoglobin (HBA 1C)",
  "Gonioscopy",
  "Grouping/X' Matching/Unit",
  "Guthrie test",
  "Haemoglobin A2 & F Estimation",
  "Haemoglobin Electrophoresis",
  "Haemoglobin Estimation (HB)",
  "HDL - Cholesterol",
  "Helicobacter Pylori Test",
  "Hematocrit",
  "Hepatitis B Surface Antigen (HBSAG) HBV",
  "Hepatitis B Virus Profile (HBV Profile)",
  "Hepatitis C screening",
  "High Vaginal Swab for C/S",
  "High Vaginal Swab Routine Examination",
  "Histopathology  (Extra Large Sample)",
  "Histopathology  (Large Sample)",
  "Histopathology  (Medium Sample)",
  "Histopathology  (Small Sample)",
  "Holter",
  "Human Immunodeficiency Virus (HIV) Confirmation",
  "Human Immunodeficiency Virus (HIV) Screening",
  "Hysterosalpingogram",
  "Immunostaining",
  "Intravenous Urography",
  "IOPA Xray",
  "Keratometry",
  "LDL - Cholesterol",
  "LFT",
  "Lipid Profile",
  "Lupus Erythematosus Cell (Le Cell)",
  "Luteinizing Hormone (LH)",
  "Magnesium",
  "Malaria Card Test (Dipstik assay/rapid card)",
  "Mammogram",
  "Miscelllaneous Cultures (Fluids, Aspirates & Exudates)",
  "Myelogram - 1 Region",
  "Myocardial perfusion imaging",
  "NA+",
  "Oral Glucose Tolerance Test (OGTT)",
  "Orthopanthomograph (OPT)",
  "Pancreatic Amylase",
  "Pap Smear/Fine Needle Aspiration",
  "Percutaneous Biopsy - Flouroscopic Guide",
  "Phosphorus",
  "Plasma Cortisol",
  "Platelet Count",
  "Pleural fluid analysis",
  "Potassium",
  "Pregnancy Test",
  "Progesterone (Prog)",
  "Prostate Specific Antigen (PSA)",
  "Prothrombin Time",
  "Pulmonary Function test",
  "Random Blood Sugar",
  "Renal Function Test",
  "Reticulocyte Count (Retics)",
  "RH Typing",
  "Rheumatoid Factor",
  "Routine Stool Examination",
  "Routine Urine Examination",
  "Semen Analysis",
  "Serum Adrenocorticotropic Hormone (ACTH)",
  "Serum Albumin",
  "Serum Alkaline Phosphatase (ALP)",
  "Serum Beta-Human Chorionic Gonadotropin (HCG)",
  "Serum Calcium",
  "Serum Creatinine",
  "Serum Electrolyte (Na+, K+)",
  "Serum Ferritin",
  "Serum Iron (Fe)",
  "Serum Lactate Dehydrogenase (LDH)",
  "Serum Prolactin (PRL)",
  "Serum Total Protein",
  "Serum Triglyceride",
  "Serum Uric Acid",
  "Serum vitamin B12, and folate levels",
  "Sialogram",
  "Sickling Test",
  "Skin Scrapping for Fungal Elements",
  "Skin Snip",
  "Stool C/S",
  "Stool for Occult Blood",
  "T3",
  "T4",
  "Testosterone",
  "Thyroid Function Test (TSH)",
  "Thyroid Profile",
  "Total Iron Binding Capacity (TIBC)",
  "Total leucocyte count",
  "Total Proteins Blood",
  "Total Serum Cholesterol",
  "Transhepatic cholangiography (PTC)",
  "Trophozoite Count",
  "Troponin",
  "Typhi Dot",
  "Ultrasound",
  "Ultrasound - 2 Regions",
  "Ultrasound biomicroscopy",
  "Ultrasound Guided Incision & Drainage",
  "Urethrogram",
  "Urine C/S",
  "Urine For Bence Jones Protein",
  "Urine Sugar",
  "VCT",
  "Veneral Disease Research Laboratory (VDRL)",
  "Venogram - 1 Region",
  "Viral serology",
  "Vitality Test",
  "VLDL",
  "WBC+Differential",
  "Widal Test",
  "X-ray one region",
  "X-ray two region",
];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const collapseWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const extractAliases = (name: string) => {
  const aliases = new Set<string>();
  const canonicalName = collapseWhitespace(name);
  const shortCodes = canonicalName.match(/\(([^)]+)\)/g) ?? [];

  for (const rawCode of shortCodes) {
    const code = rawCode.replace(/[()]/g, "").trim();
    if (!code) continue;

    aliases.add(code);
    for (const part of code.split(/[,/&]/)) {
      const trimmedPart = collapseWhitespace(part);
      if (trimmedPart) {
        aliases.add(trimmedPart);
      }
    }
  }

  const noParentheses = collapseWhitespace(canonicalName.replace(/\([^)]*\)/g, " "));
  if (noParentheses) aliases.add(noParentheses);

  const slashExpanded = collapseWhitespace(noParentheses.replace(/\//g, " "));
  if (slashExpanded) aliases.add(slashExpanded);

  const andExpanded = collapseWhitespace(noParentheses.replace(/&/g, " and "));
  if (andExpanded) aliases.add(andExpanded);

  const noHyphen = collapseWhitespace(noParentheses.replace(/-/g, " "));
  if (noHyphen) aliases.add(noHyphen);

  const words = noParentheses.match(/[A-Za-z0-9]+/g) ?? [];
  if (words.length >= 2 && words.length <= 8) {
    const acronym = words.map((word) => word[0]).join("").toUpperCase();
    if (acronym.length >= 2) {
      aliases.add(acronym);
    }
  }

  const canonicalKey = normalize(canonicalName);
  return Array.from(aliases).filter((alias) => alias && normalize(alias) !== canonicalKey);
};

const toUniqueId = (rawName: string, seenIds: Map<string, number>) => {
  const baseId = slugify(rawName) || "lab-investigation";
  const nextCount = (seenIds.get(baseId) ?? 0) + 1;
  seenIds.set(baseId, nextCount);
  return nextCount === 1 ? baseId : `${baseId}-${nextCount}`;
};

const uniqueInvestigationNames = Array.from(
  new Map(investigationNames.map((name) => [name.toLowerCase().trim(), name.trim()])).values()
);

const seenInvestigationIds = new Map<string, number>();
const labInvestigations: LabInvestigationSuggestion[] = uniqueInvestigationNames.map((name) => ({
  id: toUniqueId(name, seenInvestigationIds),
  name,
  category: "General",
  aliases: extractAliases(name),
}));

export const searchLabInvestigations = (query: string, limit = 8) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);

  const scored = labInvestigations
    .map((item) => {
      const haystack = normalize([item.name, item.category, ...item.aliases].join(" "));
      const score = queryTokens.reduce((total, token) => {
        if (haystack === token) return total + 8;
        if (haystack.startsWith(token)) return total + 5;
        if (haystack.includes(token)) return total + 3;
        return total;
      }, 0);

      const exactAliasMatch = item.aliases.some((alias) => normalize(alias) === normalizedQuery);
      const exactNameMatch = normalize(item.name) === normalizedQuery;
      const prefixMatch = normalize(item.name).startsWith(normalizedQuery);

      const totalScore =
        score +
        (exactNameMatch ? 50 : 0) +
        (exactAliasMatch ? 25 : 0) +
        (prefixMatch ? 12 : 0);

      return { item, score: totalScore };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
    .slice(0, limit)
    .map(({ item }) => item);

  return scored;
};
