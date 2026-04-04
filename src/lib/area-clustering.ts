import { OpenRouter } from "@openrouter/sdk";

import {
  buildDisplayAddress,
  canonicalizeAreaClusterLabel,
  cleanText,
  detectAreaCluster,
  detectAreaClusterAmbiguity,
  findKnownClusterMatch,
  isLowInformationAddress,
  isRoadOnlyClusterLabel,
  toSafeClusterDisplayText,
} from "@/lib/normalize";

export type AreaClusterSource = "rule" | "llm" | "fallback";

export type AreaClusterClassification = {
  rowIndex: number;
  areaCluster: string;
  source: AreaClusterSource;
  confidence: number;
  needsReview: boolean;
  reasonCode: string;
  suggestedAreaCluster?: string;
};

export type AreaClusterClassificationMetadata = {
  totalRows: number;
  llmRows: number;
  usedOpenRouter: boolean;
  attemptedOpenRouter: boolean;
  model: string | null;
  modelSource: "env" | "default" | null;
};

type ClassificationInput = {
  rowIndex: number;
  addressRaw: string;
  displayAddress?: string;
  currentAreaCluster?: string;
  uniqueKey?: string;
};

type OpenRouterPrediction = {
  rowIndex: number;
  primaryCluster?: string;
  secondaryHint?: string;
  confidence?: number;
  reasonCode?: string;
  matchType?: "existing" | "new" | "uncertain";
};

type FetchLike = typeof fetch;

type ExistingClusterEntry = {
  canonical: string;
  normalized: string;
};

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const AREA_CLUSTERING_DEBUG = process.env.DEBUG_AREA_CLUSTERING === "1";

function normalizeKey(value: string): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function resolveOpenRouterModel(): string {
  return cleanText(process.env.OPENROUTER_MODEL) || DEFAULT_OPENROUTER_MODEL;
}

function resolveOpenRouterModelSource(): "env" | "default" {
  return cleanText(process.env.OPENROUTER_MODEL) ? "env" : "default";
}

function debugAreaClustering(event: string, details: Record<string, unknown>) {
  if (!AREA_CLUSTERING_DEBUG) {
    return;
  }
  console.info(`[area-clustering] ${event}`, details);
}

function clampConfidence(confidence: number | undefined, fallback: number): number {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, confidence));
}

function buildStandaloneCluster(displayAddress: string, uniqueKey?: string): string {
  const label = toSafeClusterDisplayText(displayAddress) || "Uncertain Address";
  const suffix = toSafeClusterDisplayText(uniqueKey);
  return suffix ? `Uncertain: ${label} [${suffix}]` : `Uncertain: ${label}`;
}

function buildExistingClusterCatalog(existingClusters: string[] | undefined): ExistingClusterEntry[] {
  const deduped = new Map<string, string>();

  for (const cluster of existingClusters ?? []) {
    if (cleanText(cluster).startsWith("Uncertain:")) {
      continue;
    }
    const canonical = canonicalizeAreaClusterLabel(cluster);
    if (!canonical) {
      continue;
    }
    const normalized = normalizeKey(canonical);
    if (!normalized) {
      continue;
    }
    if (!deduped.has(normalized)) {
      deduped.set(normalized, canonical);
    }
  }

  return Array.from(deduped.entries()).map(([normalized, canonical]) => ({
    canonical,
    normalized,
  }));
}

function matchExistingCluster(
  addressRaw: string,
  displayAddress: string,
  currentAreaCluster: string | undefined,
  existingClusters: ExistingClusterEntry[]
): string | null {
  const currentCanonical = canonicalizeAreaClusterLabel(currentAreaCluster);
  if (currentCanonical) {
    const currentMatch = existingClusters.find(
      (entry) => entry.normalized === normalizeKey(currentCanonical)
    );
    if (currentMatch) {
      return currentMatch.canonical;
    }
  }

  const candidates = [addressRaw, displayAddress]
    .map((value) => normalizeKey(value))
    .filter(Boolean);

  let bestMatch: ExistingClusterEntry | null = null;
  for (const entry of existingClusters) {
    for (const candidate of candidates) {
      if (
        candidate.includes(entry.normalized) &&
        (!bestMatch || entry.normalized.length > bestMatch.normalized.length)
      ) {
        bestMatch = entry;
      }
    }
  }

  return bestMatch?.canonical ?? null;
}

