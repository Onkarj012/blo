import { createHash } from "crypto";

const CLUSTER_PATTERNS: Array<{ label: string; matchers: RegExp[] }> = [
  { label: "Roseland Residency", matchers: [/roseland\s*residency|rose\s*land\s*res|reseland\s*residency|rojland/i] },
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
  // Additional apartment/society patterns for better extraction
  { label: "Sai Nagar", matchers: [/sai\s*nagar/i] },
  { label: "Shiv Nagar", matchers: [/shiv\s*nagar/i] },
  { label: "Ganesh Nagar", matchers: [/ganesh\s*nagar/i] },
  { label: "Green Park", matchers: [/green\s*park/i] },
  { label: "Garden Society", matchers: [/garden\s*society/i] },
  { label: "Residency", matchers: [/\bresidency\b/i] },
  { label: "Apartment", matchers: [/\bapartment\b|\bapartments\b/i] },
  { label: "Heights", matchers: [/\bheights\b/i] },
  { label: "Tower", matchers: [/\btower\b/i] },
  { label: "Complex", matchers: [/\bcomplex\b/i] },
  { label: "Estate", matchers: [/\bestate\b/i] },
];

const FLAT_PREFIX = /\b(flat|flt|flats|bldg|building|wing|floor|house|row|society|phase|plot|survey|sr|sn|no|nr|opp)\b/gi;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanSegment(value: string): string {
  return normalizeWhitespace(value.replace(/[|"'`~]+/g, " ").replace(/\s*-\s*/g, "-"));
}

function simplify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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

function looksLikeOcrNoise(value: string): boolean {
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

export function detectAreaCluster(addressRaw: string): string {
  const address = buildDisplayAddress(addressRaw);
  for (const pattern of CLUSTER_PATTERNS) {
    if (pattern.matchers.some((matcher) => matcher.test(address))) {
      return pattern.label;
    }
  }
  return fallbackAreaCluster(address);
}

export function buildGeocodeQuery(areaCluster: string): string {
  if (!areaCluster || areaCluster === "Pimple Saudagar Core") {
    return "Pimple Saudagar, Pune, Maharashtra, India";
  }
  return `${areaCluster}, Pimple Saudagar, Pune, Maharashtra, India`;
}

export function cleanText(value: string | null | undefined): string {
  return normalizeWhitespace(String(value ?? ""));
}

// New: Determine address quality
export function determineAddressQuality(
  addressRaw: string,
  areaCluster: string
): "actionable" | "vague" | "missing" {
  const trimmed = addressRaw?.trim();
  
  // Missing: blank or effectively empty
  if (!trimmed || trimmed.length < 5) {
    return "missing";
  }
  
  // Check for meaningful content
  const hasLocality = /pimple|saudagar|nagar|colony|society|apartment|residency|garden|park|road|lane/i.test(trimmed);
  const hasSociety = CLUSTER_PATTERNS.some(p => 
    p.label !== "Pimple Saudagar Core" && 
    p.matchers.some(m => m.test(trimmed))
  );
  
  // Actionable: has society/apartment name or good locality clues
  if (hasSociety || (hasLocality && trimmed.length > 15)) {
    return "actionable";
  }
  
  // Vague: has some locality but not enough detail
  if (hasLocality || trimmed.length > 10) {
    return "vague";
  }
  
  // Missing or too vague
  return "missing";
}

// New: Build row fingerprint for matching
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

// New: Build search text for full-text search
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

// Geocoding confidence calculation
export function calculateGeocodeConfidence(
  geocodeStatus: "resolved" | "approximate" | "failed",
  addressQuality: "actionable" | "vague" | "missing"
): number {
  if (geocodeStatus === "failed") return 0;
  if (geocodeStatus === "approximate") return 0.5;
  
  // resolved
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
