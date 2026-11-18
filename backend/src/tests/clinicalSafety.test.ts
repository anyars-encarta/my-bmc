import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { calculateEws, evaluateDrugSafety, ewsRulesSchema } from "../lib/clinicalSafety.js";

describe("clinical safety helpers", () => {
  test("computes configured EWS scores and bands from present observations", () => {
    const result = calculateEws(
      { pulseBpm: 120, temperatureC: 38, avpu: "A" },
      {
        parameters: {
          pulseBpm: [{ max: 100, points: 0 }, { min: 101, points: 2 }],
          temperatureC: [{ max: 37, points: 0 }, { min: 37.1, points: 1 }],
          avpu: [{ value: "A", points: 0 }],
        },
        bands: { mediumMin: 2, highMin: 3 },
      },
    );
    assert.equal(result.score, 3);
    assert.equal(result.band, "HIGH");
  });

  test("reports invalid scoring rules at their parameter path", () => {
    const result = ewsRulesSchema.safeParse({
      parameters: { pulseBpm: [{ min: 100 }] },
      bands: { mediumMin: 2, highMin: 3 },
    });

    test("rejects numeric observations that fall outside every configured scoring band", () => {
      assert.throws(() => calculateEws(
        { pulseBpm: 120 },
        {
          parameters: { pulseBpm: [{ max: 100, points: 0 }] },
          bands: { mediumMin: 1, highMin: 2 },
        },
      ), (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "EWS_OBSERVATION_UNSCORED");
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.deepEqual(result.error.issues[0]?.path, ["parameters", "pulseBpm", 0, "points"]);
    }
  });

  test("flags severe allergy and major interaction as hard stops", () => {
    const alerts = evaluateDrugSafety({
      drug: { id: "drug-a", genericName: "penicillin V" },
      allergies: [{ substance: "penicillin", severity: "SEVERE" }],
      activeDrugs: ["warfarin"],
      interactions: [{
        genericA: "penicillin V",
        genericB: "warfarin",
        severity: "MAJOR",
        effect: "Increased anticoagulant effect.",
      }],
    });
    assert.deepEqual(alerts.map((alert) => alert.severity), ["STOP", "STOP"]);
  });
});