function buildDefaultClassification(
  input: ClassificationInput,
  existingClusters: ExistingClusterEntry[]
): AreaClusterClassification {
  const addressRaw = cleanText(input.addressRaw);
  const displayAddress = cleanText(input.displayAddress || buildDisplayAddress(addressRaw));

  if (isLowInformationAddress(displayAddress)) {
    return {
      rowIndex: input.rowIndex,
      areaCluster: buildStandaloneCluster(displayAddress, input.uniqueKey),
      source: "fallback",
      confidence: 0.18,
      needsReview: true,
      reasonCode: "low_information_address",
    };
  }

  const existingMatch = matchExistingCluster(
    addressRaw,
    displayAddress,
    input.currentAreaCluster,
    existingClusters
  );
  if (existingMatch) {
    return {
      rowIndex: input.rowIndex,
      areaCluster: existingMatch,
      source: "rule",
      confidence: 0.96,
      needsReview: false,
      reasonCode: "matched_existing_cluster",
    };
  }

  const deterministicCluster = cleanText(input.currentAreaCluster || detectAreaCluster(addressRaw));
  const knownMatch = findKnownClusterMatch(addressRaw);
  const ambiguity = detectAreaClusterAmbiguity({
    addressRaw,
    displayAddress,
    detectedCluster: deterministicCluster,
  });

  if (knownMatch) {
    return {
      rowIndex: input.rowIndex,
      areaCluster: knownMatch,
      source: "rule",
      confidence: ambiguity.shouldUseLlm ? 0.72 : 0.93,
      needsReview: ambiguity.shouldUseLlm,
      reasonCode: ambiguity.reasonCode ?? "rule_match",
    };
  }

  return {
    rowIndex: input.rowIndex,
    areaCluster: deterministicCluster || buildStandaloneCluster(displayAddress, input.uniqueKey),
    source:
      deterministicCluster === "Pimple Saudagar Core" || !deterministicCluster ? "fallback" : "rule",
    confidence:
      deterministicCluster === "Pimple Saudagar Core" || !deterministicCluster ? 0.38 : 0.62,
    needsReview: true,
    reasonCode:
      ambiguity.reasonCode ??
      (deterministicCluster === "Pimple Saudagar Core" ? "fallback_cluster" : "rule_inferred"),
  };
}

function shouldCallLlm(
  input: ClassificationInput,
  base: AreaClusterClassification,
  existingClusters: ExistingClusterEntry[],
  forceLlmForActionableRows: boolean
): boolean {
  if (base.reasonCode === "low_information_address") {
    return false;
  }

  if (forceLlmForActionableRows) {
    return true;
  }

  if (base.reasonCode === "matched_existing_cluster") {
    return false;
  }

  const ambiguity = detectAreaClusterAmbiguity({
    addressRaw: input.addressRaw,
    displayAddress: input.displayAddress,
    detectedCluster: base.areaCluster,
  });

  if (ambiguity.shouldUseLlm) {
    return true;
  }

  return !matchExistingCluster(input.addressRaw, input.displayAddress || "", base.areaCluster, existingClusters);
}

function buildPrompt(rows: ClassificationInput[], existingClusters: ExistingClusterEntry[]): string {
  const serializedRows = rows.map((row) => ({
    rowIndex: row.rowIndex,
    addressRaw: cleanText(row.addressRaw),
    displayAddress: cleanText(row.displayAddress || buildDisplayAddress(row.addressRaw)),
    currentAreaCluster: cleanText(row.currentAreaCluster || detectAreaCluster(row.addressRaw)),
  }));

  return [
    "Classify each voter address into a society-level cluster for Pimple Saudagar, Pune.",
    "Primary objective: reuse an existing saved cluster whenever the address clearly belongs to it.",
    "Only create a new cluster when no existing cluster is a clear match.",
    "Hard rules:",
    "- Cluster names must be the society/building/colony/residential-complex name only.",
    "- Never use flat numbers, wing letters, road names, bank names, landmarks, or words like near/javal/opp as the cluster.",
    "- If the address says '<name> Residency', '<name> Society', '<name> Colony', '<name> Heights', choose the full phrase, not a partial token.",
    "- If the address is only a road/landmark like 'Kunal Icon Road ICICI Bank Javal', mark it uncertain.",
    "- If the address is only a unit number like 101A, 501, B-204, mark it uncertain.",
    "Examples:",
    '- "Purwa Residency Shiv Sai Lane Javal Pimple Saudagar" => primaryCluster: "Purwa Residency", matchType: "new" unless it already exists.',
    '- "Shiv Sai Society Kunal Icon Road Pimple Saudagar" => primaryCluster: "Shiv Sai Society".',
    '- "Colony No 4 Vishvashanti Pimple Saudagar" => primaryCluster: "Vishvashanti Colony".',
    '- "Kunal Icon Road Icici Bank Javal Pimple Saudagar" => matchType: "uncertain", primaryCluster: "".',
    "Return strict JSON only.",
    "Available existing clusters:",
    JSON.stringify(existingClusters.map((entry) => entry.canonical)),
    "Return strict JSON only, as an array of objects with keys:",
    'rowIndex, primaryCluster, secondaryHint, confidence, reasonCode, matchType.',
    "matchType must be one of: existing, new, uncertain.",
    "confidence must be a number between 0 and 1.",
    "reasonCode should be one of: matched_existing_cluster, society_explicit, building_explicit, colony_explicit, conflicting_signals, road_only, landmark_only, locality_only, ocr_noisy, low_signal, low_information_address.",
    "Rows:",
    JSON.stringify(serializedRows),
  ].join("\n");
}

