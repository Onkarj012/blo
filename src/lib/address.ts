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
    /pimple|saudagar|pune|road|lane|society|hospital|palace|park|avenue|residency|colony/i.test(
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
