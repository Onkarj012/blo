#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";

import { importCleanedCsv } from "@/lib/import-cleaned-csv";

async function main() {
  const targetPath = process.argv[2] || "data/output/clean/1_1530_cleaned.csv";
  const resolvedPath = path.resolve(process.cwd(), targetPath);
  const sourceName = path.basename(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSV file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, "utf8");
  const result = await importCleanedCsv({
    content,
    sourceName,
  });

  console.log(JSON.stringify(result, null, 2));
}

void main();

