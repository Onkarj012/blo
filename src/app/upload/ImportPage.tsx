"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SessionPayload } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

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
  const [pendingSerialNumbers, setPendingSerialNumbers] = useState("");
  const [syncingPending, setSyncingPending] = useState(false);
  const [pendingSyncResult, setPendingSyncResult] = useState<{
    ok: boolean;
    result?: {
      partNumber: string;
      totalPartRecords: number;
      pendingRequested: number;
      matchedPending: number;
      pending: number;
      done: number;
      updated: number;
      unmatchedSerialNumbers: string[];
    };
    error?: string;
  } | null>(null);

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
    } catch {
      setResult({ ok: false, error: "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  async function handlePendingSync(e: React.FormEvent) {
    e.preventDefault();
    setSyncingPending(true);
    setPendingSyncResult(null);

    try {
      const response = await fetch("/api/part-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partNumber: "355",
          pendingSerialNumbers,
        }),
      });
      const data = await response.json();
      setPendingSyncResult(data);
    } catch {
      setPendingSyncResult({
        ok: false,
        error: "Pending list update failed.",
      });
    } finally {
      setSyncingPending(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <header className="glass-header sticky top-0 z-10 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Admin Import</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-sm text-muted-foreground truncate max-w-[10rem]">
                {user.displayName}
              </span>
              <Link
                href="/"
                className="text-sm text-primary hover:text-primary/80 min-h-11 flex items-center"
              >
                Back to Field App
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 sm:h-8 px-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/login");
                }}
              >
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-6 sm:space-y-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <p className="text-sm text-muted-foreground">Total Voters</p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums">
                {stats.total}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 sm:p-6">
              <p className="text-sm text-muted-foreground">Import Batches</p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums">
                {stats.batches}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Upload Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload Voter CSV</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <Label htmlFor="csv-file" className="mb-2">
                  Select CSV File
                </Label>
                <input
                  id="csv-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:min-h-11 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                />
                <p className="mt-2 text-sm text-muted-foreground break-words">
                  CSV must include: name, address, age, gender, relative_name,
                  relative_type, epic_number, assembly_constituency, district
                </p>
              </div>

              <Button
                type="submit"
                disabled={!file || uploading}
                className="w-full h-11"
              >
                {uploading ? "Uploading..." : "Upload and Import"}
              </Button>
            </form>

            {/* Result */}
            {result && (
              <Alert
                variant={result.ok ? "default" : "destructive"}
                className="mt-4"
              >
                <AlertDescription>
                  {result.ok ? (
                    <div className="space-y-2 text-foreground">
                      <p className="font-medium">Import successful!</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                        <div>
                          <span className="font-medium">
                            {result.result?.summary.rowsRead}
                          </span>{" "}
                          rows read
                        </div>
                        <div>
                          <span className="font-medium">
                            {result.result?.summary.inserted}
                          </span>{" "}
                          inserted
                        </div>
                        <div>
                          <span className="font-medium">
                            {result.result?.summary.updated}
                          </span>{" "}
                          updated
                        </div>
                        <div>
                          <span className="font-medium">
                            {result.result?.summary.skipped}
                          </span>{" "}
                          skipped
                        </div>
                        <div>
                          <span className="font-medium">
                            {result.result?.summary.geocoded}
                          </span>{" "}
                          geocoded
                        </div>
                        <div>
                          <span className="font-medium">
                            {result.result?.summary.failedGeocodes}
                          </span>{" "}
                          failed geocodes
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p>{result.error}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Part pending list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Update pending list — Part 355
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Paste the Part Serial Nos. that are still pending, separated by
              commas. Every other Part 355 record will be marked Done.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handlePendingSync} className="space-y-4">
              <Textarea
                value={pendingSerialNumbers}
                onChange={(e) => setPendingSerialNumbers(e.target.value)}
                placeholder="944,977,1499,921,873,1491,593"
                rows={5}
                className="text-base md:text-sm"
              />
              <Button
                type="submit"
                disabled={syncingPending || !pendingSerialNumbers.trim()}
                className="w-full h-11"
              >
                {syncingPending
                  ? "Updating pending list..."
                  : "Update Pending List"}
              </Button>
            </form>

            {pendingSyncResult && (
              <Alert
                variant={pendingSyncResult.ok ? "default" : "destructive"}
              >
                <AlertDescription>
                  {pendingSyncResult.ok && pendingSyncResult.result ? (
                    <div className="space-y-2 text-foreground">
                      <p className="font-medium">
                        Part 355 pending list updated.
                      </p>
                      <p>
                        {pendingSyncResult.result.pending} pending,{" "}
                        {pendingSyncResult.result.done} done,{" "}
                        {pendingSyncResult.result.updated} status changes.
                      </p>
                      {pendingSyncResult.result.unmatchedSerialNumbers.length >
                        0 && (
                        <p className="break-words">
                          Not found in the imported Part 355 data:{" "}
                          {pendingSyncResult.result.unmatchedSerialNumbers.join(
                            ", "
                          )}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p>{pendingSyncResult.error}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Recent Batches */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Import Batches</CardTitle>
          </CardHeader>
          <CardContent>
            {batches.length === 0 ? (
              <p className="text-muted-foreground">No imports yet.</p>
            ) : (
              <div className="space-y-3">
                {batches.map((batch) => (
                  <div
                    key={batch._id}
                    className="border border-border rounded-lg p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground break-words">
                          {batch.sourceName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(batch.importedAt).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {batch.rowsRead} rows
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-1">
                      <span>+{batch.inserted} new</span>
                      <span>~{batch.updated} updated</span>
                      <span>{batch.skipped} skipped</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
