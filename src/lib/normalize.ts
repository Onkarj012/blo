import { createHash } from "crypto";

export const KNOWN_CLUSTER_PATTERNS: Array<{ label: string; matchers: RegExp[] }> = [
  {
    label: "Roseland Residency",
    matchers: [/roseland\s*residency|rose\s*land\s*res|reseland\s*residency|rojland/i],
  },
  { label: "Roseland Rhythm", matchers: [/roseland\s*rhythm|rhyth?em\s*society/i] },
  { label: "Rose Icon", matchers: [/rose\s*icon/i] },
  { label: "Govind Garden", matchers: [/govind\s*garden/i] },
  { label: "Kingston Avenue", matchers: [/king\s*ston\s*avenue|kingston\s*avenue/i] },
  { label: "Dwarka Flora", matchers: [/dwarka\s*flora/i] },
  { label: "Dwarka", matchers: [/dwarka/i] },
  { label: "Alcove", matchers: [/alcove/i] },
  { label: "Sai Pearl", matchers: [/sai\s*pearl/i] },
  { label: "Deepmala", matchers: [/deepmala/i] },
  { label: "Vishwashanti Colony", matchers: [/vishw?a?shanti/i] },
  { label: "Mithila Nagari", matchers: [/mithila/i] },
  { label: "Ganeesham", matchers: [/ganeesham/i] },
  { label: "Planet Millennium", matchers: [/planet\s*millen+ium|pplanet\s*millen+ium/i] },
  { label: "Shubhashree Woods", matchers: [/shubhashree\s*woods/i] },
  { label: "Rajveer Palace", matchers: [/rajveer\s*palace/i] },
  { label: "Lotus Hospital", matchers: [/lotus\s*hospital/i] },
  { label: "Swaraj Garden", matchers: [/swaraj\s*garden/i] },
  { label: "Nisarg Park", matchers: [/nisarg\s*park/i] },
  { label: "Kate Wasti", matchers: [/kate\s*wasti|kate\s*vasti/i] },
  { label: "Keshav Nagar", matchers: [/keshav\s*nagar/i] },
  { label: "Samrat Nagar", matchers: [/samrat\s*nagar/i] },
  { label: "Kunal Icon", matchers: [/kunal\s*icon/i] },
  { label: "Lakshadeep Palace", matchers: [/lakshadeep\s*palace/i] },
  { label: "Sai Nagar", matchers: [/sai\s*nagar/i] },
  { label: "Shiv Nagar", matchers: [/shiv\s*nagar/i] },
  { label: "Ganesh Nagar", matchers: [/ganesh\s*nagar/i] },
  { label: "Green Park", matchers: [/green\s*park/i] },
  { label: "Garden Society", matchers: [/garden\s*society/i] },
];

const FLAT_PREFIX =
  /\b(flat|flt|flats|bldg|building|wing|floor|house|row|society|phase|plot|survey|sr|sn|no|nr|opp)\b/gi;

const ROAD_WORDS = new Set([
  "road",
  "rd",
  "lane",
  "ln",
  "street",
  "st",
  "path",
  "marg",
  "chowk",
  "near",
  "opp",
  "opposite",
  "behind",
]);

const GENERIC_LOCALITY_WORDS = new Set([
  "pimple",
  "saudagar",
  "pune",
  "maharashtra",
  "india",
  "haveli",
  "colony",
  "nagar",
  "wadi",
  "gaon",
  "main",
  "west",
  "east",
  "north",
  "south",
  "core",
]);

const UNIT_ONLY_WORDS = new Set([
  "flat",
  "flt",
  "floor",
  "wing",
  "block",
  "room",
  "unit",
  "shop",
  "office",
  "door",
  "plot",
  "house",
  "building",
  "bldg",
  "society",
  "phase",
  "no",
  "number",
]);

