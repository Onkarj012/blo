import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "csv-parse/sync";

import {
  buildClusterAuditRows,
  CLUSTER_AUDIT_COLUMNS,
  type ClusterAuditInputRow,
  type ClusterAuditRow,
} from "@/lib/cluster-audit";

const DEFAULT_INPUT = "data/output/merged/ecinet_1_1530_improved_merged.csv";
const DEFAULT_OUTPUT = "data/output/audit/cluster_audit.csv";
const DEFAULT_SUMMARY_OUTPUT = "data/output/audit/cluster_summary.csv";

function readArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return fallback;
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function writeCsv<T extends Record<string, string>>(path: string, columns: readonly string[], rows: T[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    columns.join(","),
    ...rows.map((row) =>
      columns.map((column) => csvEscape(String(row[column] ?? ""))).join(",")
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
}

function buildClusterSummaryRows(rows: ClusterAuditRow[]): Array<Record<string, string>> {
  const byCluster = new Map<string, ClusterAuditRow[]>();
  for (const row of rows) {
    const clusterRows = byCluster.get(row.route_cluster) ?? [];
    clusterRows.push(row);
    byCluster.set(row.route_cluster, clusterRows);
  }

  return Array.from(byCluster.entries())
    .map(([cluster, clusterRows]) => {
      const ready = clusterRows.filter((row) => row.cluster_review_status === "ready").length;
      const review = clusterRows.filter((row) => row.cluster_review_status === "review").length;
      const manual = clusterRows.filter((row) => row.cluster_review_status === "manual_lookup").length;
      const sampleAddresses = Array.from(
        new Set(clusterRows.map((row) => row.display_address).filter(Boolean))
      ).slice(0, 3);

      return {
        route_cluster: cluster,
        total: String(clusterRows.length),
        ready: String(ready),
        review: String(review),
        manual_lookup: String(manual),
        needs_attention: review + manual > 0 ? "yes" : "no",
        sample_addresses: sampleAddresses.join(" | "),
      };
    })
    .sort((left, right) => Number(right.total) - Number(left.total));
}

function main() {
  const inputPath = readArg("input", DEFAULT_INPUT);
  const outputPath = readArg("output", DEFAULT_OUTPUT);
  const summaryOutputPath = readArg("summary-output", DEFAULT_SUMMARY_OUTPUT);
  const content = readFileSync(inputPath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as ClusterAuditInputRow[];
  const rows = buildClusterAuditRows(records);
  const summaryRows = buildClusterSummaryRows(rows);

  writeCsv(outputPath, CLUSTER_AUDIT_COLUMNS, rows);
  writeCsv(
    summaryOutputPath,
    [
      "route_cluster",
      "total",
      "ready",
      "review",
      "manual_lookup",
      "needs_attention",
      "sample_addresses",
    ],
    summaryRows
  );

  const ready = rows.filter((row) => row.cluster_review_status === "ready").length;
  const review = rows.filter((row) => row.cluster_review_status === "review").length;
  const manual = rows.filter((row) => row.cluster_review_status === "manual_lookup").length;
  const clusterCount = new Set(rows.map((row) => row.route_cluster)).size;

  console.log(`Rows: ${rows.length}`);
  console.log(`Clusters: ${clusterCount}`);
  console.log(`Ready: ${ready}`);
  console.log(`Review: ${review}`);
  console.log(`Manual lookup: ${manual}`);
  console.log(`Wrote: ${outputPath}`);
  console.log(`Summary: ${summaryOutputPath}`);
}

main();
