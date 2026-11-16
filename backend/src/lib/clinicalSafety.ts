import { z } from "zod";
import { validationError } from "./errors.js";

const scoreBand = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  value: z.string().trim().min(1).max(30).optional(),
  points: z.number().int().min(0).max(20),
}).refine((value) => value.value !== undefined || value.min !== undefined || value.max !== undefined, {
  message: "Each EWS score band needs a value or numeric range.",
});

export const ewsRulesSchema = z.object({
  parameters: z.record(z.string(), z.array(scoreBand).min(1)),
  bands: z.object({
    mediumMin: z.number().int().min(0),
    highMin: z.number().int().min(1),
  }).refine((value) => value.highMin > value.mediumMin, {
    message: "The high band must start above the medium band.",
  }),
}).superRefine((rules, context) => {
  for (const [parameter, bands] of Object.entries(rules.parameters)) {
    for (const [index, band] of bands.entries()) {
      if (band.min !== undefined && band.max !== undefined && band.min > band.max) {
        context.addIssue({
          code: "custom",
          path: ["parameters", parameter, index],
          message: "A score range minimum cannot exceed its maximum.",
        });
      }
    }
  }
});

export type EwsRules = z.infer<typeof ewsRulesSchema>;
export type EwsObservations = Record<string, number | string | null | undefined>;

export const calculateEws = (observations: EwsObservations, rawRules: unknown) => {
  const parsed = ewsRulesSchema.safeParse(rawRules);
  if (!parsed.success) {
    throw validationError("The active EWS policy is invalid.", "EWS_POLICY_INVALID", parsed.error.flatten());
  }

  let score = 0;
  const details: Array<{ parameter: string; points: number }> = [];
  for (const [parameter, bands] of Object.entries(parsed.data.parameters)) {
    const observed = observations[parameter];
    if (observed === null || observed === undefined || observed === "") continue;
    const matched = bands.filter((band) =>
      band.value !== undefined
        ? typeof observed === "string" && observed.toLocaleLowerCase() === band.value.toLocaleLowerCase()
        : typeof observed === "number" &&
          (band.min === undefined || observed >= band.min) &&
          (band.max === undefined || observed <= band.max),
    );
    if (matched.length === 0) continue;
    const points = Math.max(...matched.map((band) => band.points));
    score += points;
    details.push({ parameter, points });
  }

  const band = score >= parsed.data.bands.highMin
    ? "HIGH"
    : score >= parsed.data.bands.mediumMin ? "MEDIUM" : "LOW";
  return { score, band, details };
};

export type DrugSafetyInput = {
  drug: { id: string; genericName: string };
  allergies: Array<{ drugId?: string | null; substance: string; severity: string | null }>;
  activeDrugs: string[];
  interactions: Array<{ genericA: string; genericB: string; severity: string; effect: string | null }>;
};

export type SafetyAlert = {
  code: string;
  severity: "STOP" | "WARN";
  message: string;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();

export const evaluateDrugSafety = ({
  drug,
  allergies,
  activeDrugs,
  interactions,
}: DrugSafetyInput): SafetyAlert[] => {
  const genericName = normalize(drug.genericName);
  const alerts: SafetyAlert[] = [];

  for (const allergy of allergies) {
    const substance = normalize(allergy.substance);
    const directMatch = allergy.drugId === drug.id;
    if (directMatch || (substance && (genericName.includes(substance) || substance.includes(genericName)))) {
      const severe = allergy.severity === "SEVERE" || allergy.severity === "LIFE_THREATENING";
      alerts.push({
        code: severe ? "SEVERE_ALLERGY" : "DRUG_ALLERGY",
        severity: severe ? "STOP" : "WARN",
        message: `${drug.genericName} matches recorded allergy: ${allergy.substance}.`,
      });
    }
  }

  for (const activeDrug of activeDrugs) {
    const other = normalize(activeDrug);
    const interaction = interactions.find((row) =>
      (normalize(row.genericA) === genericName && normalize(row.genericB) === other) ||
      (normalize(row.genericB) === genericName && normalize(row.genericA) === other),
    );
    if (!interaction) continue;
    const hardStop = interaction.severity === "MAJOR" || interaction.severity === "CONTRAINDICATED";
    alerts.push({
      code: `INTERACTION_${interaction.severity}`,
      severity: hardStop ? "STOP" : "WARN",
      message: interaction.effect || `${drug.genericName} may interact with ${activeDrug}.`,
    });
  }

  return alerts;
};
