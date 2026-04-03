"use client";

import { useState } from "react";

type ImportResponse = {
  ok: boolean;
  result: {
    sourceName: string;
    rowsRead: number;
    inserted: number;
    updated: number;
    geocoded: number;
    approximate: number;
    failedGeocodes: number;
  };
};

export function ImportPanel() {
  const [message, setMessage] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setIsUploading(true);
    setMessage("");
    try {
      const response = await fetch("/api/import-csv", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as ImportResponse | { error?: string };
      if (!response.ok || !("ok" in payload)) {
        const errorMessage = "error" in payload ? payload.error : undefined;
        throw new Error(errorMessage ?? "Import failed.");
      }
      setMessage(
        `Imported ${payload.result.rowsRead} rows from ${payload.result.sourceName}. ` +
          `${payload.result.inserted} new, ${payload.result.updated} updated.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="glass-card rounded-[28px] p-5">
      <p className="section-label">CSV upload</p>
      <form
        action={handleSubmit}
        className="mt-4 space-y-4 rounded-[22px] border border-dashed border-[var(--line)] bg-white/60 p-4"
      >
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm text-[var(--muted)] file:mr-4 file:rounded-full file:border-0 file:bg-[var(--accent)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        <button
          type="submit"
          disabled={isUploading}
          className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/10 disabled:opacity-60"
        >
          {isUploading ? "Importing..." : "Upload cleaned CSV"}
        </button>
      </form>
      {message ? <p className="mt-4 text-sm text-[var(--muted)]">{message}</p> : null}
    </section>
  );
}
