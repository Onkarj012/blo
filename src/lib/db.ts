import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type {
  DashboardStats,
  GeocodeLookup,
  ImportBatchSummary,
  NearbyVoter,
  StatusFilter,
  StoredVoter,
  VoterStatus,
} from "@/lib/types";

const DATABASE_PATH = path.join(process.cwd(), "data", "app", "voters.sqlite");

function ensureDatabaseDirectory(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function applyPragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      phone_number TEXT NOT NULL DEFAULT '',
      address_raw TEXT NOT NULL,
      display_address TEXT NOT NULL,
      area_cluster TEXT NOT NULL,
      age TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      relative_name TEXT NOT NULL DEFAULT '',
      relative_type TEXT NOT NULL DEFAULT '',
      epic_number TEXT NOT NULL DEFAULT '',
      assembly_constituency TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      status_updated_at TEXT,
      status_note TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL,
      geocode_status TEXT NOT NULL DEFAULT 'failed',
      geocode_confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS voters_unique_epic
      ON voters(epic_number)
      WHERE epic_number <> '';

    CREATE INDEX IF NOT EXISTS voters_status_idx ON voters(status);
    CREATE INDEX IF NOT EXISTS voters_area_cluster_idx ON voters(area_cluster);

    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY,
      lat REAL,
      lng REAL,
      geocode_status TEXT NOT NULL,
      geocode_confidence REAL NOT NULL DEFAULT 0,
      provider TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS today_queue_entries (
      device_id TEXT NOT NULL,
      voter_id INTEGER NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      PRIMARY KEY(device_id, voter_id)
    );
  `);
}

export function createDatabase(dbPath = DATABASE_PATH): Database.Database {
  ensureDatabaseDirectory(dbPath);
  const db = new Database(dbPath);
  applyPragmas(db);
  ensureSchema(db);
  return db;
}

declare global {
  var __bloPhotoDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!globalThis.__bloPhotoDb) {
    globalThis.__bloPhotoDb = createDatabase();
  }
  return globalThis.__bloPhotoDb;
}

function parseStoredVoter(row: Database.RunResult | StoredVoter | undefined): StoredVoter | null {
  if (!row) {
    return null;
  }
  return row as StoredVoter;
}

export function createImportBatch(sourceName: string, importedAt: string, db = getDb()): number {
  const result = db
    .prepare(
      `INSERT INTO import_batches (source_name, row_count, imported_at)
       VALUES (?, 0, ?)`
    )
    .run(sourceName, importedAt);
  return Number(result.lastInsertRowid);
}

export function finalizeImportBatch(batchId: number, rowCount: number, db = getDb()): void {
  db.prepare("UPDATE import_batches SET row_count = ? WHERE id = ?").run(rowCount, batchId);
}

export function getGeocodeCache(query: string, db = getDb()): GeocodeLookup | null {
  const row = db
    .prepare(
      `SELECT lat, lng, geocode_status, geocode_confidence, provider
       FROM geocode_cache
       WHERE query = ?`
    )
    .get(query) as GeocodeLookup | undefined;
  return row ?? null;
}

export function setGeocodeCache(
  query: string,
  lookup: GeocodeLookup,
  updatedAt: string,
  db = getDb()
): void {
  db.prepare(
    `INSERT INTO geocode_cache (
      query, lat, lng, geocode_status, geocode_confidence, provider, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(query) DO UPDATE SET
      lat = excluded.lat,
      lng = excluded.lng,
      geocode_status = excluded.geocode_status,
      geocode_confidence = excluded.geocode_confidence,
      provider = excluded.provider,
      updated_at = excluded.updated_at`
  ).run(
    query,
    lookup.lat,
    lookup.lng,
    lookup.geocode_status,
    lookup.geocode_confidence,
    lookup.provider,
    updatedAt
  );
}

type UpsertVoterInput = Omit<
  StoredVoter,
  "id" | "status" | "status_updated_at" | "status_note" | "created_at" | "updated_at"
> & {
  importedAt: string;
};

export function upsertVoter(input: UpsertVoterInput, db = getDb()): "inserted" | "updated" {
  const existing =
    input.epic_number.trim() !== ""
      ? parseStoredVoter(
          db
            .prepare("SELECT * FROM voters WHERE epic_number = ?")
            .get(input.epic_number.trim()) as StoredVoter | undefined
        )
      : null;

  if (existing) {
    db.prepare(
      `UPDATE voters
       SET import_batch_id = ?,
           name = ?,
           phone_number = ?,
           address_raw = ?,
           display_address = ?,
           area_cluster = ?,
           age = ?,
           gender = ?,
           relative_name = ?,
           relative_type = ?,
           epic_number = ?,
           assembly_constituency = ?,
           district = ?,
           lat = ?,
           lng = ?,
           geocode_status = ?,
           geocode_confidence = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      input.import_batch_id,
      input.name,
      input.phone_number,
      input.address_raw,
      input.display_address,
      input.area_cluster,
      input.age,
      input.gender,
      input.relative_name,
      input.relative_type,
      input.epic_number,
      input.assembly_constituency,
      input.district,
      input.lat,
      input.lng,
      input.geocode_status,
      input.geocode_confidence,
      input.importedAt,
      existing.id
    );
    return "updated";
  }

  db.prepare(
    `INSERT INTO voters (
      import_batch_id,
      name,
      phone_number,
      address_raw,
      display_address,
      area_cluster,
      age,
      gender,
      relative_name,
      relative_type,
      epic_number,
      assembly_constituency,
      district,
      status,
      status_updated_at,
      status_note,
      lat,
      lng,
      geocode_status,
      geocode_confidence,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', ?, ?, ?, ?, ?, ?)`
  ).run(
    input.import_batch_id,
    input.name,
    input.phone_number,
    input.address_raw,
    input.display_address,
    input.area_cluster,
    input.age,
    input.gender,
    input.relative_name,
    input.relative_type,
    input.epic_number,
    input.assembly_constituency,
    input.district,
    input.lat,
    input.lng,
    input.geocode_status,
    input.geocode_confidence,
    input.importedAt,
    input.importedAt
  );
  return "inserted";
}

