import assert from "node:assert/strict";
import test from "node:test";

import { classifyAreaClusters } from "@/lib/area-clustering";
import {
  canonicalizeAreaClusterLabel,
  detectAreaClusterAmbiguity,
  detectAreaCluster,
} from "@/lib/normalize";

test("ambiguous address with society and road is routed to LLM review", () => {
  const result = detectAreaClusterAmbiguity({
    addressRaw: "Flat C-602 Sunshine Heights Kunal Icon Road Pimple Saudagar",
    detectedCluster: detectAreaCluster(
      "Flat C-602 Sunshine Heights Kunal Icon Road Pimple Saudagar"
    ),
  });

  assert.equal(result.shouldUseLlm, true);
  assert.match(result.reasonCode ?? "", /conflicting_signals|road_heavy/);
});

test("canonicalize collapses alias variants and rejects generic road-only labels", () => {
  assert.equal(canonicalizeAreaClusterLabel("roseland residency society"), "Roseland Residency");
  assert.equal(canonicalizeAreaClusterLabel("Kunal Icon Road"), "Kunal Icon");
  assert.equal(canonicalizeAreaClusterLabel("A101 Roseland"), "Roseland");
  assert.equal(canonicalizeAreaClusterLabel("B8-204 Coconest"), "Coconest");
  assert.equal(canonicalizeAreaClusterLabel("Residency"), null);
  assert.equal(canonicalizeAreaClusterLabel("Pimple Saudagar Road"), null);
});

test("detectAreaCluster prefers explicit residential complex phrases", () => {
  assert.equal(
    detectAreaCluster("B-1203, Triose Apartment Near Govind Garaden Restauran"),
    "Triose Apartment"
  );
  assert.equal(
    detectAreaCluster("00 Aashirwad Colony Pimple Saudagar"),
    "Aashirwad Colony"
  );
  assert.equal(
    detectAreaCluster("Kunjir Hights Near P C M C Hospital Pimpale Saudagar"),
    "Kunjir Hights"
  );
});

test("classifier reuses an existing saved cluster before creating a new one", async () => {
  const { results } = await classifyAreaClusters(
    [
      {
        rowIndex: 0,
        addressRaw: "Flat 204 Roseland Residency Kunal Icon Road Pimple Saudagar",
      },
    ],
    {
      existingClusters: ["Roseland Residency", "Kunal Icon"],
    }
  );

  assert.equal(results[0].areaCluster, "Roseland Residency");
  assert.equal(results[0].reasonCode, "matched_existing_cluster");
  assert.equal(results[0].needsReview, false);
});

test("classifier ignores generic saved cluster labels like Residency", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";

  const { results } = await classifyAreaClusters(
    [
      {
        rowIndex: 0,
        addressRaw:
          "Dwaradheesh Residency, Flat 24 Building C, Shivar Chowk, Kunal Icon Rd Pimple Saudagar Haveli",
        currentAreaCluster: "Residency",
      },
    ],
    {
      existingClusters: ["Residency", "Roseland Residency"],
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    results: [
                      {
                        rowIndex: 0,
                        primaryCluster: "Dwaradheesh Residency",
                        confidence: 0.94,
                        reasonCode: "society_explicit",
                        matchType: "new",
                      },
                    ],
                  }),
                },
              },
            ],
          })
        ),
    }
  );

  assert.equal(results[0].areaCluster, "Dwaradheesh Residency");
  assert.notEqual(results[0].areaCluster, "Residency");
});

test("classifier keeps low-information addresses separate", async () => {
  const { results } = await classifyAreaClusters(
    [
      {
        rowIndex: 0,
        addressRaw: "101A",
        uniqueKey: "YQA0720664",
      },
    ],
    {
      existingClusters: ["Roseland Residency", "Kunal Icon"],
    }
  );

  assert.match(results[0].areaCluster, /^Uncertain: 101A \[YQA0720664\]$/);
  assert.equal(results[0].reasonCode, "low_information_address");
  assert.equal(results[0].needsReview, true);
});

test("classifier accepts high-confidence LLM society prediction", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";

  const { results } = await classifyAreaClusters(
    [
      {
        rowIndex: 0,
        addressRaw: "Flat C-602 Sunshine Heights Kunal Icon Road Pimple Saudagar",
      },
    ],
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    results: [
                      {
                        rowIndex: 0,
                        primaryCluster: "Sunshine Heights",
                        confidence: 0.92,
                        reasonCode: "society_explicit",
                      },
                    ],
                  }),
                },
              },
            ],
          })
        ),
    }
  );

  assert.equal(results[0].areaCluster, "Sunshine Heights");
  assert.equal(results[0].source, "llm");
  assert.equal(results[0].needsReview, false);
});

test("classifier preserves deterministic cluster for low-confidence LLM output", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";

  const { results } = await classifyAreaClusters(
    [
      {
        rowIndex: 0,
        addressRaw: "Flat C-602 Sunshine Heights Kunal Icon Road Pimple Saudagar",
      },
    ],
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    results: [
                      {
                        rowIndex: 0,
                        primaryCluster: "Sunshine Heights",
                        confidence: 0.55,
                        reasonCode: "conflicting_signals",
                      },
                    ],
                  }),
                },
              },
            ],
          })
        ),
    }
  );

  assert.equal(results[0].areaCluster, "Kunal Icon");
  assert.equal(results[0].needsReview, true);
  assert.equal(results[0].suggestedAreaCluster, "Sunshine Heights");
});

test("classifier force-LLM mode sends actionable rows to OpenRouter", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";

  const { results, metadata } = await classifyAreaClusters(
    [
      {
        rowIndex: 0,
        addressRaw: "Flat 204 Roseland Residency Kunal Icon Road Pimple Saudagar",
      },
    ],
    {
      existingClusters: ["Roseland Residency", "Kunal Icon"],
      forceLlmForActionableRows: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    results: [
                      {
                        rowIndex: 0,
                        primaryCluster: "Roseland Residency",
                        confidence: 0.98,
                        reasonCode: "matched_existing_cluster",
                        matchType: "existing",
                      },
                    ],
                  }),
                },
              },
            ],
          })
        ),
    }
  );

  assert.equal(metadata.usedOpenRouter, true);
  assert.equal(metadata.attemptedOpenRouter, true);
  assert.equal(metadata.llmRows, 1);
  assert.equal(results[0].areaCluster, "Roseland Residency");
});

test("classifier parses fenced JSON returned by the model", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";

  const { results, metadata } = await classifyAreaClusters(
    [
      {
        rowIndex: 0,
        addressRaw: "Flat 7 Sai Pearl Kunal Icon Road Pimple Saudagar",
      },
    ],
    {
      forceLlmForActionableRows: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "```json\n[\n  {\n    \"rowIndex\": 0,\n    \"primaryCluster\": \"Sai Pearl\",\n    \"secondaryHint\": \"\",\n    \"confidence\": 1,\n    \"reasonCode\": \"matched_existing_cluster\",\n    \"matchType\": \"existing\"\n  }\n]\n```",
                },
              },
            ],
          })
        ),
    }
  );

  assert.equal(metadata.usedOpenRouter, true);
  assert.equal(results[0].areaCluster, "Sai Pearl");
  assert.equal(results[0].reasonCode, "matched_existing_cluster");
});