function buildOpenRouterRequestBody(
  rows: ClassificationInput[],
  existingClusters: ExistingClusterEntry[],
  model: string
) {
  return {
    model,
    temperature: 0,
    stream: false,
    response_format: { type: "json_object" as const },
    messages: [
      {
        role: "system" as const,
        content:
          "You extract structured society labels. Reuse existing saved clusters when possible, create new clusters only when clearly justified, and mark road-only or low-information addresses as uncertain.",
      },
      {
        role: "user" as const,
        content: buildPrompt(rows, existingClusters),
      },
    ],
  };
}

function extractJsonPayload(content: string): string {
  const trimmed = cleanText(content);

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

async function requestOpenRouterPredictions(
  rows: ClassificationInput[],
  existingClusters: ExistingClusterEntry[],
  fetchImpl: FetchLike
): Promise<OpenRouterPrediction[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const baseUrl = process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL;
  const model = resolveOpenRouterModel();
  const requestBody = buildOpenRouterRequestBody(rows, existingClusters, model);
  const httpReferer = cleanText(process.env.OPENROUTER_SITE_URL) || "https://blo-photo.local";
  const appTitle = cleanText(process.env.OPENROUTER_APP_TITLE) || "blo_photo_area_clustering";

  debugAreaClustering("openrouter_request", {
    model,
    baseUrl,
    rows: rows.length,
    existingClusters: existingClusters.length,
    rowIndexes: rows.map((row) => row.rowIndex),
    preview: {
      httpReferer,
      appTitle,
      chatRequest: requestBody,
    },
  });

  let content: string | null | undefined;
  if (fetchImpl !== fetch) {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": httpReferer,
        "X-OpenRouter-Title": appTitle,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      debugAreaClustering("openrouter_error_response", {
        status: response.status,
        rows: rows.length,
        model,
      });
      throw new Error(`OpenRouter request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    content = payload.choices?.[0]?.message?.content;
  } else {
    const openRouter = new OpenRouter({
      apiKey,
      serverURL: baseUrl,
      httpReferer,
      appTitle,
      debugLogger: AREA_CLUSTERING_DEBUG ? console : undefined,
    });

    const completion = (await openRouter.chat.send({
      httpReferer,
      appTitle,
      chatRequest: requestBody,
    })) as { choices?: Array<{ message?: { content?: string | null } }> };

    content = completion.choices?.[0]?.message?.content;
  }

  if (!content) {
    throw new Error("OpenRouter response did not include any content");
  }

  const jsonPayload = extractJsonPayload(content);

  debugAreaClustering("openrouter_response", {
    rows: rows.length,
    model,
    contentPreview: jsonPayload.slice(0, 800),
  });

  const parsed = JSON.parse(jsonPayload) as
    | { results?: OpenRouterPrediction[] }
    | OpenRouterPrediction[];
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.results)) {
    return parsed.results;
  }
  throw new Error("OpenRouter response did not include a results array");
}

function mergePrediction(
  input: ClassificationInput,
  base: AreaClusterClassification,
  prediction: OpenRouterPrediction | undefined,
  existingClusters: ExistingClusterEntry[]
): AreaClusterClassification {
  if (!prediction) {
    return {
      ...base,
      needsReview: true,
      reasonCode: "llm_missing_result",
    };
  }

  if (prediction.matchType === "uncertain") {
    return {
      rowIndex: input.rowIndex,
      areaCluster: buildStandaloneCluster(
        cleanText(input.displayAddress || buildDisplayAddress(input.addressRaw)),
        input.uniqueKey
      ),
      source: "fallback",
      confidence: clampConfidence(prediction.confidence, 0.18),
      needsReview: true,
      reasonCode: cleanText(prediction.reasonCode) || "low_information_address",
    };
  }

  const canonicalPrediction = canonicalizeAreaClusterLabel(prediction.primaryCluster);
  const predictionLooksRoadOnly = isRoadOnlyClusterLabel(prediction.primaryCluster);
  const confidence = clampConfidence(prediction.confidence, base.confidence);
  const reasonCode = cleanText(prediction.reasonCode) || "llm_predicted";

  if (!canonicalPrediction || predictionLooksRoadOnly) {
    return {
      ...base,
      confidence: Math.min(base.confidence, 0.5),
      needsReview: true,
      reasonCode: predictionLooksRoadOnly ? "road_only" : "invalid_llm_output",
    };
  }

  const existingMatch = matchExistingCluster(
    canonicalPrediction,
    canonicalPrediction,
    canonicalPrediction,
    existingClusters
  );
  const finalPrediction = existingMatch ?? canonicalPrediction;

  if (finalPrediction === base.areaCluster) {
    return {
      rowIndex: input.rowIndex,
      areaCluster: finalPrediction,
      source: existingMatch ? "rule" : base.source,
      confidence: Math.max(base.confidence, confidence),
      needsReview: confidence < HIGH_CONFIDENCE_THRESHOLD,
      reasonCode,
    };
  }

  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return {
      rowIndex: input.rowIndex,
      areaCluster: finalPrediction,
      source: prediction.matchType === "existing" || existingMatch ? "rule" : "llm",
      confidence,
      needsReview: false,
      reasonCode,
    };
  }

  return {
    ...base,
    confidence,
    needsReview: true,
    reasonCode: reasonCode || "low_signal",
    suggestedAreaCluster: finalPrediction,
  };
}

export async function classifyAreaClusters(
  rows: ClassificationInput[],
  options?: {
    fetchImpl?: FetchLike;
    existingClusters?: string[];
    forceLlmForActionableRows?: boolean;
  }
): Promise<{
  results: AreaClusterClassification[];
  metadata: AreaClusterClassificationMetadata;
}> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const existingClusters = buildExistingClusterCatalog(options?.existingClusters);
  const forceLlmForActionableRows = options?.forceLlmForActionableRows === true;
  const baseResults = rows.map((row) => buildDefaultClassification(row, existingClusters));
  const rowsNeedingLlm = rows.filter((row, index) =>
    shouldCallLlm(row, baseResults[index], existingClusters, forceLlmForActionableRows)
  );
  const metadata: AreaClusterClassificationMetadata = {
    totalRows: rows.length,
    llmRows: rowsNeedingLlm.length,
    usedOpenRouter: false,
    attemptedOpenRouter: rowsNeedingLlm.length > 0,
    model: rowsNeedingLlm.length > 0 ? resolveOpenRouterModel() : null,
    modelSource: rowsNeedingLlm.length > 0 ? resolveOpenRouterModelSource() : null,
  };

  debugAreaClustering("classification_summary", {
    totalRows: rows.length,
    existingClusters: existingClusters.length,
    matchedExisting: baseResults.filter((result) => result.reasonCode === "matched_existing_cluster").length,
    lowInformation: baseResults.filter((result) => result.reasonCode === "low_information_address").length,
    llmRows: rowsNeedingLlm.length,
    llmRowIndexes: rowsNeedingLlm.map((row) => row.rowIndex),
    forceLlmForActionableRows,
    model: metadata.model,
    modelSource: metadata.modelSource,
  });

  if (rowsNeedingLlm.length === 0) {
    return { results: baseResults, metadata };
  }

  let predictions = new Map<number, OpenRouterPrediction>();
  try {
    const response = await requestOpenRouterPredictions(rowsNeedingLlm, existingClusters, fetchImpl);
    predictions = new Map(response.map((item) => [item.rowIndex, item]));
    metadata.usedOpenRouter = true;
  } catch {
    debugAreaClustering("openrouter_unavailable", {
      rows: rowsNeedingLlm.length,
    });
    const llmIndexes = new Set(rowsNeedingLlm.map((row) => row.rowIndex));
    return {
      results: baseResults.map((result) =>
        llmIndexes.has(result.rowIndex)
          ? {
              ...result,
              needsReview: true,
              reasonCode:
                result.reasonCode === "fallback_cluster" ? "fallback_cluster" : "llm_unavailable",
            }
          : result
      ),
      metadata,
    };
  }

  return {
    results: rows.map((row, index) =>
      mergePrediction(row, baseResults[index], predictions.get(row.rowIndex), existingClusters)
    ),
    metadata,
  };
}