export function getDashboardStats(db = getDb()): DashboardStats {
  const totals = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status = 'revisit' THEN 1 ELSE 0 END) AS revisit,
        SUM(CASE WHEN status = 'locked' THEN 1 ELSE 0 END) AS locked,
        SUM(CASE WHEN status = 'wrong_address' THEN 1 ELSE 0 END) AS wrongAddress
      FROM voters`
    )
    .get() as Record<string, number | null>;

  const batchInfo = db
    .prepare(
      `SELECT COUNT(*) AS importBatches, MAX(imported_at) AS latestImportAt
       FROM import_batches`
    )
    .get() as { importBatches: number; latestImportAt: string | null };

  return {
    total: Number(totals.total ?? 0),
    pending: Number(totals.pending ?? 0),
    done: Number(totals.done ?? 0),
    revisit: Number(totals.revisit ?? 0),
    locked: Number(totals.locked ?? 0),
    wrongAddress: Number(totals.wrongAddress ?? 0),
    importBatches: Number(batchInfo.importBatches ?? 0),
    latestImportAt: batchInfo.latestImportAt ?? null,
  };
}

export function listImportBatches(limit = 6, db = getDb()): ImportBatchSummary[] {
  return db
    .prepare(
      `SELECT id, source_name, row_count, imported_at
       FROM import_batches
       ORDER BY imported_at DESC
       LIMIT ?`
    )
    .all(limit) as ImportBatchSummary[];
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(
  originLat: number,
  originLng: number,
  targetLat: number,
  targetLng: number
): number {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(targetLat - originLat);
  const dLng = toRadians(targetLng - originLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(originLat)) *
      Math.cos(toRadians(targetLat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function buildStatusWhereClause(statusFilter: StatusFilter): { clause: string; params: unknown[] } {
  if (statusFilter === "all") {
    return { clause: "", params: [] };
  }
  return {
    clause: "WHERE status = ?",
    params: [statusFilter],
  };
}

export function listNearbyVoters(
  {
    lat,
    lng,
    statusFilter,
    radiusMeters,
    limit,
    deviceId,
  }: {
    lat: number | null;
    lng: number | null;
    statusFilter: StatusFilter;
    radiusMeters: number;
    limit: number;
    deviceId?: string;
  },
  db = getDb()
): { items: NearbyVoter[]; counts: Record<StatusFilter, number> } {
  const where = buildStatusWhereClause(statusFilter);
  const rows = db
    .prepare(
      `SELECT * FROM voters
       ${where.clause}
       ORDER BY area_cluster, name`
    )
    .all(...where.params) as StoredVoter[];

  const queueIds = deviceId
    ? new Set<number>(
        (
          db
            .prepare(
              `SELECT voter_id
               FROM today_queue_entries
               WHERE device_id = ?`
            )
            .all(deviceId) as Array<{ voter_id: number }>
        ).map((row) => row.voter_id)
      )
    : new Set<number>();

  const mapped = rows.map<NearbyVoter>((row) => {
    const hasGeocode = lat !== null && lng !== null && row.lat !== null && row.lng !== null;
    const distance = hasGeocode
      ? haversineDistanceMeters(lat, lng, row.lat as number, row.lng as number)
      : null;
    return {
      ...row,
      distance_meters: distance,
      queue_selected: queueIds.has(row.id),
    };
  });

  const precise = mapped
    .filter((row) => row.distance_meters !== null && row.distance_meters <= radiusMeters)
    .sort((left, right) => (left.distance_meters as number) - (right.distance_meters as number));
  const approximate = mapped
    .filter((row) => row.distance_meters === null || row.distance_meters > radiusMeters)
    .sort((left, right) =>
      left.area_cluster.localeCompare(right.area_cluster) || left.name.localeCompare(right.name)
    );

  const countsRaw = db
    .prepare(
      `SELECT
        COUNT(*) AS all_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count,
        SUM(CASE WHEN status = 'revisit' THEN 1 ELSE 0 END) AS revisit_count
       FROM voters`
    )
    .get() as Record<string, number | null>;

  return {
    items: [...precise, ...approximate].slice(0, limit),
    counts: {
      all: Number(countsRaw.all_count ?? 0),
      pending: Number(countsRaw.pending_count ?? 0),
      done: Number(countsRaw.done_count ?? 0),
      revisit: Number(countsRaw.revisit_count ?? 0),
    },
  };
}

export function updateVoterStatus(
  id: number,
  status: VoterStatus,
  note: string,
  updatedAt: string,
  db = getDb()
): StoredVoter | null {
  db.prepare(
    `UPDATE voters
     SET status = ?, status_note = ?, status_updated_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(status, note, updatedAt, updatedAt, id);

  return (
    db.prepare("SELECT * FROM voters WHERE id = ?").get(id) as StoredVoter | undefined
  ) ?? null;
}

export function replaceTodayQueue(
  deviceId: string,
  voterIds: number[],
  addedAt: string,
  db = getDb()
): void {
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM today_queue_entries WHERE device_id = ?").run(deviceId);
    const insert = db.prepare(
      `INSERT INTO today_queue_entries (device_id, voter_id, added_at)
       VALUES (?, ?, ?)`
    );
    for (const voterId of voterIds) {
      insert.run(deviceId, voterId, addedAt);
    }
  });
  transaction();
}

export function getTodayQueue(deviceId: string, db = getDb()): StoredVoter[] {
  return db
    .prepare(
      `SELECT voters.*
       FROM today_queue_entries
       INNER JOIN voters ON voters.id = today_queue_entries.voter_id
       WHERE today_queue_entries.device_id = ?
       ORDER BY today_queue_entries.added_at ASC`
    )
    .all(deviceId) as StoredVoter[];
}