const GENERIC_CLUSTER_WORDS = new Set([
  "residency",
  "residencies",
  "apartment",
  "apartments",
  "tower",
  "complex",
  "society",
  "building",
  "heights",
  "wing",
  "block",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanSegment(value: string): string {
  return normalizeWhitespace(value.replace(/[|"'`~]+/g, " ").replace(/\s*-\s*/g, "-"));
}

function simplify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function stripLeadingUnitFragments(value: string): string {
  let next = cleanText(value);

  next = next.replace(
    /^(?:(?:flat|flat no|flat number|flt|wing|block|shop|office|room|unit|door|plot|house|row|building|bldg|floor|no|number)\s+)/i,
    ""
  );

  for (let i = 0; i < 4; i++) {
    const updated = next
      .replace(/^(?:[a-z]{0,3}-?\d+[a-z0-9/-]*|\d+[a-z0-9/-]*)(?:\s+|$)/i, "")
      .replace(/^(?:[a-z]{1,2})\s+(?:\d+[a-z0-9/-]*)(?:\s+|$)/i, "");

    if (updated === next) {
      break;
    }
    next = cleanText(updated);
  }

  return next;
}

function toAsciiDisplayText(value: string): string {
  return cleanText(
    value
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]+/g, " ")
  );
}

function isUsefulSegment(value: string): boolean {
  if (!value) {
    return false;
  }
  const tokens = value.split(" ").filter(Boolean);
  const alphaTokens = tokens.filter((token) => /[a-z]/i.test(token));
  if (alphaTokens.length === 0) {
    return false;
  }
  const averageLength =
    alphaTokens.reduce((sum, token) => sum + token.length, 0) / alphaTokens.length;
  return averageLength >= 2.4;
}

export function looksLikeOcrNoise(value: string): boolean {
  const tokens = value.split(" ").filter(Boolean);
  if (tokens.length <= 8) {
    return false;
  }
  const localityMentions = tokens.filter((token) =>
    /pimple|saudagar|pune|road|lane|society|hospital|palace|park|avenue|residency|colony|nagar|icon|garden/i.test(
      token
    )
  ).length;
  return localityMentions <= 1;
}

export function buildDisplayAddress(addressRaw: string): string {
  const cleaned = normalizeWhitespace(addressRaw);
  if (!cleaned) {
    return "Pimple Saudagar";
  }

  const uniqueSegments: string[] = [];
  for (const segment of cleaned.split(",")) {
    const candidate = cleanSegment(segment);
    if (!isUsefulSegment(candidate)) {
      continue;
    }
    if (looksLikeOcrNoise(candidate)) {
      continue;
    }
    if (uniqueSegments.some((existing) => simplify(existing) === simplify(candidate))) {
      continue;
    }
    uniqueSegments.push(candidate);
    if (uniqueSegments.length === 2) {
      break;
    }
  }

  return uniqueSegments.length > 0 ? uniqueSegments.join(", ") : cleaned;
}

function fallbackAreaCluster(address: string): string {
  const firstSegment = cleanSegment(address.split(",")[0] ?? address);
  const withoutPrefix = normalizeWhitespace(firstSegment.replace(FLAT_PREFIX, " "));
  const stripped = withoutPrefix
    .replace(/\b\d+[a-z/-]*\b/gi, " ")
    .replace(/\bpimple\b|\bsaudagar\b|\bpune\b|\bhaveli\b|\bmulshi\b|\bchinchwad\b/gi, " ");
  const tokens = stripped
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  if (tokens.length === 0) {
    return "Pimple Saudagar Core";
  }

  return tokens.slice(0, 3).join(" ");
}

export function findKnownClusterMatch(addressRaw: string): string | null {
  const address = buildDisplayAddress(addressRaw);
  for (const pattern of KNOWN_CLUSTER_PATTERNS) {
    if (pattern.matchers.some((matcher) => matcher.test(address))) {
      return pattern.label;
    }
  }
  return null;
}

export function detectAreaCluster(addressRaw: string): string {
  return findKnownClusterMatch(addressRaw) ?? fallbackAreaCluster(buildDisplayAddress(addressRaw));
}

export function buildGeocodeQuery(areaCluster: string): string {
  if (
    !areaCluster ||
    areaCluster === "Pimple Saudagar Core" ||
    cleanText(areaCluster).startsWith("Uncertain:")
  ) {
    return "Pimple Saudagar, Pune, Maharashtra, India";
  }
  return `${areaCluster}, Pimple Saudagar, Pune, Maharashtra, India`;
}

export function cleanText(value: string | null | undefined): string {
  return normalizeWhitespace(String(value ?? ""));
}

export function toSafeClusterDisplayText(value: string | null | undefined): string {
  return toAsciiDisplayText(cleanText(value));
}

export function canonicalizeAreaClusterLabel(label: string | null | undefined): string | null {
  const cleaned = stripLeadingUnitFragments(
    cleanText(label)
    .replace(/^(society|apartment|apartments|building|bldg|tower)\s+/i, "")
    .replace(/\s+(society|apartment|apartments)$/i, "")
    .replace(/[().]/g, " ")
  );

  if (!cleaned) {
    return null;
  }

  const known = findKnownClusterMatch(cleaned);
  if (known) {
    return known;
  }

  const simplified = simplify(cleaned);
  if (!simplified) {
    return null;
  }

  const tokens = simplified.split(" ").filter(Boolean);
  const meaningfulTokens = tokens.filter(
    (token) => !GENERIC_LOCALITY_WORDS.has(token) && !ROAD_WORDS.has(token)
  );

  if (meaningfulTokens.length === 0) {
    return null;
  }

  if (meaningfulTokens.length === 1 && GENERIC_CLUSTER_WORDS.has(meaningfulTokens[0])) {
    return null;
  }

  return toTitleCase(meaningfulTokens.slice(0, 4).join(" "));
}

export function isRoadOnlyClusterLabel(label: string | null | undefined): boolean {
  const simplified = simplify(cleanText(label));
  if (!simplified) {
    return true;
  }

  const tokens = simplified.split(" ").filter(Boolean);
  const nonGenericTokens = tokens.filter((token) => !GENERIC_LOCALITY_WORDS.has(token));

  return nonGenericTokens.length > 0 && nonGenericTokens.every((token) => ROAD_WORDS.has(token));
}

export function isLowInformationAddress(addressRaw: string | null | undefined): boolean {
  const cleaned = simplify(cleanText(addressRaw));
  if (!cleaned) {
    return true;
  }

  if (findKnownClusterMatch(cleaned)) {
    return false;
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  const meaningfulTokens = tokens.filter(
    (token) =>
      !GENERIC_LOCALITY_WORDS.has(token) &&
      !ROAD_WORDS.has(token) &&
      !UNIT_ONLY_WORDS.has(token)
  );

  if (meaningfulTokens.length === 0) {
    return true;
  }

  const descriptiveTokens = meaningfulTokens.filter(
    (token) => token.length >= 4 && !/^[a-z]?\d+[a-z]?$/i.test(token)
  );

  if (descriptiveTokens.length > 0) {
    return false;
  }

  return meaningfulTokens.every((token) => /^[a-z]?\d+[a-z]?$/i.test(token) || token.length <= 3);
}

function countDistinctKnownMatches(addressRaw: string): number {
  const address = buildDisplayAddress(addressRaw);
  const matches = new Set<string>();

  for (const pattern of KNOWN_CLUSTER_PATTERNS) {
    if (pattern.matchers.some((matcher) => matcher.test(address))) {
      matches.add(pattern.label);
    }
  }

  return matches.size;
}

export function detectAreaClusterAmbiguity(input: {
  addressRaw: string;
  displayAddress?: string;
  detectedCluster?: string;
}): { shouldUseLlm: boolean; reasonCode?: string } {
  const addressRaw = cleanText(input.addressRaw);
  const displayAddress = cleanText(input.displayAddress || buildDisplayAddress(addressRaw));
  const detectedCluster = cleanText(input.detectedCluster || detectAreaCluster(addressRaw));

  if (!addressRaw) {
    return { shouldUseLlm: false, reasonCode: "missing_address" };
  }

  const knownMatches = countDistinctKnownMatches(addressRaw);
  if (knownMatches > 1) {
    return { shouldUseLlm: true, reasonCode: "conflicting_signals" };
  }

  const knownMatch = findKnownClusterMatch(addressRaw);

  const normalizedAddress = simplify(displayAddress);
  const tokens = normalizedAddress.split(" ").filter(Boolean);
  const roadMentions = tokens.filter((token) => ROAD_WORDS.has(token)).length;
  const localityMentions = tokens.filter((token) => GENERIC_LOCALITY_WORDS.has(token)).length;

  if (looksLikeOcrNoise(displayAddress)) {
    return { shouldUseLlm: true, reasonCode: "ocr_noisy" };
  }

  if (detectedCluster === "Pimple Saudagar Core") {
    return { shouldUseLlm: true, reasonCode: "fallback_cluster" };
  }

  if (isRoadOnlyClusterLabel(detectedCluster)) {
    return { shouldUseLlm: true, reasonCode: "road_only" };
  }

  if (knownMatch && roadMentions >= 1) {
    const leftoverTokens = normalizedAddress
      .replace(simplify(knownMatch), " ")
      .split(" ")
      .filter(
        (token) =>
          token.length >= 4 &&
          !GENERIC_LOCALITY_WORDS.has(token) &&
          !ROAD_WORDS.has(token) &&
          !["flat", "wing", "floor", "building", "society", "house"].includes(token)
      );

    if (leftoverTokens.length >= 2) {
      return { shouldUseLlm: true, reasonCode: "conflicting_signals" };
    }
  }

  if (roadMentions >= 1 && localityMentions >= 1 && !knownMatch) {
    return { shouldUseLlm: true, reasonCode: "road_heavy" };
  }

  if (displayAddress.length >= 48 && roadMentions >= 1 && !knownMatch) {
    return { shouldUseLlm: true, reasonCode: "conflicting_signals" };
  }

  return { shouldUseLlm: false };
}

// Determine address quality
export function determineAddressQuality(
  addressRaw: string,
  areaCluster: string
): "actionable" | "vague" | "missing" {
  const trimmed = addressRaw?.trim();

  if (!trimmed || trimmed.length < 5) {
    return "missing";
  }

  const hasLocality =
    /pimple|saudagar|nagar|colony|society|apartment|residency|garden|park|road|lane/i.test(
      trimmed
    );
  const hasSociety = KNOWN_CLUSTER_PATTERNS.some(
    (pattern) =>
      pattern.label !== "Pimple Saudagar Core" &&
      pattern.matchers.some((matcher) => matcher.test(trimmed))
  );

  if (hasSociety || (hasLocality && trimmed.length > 15)) {
    return "actionable";
  }

  if (hasLocality || trimmed.length > 10 || areaCluster !== "Pimple Saudagar Core") {
    return "vague";
  }

  return "missing";
}

// Build row fingerprint for matching
export function buildRowFingerprint(data: {
  name: string;
  relativeName?: string | null;
  age: string;
  gender: string;
  displayAddress: string;
  assemblyConstituency: string;
  district: string;
}): string {
  const normalized = [
    cleanText(data.name).toLowerCase(),
    cleanText(data.relativeName).toLowerCase(),
    cleanText(data.age).toLowerCase(),
    cleanText(data.gender).toLowerCase(),
    cleanText(data.displayAddress).toLowerCase(),
    cleanText(data.assemblyConstituency).toLowerCase(),
    cleanText(data.district).toLowerCase(),
  ].join("|");

  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

// Build search text for full-text search
export function buildSearchText(data: {
  name: string;
  phoneNumber?: string | null;
  displayAddress: string;
  epicNumber?: string | null;
  relativeName?: string | null;
}): string {
  const parts = [
    cleanText(data.name),
    cleanText(data.phoneNumber),
    cleanText(data.displayAddress),
    cleanText(data.epicNumber),
    cleanText(data.relativeName),
  ].filter(Boolean);

  return parts.join(" ").toLowerCase();
}

export function calculateGeocodeConfidence(
  geocodeStatus: "resolved" | "approximate" | "failed",
  addressQuality: "actionable" | "vague" | "missing"
): number {
  if (geocodeStatus === "failed") return 0;
  if (geocodeStatus === "approximate") return 0.5;

  switch (addressQuality) {
    case "actionable":
      return 1.0;
    case "vague":
      return 0.7;
    case "missing":
      return 0.4;
    default:
      return 0.5;
  }
}
