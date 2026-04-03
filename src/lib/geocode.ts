import type { GeocodeLookup } from "@/lib/types";

type GeocodeOptions = {
  query: string;
  isFallbackQuery?: boolean;
  fetchImpl?: typeof fetch;
};

const GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
const STATIC_CLUSTER_LOOKUPS: Record<string, { lat: number; lng: number }> = {
  "pimple saudagar pune maharashtra india": { lat: 18.5949, lng: 73.7897 },
  "kunal icon pimple saudagar pune maharashtra india": { lat: 18.5949, lng: 73.7888 },
  "roseland residency pimple saudagar pune maharashtra india": { lat: 18.5974, lng: 73.7999 },
  "roseland rhythm pimple saudagar pune maharashtra india": { lat: 18.5967, lng: 73.7984 },
  "rose icon pimple saudagar pune maharashtra india": { lat: 18.5972, lng: 73.7991 },
  "govind garden pimple saudagar pune maharashtra india": { lat: 18.5963, lng: 73.8024 },
  "kingston avenue pimple saudagar pune maharashtra india": { lat: 18.5968, lng: 73.8011 },
  "dwarka flora pimple saudagar pune maharashtra india": { lat: 18.5928, lng: 73.7905 },
  "dwarka pimple saudagar pune maharashtra india": { lat: 18.5927, lng: 73.7912 },
  "alcove pimple saudagar pune maharashtra india": { lat: 18.5943, lng: 73.7945 },
  "sai pearl pimple saudagar pune maharashtra india": { lat: 18.5941, lng: 73.7902 },
  "deepmala pimple saudagar pune maharashtra india": { lat: 18.5883, lng: 73.7891 },
  "vishwashanti colony pimple saudagar pune maharashtra india": { lat: 18.5909, lng: 73.7838 },
  "mithila nagari pimple saudagar pune maharashtra india": { lat: 18.5918, lng: 73.7866 },
  "ganeesham pimple saudagar pune maharashtra india": { lat: 18.5943, lng: 73.7898 },
  "planet millennium pimple saudagar pune maharashtra india": { lat: 18.5955, lng: 73.7998 },
  "shubhashree woods pimple saudagar pune maharashtra india": { lat: 18.593, lng: 73.7927 },
  "rajveer palace pimple saudagar pune maharashtra india": { lat: 18.594, lng: 73.7942 },
  "lotus hospital pimple saudagar pune maharashtra india": { lat: 18.5944, lng: 73.7903 },
  "swaraj garden pimple saudagar pune maharashtra india": { lat: 18.5922, lng: 73.7847 },
  "nisarg park pimple saudagar pune maharashtra india": { lat: 18.5905, lng: 73.7861 },
  "kate wasti pimple saudagar pune maharashtra india": { lat: 18.5889, lng: 73.7828 },
  "keshav nagar pimple saudagar pune maharashtra india": { lat: 18.5895, lng: 73.7814 },
  "samrat nagar pimple saudagar pune maharashtra india": { lat: 18.592, lng: 73.7839 },
};
const CORE_LOOKUP = { lat: 18.5949, lng: 73.7897 };

function normalizeQueryKey(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export async function geocodeQuery({
  query,
  isFallbackQuery = false,
  fetchImpl = fetch,
}: GeocodeOptions): Promise<GeocodeLookup> {
  const staticLookup = STATIC_CLUSTER_LOOKUPS[normalizeQueryKey(query)];
  if (staticLookup) {
    return {
      lat: staticLookup.lat,
      lng: staticLookup.lng,
      geocode_status: "approximate",
      geocode_confidence: isFallbackQuery ? 0.48 : 0.66,
      provider: "cluster-map",
    };
  }

  if (process.env.ENABLE_REMOTE_GEOCODING !== "1") {
    return {
      lat: CORE_LOOKUP.lat,
      lng: CORE_LOOKUP.lng,
      geocode_status: "approximate",
      geocode_confidence: isFallbackQuery ? 0.38 : 0.42,
      provider: "cluster-map",
    };
  }

  const url = new URL(GEOCODER_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  try {
    const response = await fetchImpl(url, {
      headers: {
        "accept-language": "en",
        "user-agent": "blo-photo-voter-finder/0.1",
      },
      next: { revalidate: 60 * 60 * 24 * 30 },
    });

    if (!response.ok) {
      return failedLookup();
    }

    const payload = (await response.json()) as Array<{ lat: string; lon: string }>;
    const best = payload[0];
    if (!best) {
      return failedLookup();
    }

    return {
      lat: Number(best.lat),
      lng: Number(best.lon),
      geocode_status: isFallbackQuery ? "approximate" : "resolved",
      geocode_confidence: isFallbackQuery ? 0.48 : 0.78,
      provider: "nominatim",
    };
  } catch {
    return failedLookup();
  }
}

export function failedLookup(): GeocodeLookup {
  return {
    lat: null,
    lng: null,
    geocode_status: "failed",
    geocode_confidence: 0,
    provider: "nominatim",
  };
}

export async function waitForPoliteGeocodeDelay(ms = 700): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
