"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SessionPayload } from "@/lib/auth";

interface ImportPageProps {
  user: SessionPayload;
}

interface ImportBatch {
  _id: string;
  sourceName: string;
  rowsRead: number;
  inserted: number;
  updated: number;
  skipped: number;
  importedAt: number;
}

export function ImportPage({ user }: ImportPageProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    result?: {
      batch: ImportBatch;
      summary: {
        rowsRead: number;
        inserted: number;
        updated: number;
        skipped: number;
        geocoded: number;
        approximate: number;
        failedGeocodes: number;
      };
    };
    error?: string;
  } | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [stats, setStats] = useState({ total: 0, batches: 0 });

  const fetchBatches = useCallback(async () => {
    try {
      const response = await fetch("/api/import-batches");
      if (!response.ok) throw new Error("Failed to fetch batches");
      const data = await response.json();
      setBatches(data.batches || []);
      setStats(data.stats || { total: 0, batches: 0 });
    } catch (error) {
      console.error("Error fetching batches:", error);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/import-csv", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      setResult(data);

      if (data.ok) {
        setFile(null);
        fetchBatches();
      }
    } catch (error) {
      setResult({ ok: false, error: "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900">Admin Import</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user.displayName}</span>
              <a
                href="/"
                className="text-sm text-indigo-600 hover:text-indigo-800"
              >
                Back to Field App
              </a>
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/login");
                }}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500">Total Voters</p>
            <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500">Import Batches</p>
            <p className="text-3xl font-bold text-gray-900">{stats.batches}</p>
          </div>
        </div>

        {/* Upload Form */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Upload Voter CSV
          </h2>
          
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select CSV File
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              <p className="mt-2 text-sm text-gray-500">
                CSV must include: name, address, age, gender, relative_name, relative_type, epic_number, assembly_constituency, district
              </p>
            </div>

            <button
              type="submit"
              disabled={!file || uploading}
              className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? "Uploading..." : "Upload and Import"}
            </button>
          </form>

          {/* Result */}
          {result && (
            <div className={`mt-4 p-4 rounded-md ${result.ok ? "bg-green-50" : "bg-red-50"}`}>
              {result.ok ? (
                <div className="space-y-2">
                  <p className="text-green-800 font-medium">Import successful!</p>
                  <div className="text-sm text-green-700 grid grid-cols-3 gap-4">
                    <div>
                      <span className="font-medium">{result.result?.summary.rowsRead}</span> rows read
                    </div>
                    <div>
                      <span className="font-medium">{result.result?.summary.inserted}</span> inserted
                    </div>
                    <div>
                      <span className="font-medium">{result.result?.summary.updated}</span> updated
                    </div>
                    <div>
                      <span className="font-medium">{result.result?.summary.skipped}</span> skipped
                    </div>
                    <div>
                      <span className="font-medium">{result.result?.summary.geocoded}</span> geocoded
                    </div>
                    <div>
                      <span className="font-medium">{result.result?.summary.failedGeocodes}</span> failed geocodes
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-red-800">{result.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Recent Batches */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Recent Import Batches
          </h2>
          
          {batches.length === 0 ? (
            <p className="text-gray-500">No imports yet.</p>
          ) : (
            <div className="space-y-3">
              {batches.map((batch) => (
                <div
                  key={batch._id}
                  className="border border-gray-200 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{batch.sourceName}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(batch.importedAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm font-medium">
                      {batch.rowsRead} rows
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-gray-600 grid grid-cols-4 gap-2">
                    <span>+{batch.inserted} new</span>
                    <span>~{batch.updated} updated</span>
                    <span>{batch.skipped} skipped</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
