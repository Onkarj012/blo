export const voterStatuses = [
  "pending",
  "done",
  "locked",
  "revisit",
  "wrong_address",
] as const;

export const statusFilters = ["all", "pending", "done", "revisit"] as const;

export type VoterStatus = (typeof voterStatuses)[number];
export type StatusFilter = (typeof statusFilters)[number];
export type GeocodeStatus = "resolved" | "approximate" | "failed";

export type StoredVoter = {
  id: number;
  import_batch_id: number | null;
  name: string;
  phone_number: string;
  address_raw: string;
  display_address: string;
  area_cluster: string;
  age: string;
  gender: string;
  relative_name: string;
  relative_type: string;
  epic_number: string;
  assembly_constituency: string;
  district: string;
  status: VoterStatus;
  status_updated_at: string | null;
  status_note: string;
  lat: number | null;
  lng: number | null;
  geocode_status: GeocodeStatus;
  geocode_confidence: number;
  created_at: string;
  updated_at: string;
};

export type NearbyVoter = StoredVoter & {
  distance_meters: number | null;
  queue_selected: boolean;
};

export type DashboardStats = {
  total: number;
  pending: number;
  done: number;
  revisit: number;
  locked: number;
  wrongAddress: number;
  importBatches: number;
  latestImportAt: string | null;
};

export type ImportBatchSummary = {
  id: number;
  source_name: string;
  row_count: number;
  imported_at: string;
};

export type ImportResult = {
  batchId: number;
  sourceName: string;
  rowsRead: number;
  inserted: number;
  updated: number;
  geocoded: number;
  approximate: number;
  failedGeocodes: number;
};

export type GeocodeLookup = {
  lat: number | null;
  lng: number | null;
  geocode_status: GeocodeStatus;
  geocode_confidence: number;
  provider: string;
};

export type CsvVoterRow = {
  name?: string;
  phone_number?: string;
  address?: string;
  age?: string;
  gender?: string;
  relative_name?: string;
  relative_type?: string;
  epic_number?: string;
  assembly_constituency?: string;
  district?: string;
};

