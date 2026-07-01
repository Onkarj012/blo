/**
 * Pure export engine — CSV/PDF builders decoupled from UI.
 * Append new columns to COLUMN_DEFS without structural changes (Plan 04 note).
 */
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExportVoter {
  _id: string
  name: string
  status: string
  visited?: boolean
  areaCluster: string
  displayAddress: string
  phoneNumber?: string
  age: string
  gender: string
  relativeName?: string
  relativeType?: string
  epicNumber?: string
  distance?: number
}

export interface ColumnDef {
  key: string
  label: string
  getValue: (v: ExportVoter) => string
  default: boolean
}

export interface BlankColumnConfig {
  count: number
  headers: boolean
  pattern: string
  widthChars: number
}

export interface CSVOptions {
  selectedColumns: string[]
  blankColumns: BlankColumnConfig
  includeSummary?: boolean
  includeGroupHeader?: boolean
}

export interface PDFOptions {
  selectedColumns: string[]
  blankColumns: BlankColumnConfig
  pageSize: "a4" | "letter" | "legal"
  orientation: "portrait" | "landscape"
  includeTitle: boolean
  includeTimestamp: boolean
  includeFilters: boolean
  filterLabels?: string[]
  sortGroupsBy?: "alphabetical" | "count"
  sortDir?: "asc" | "desc"
  newPagePerGroup?: boolean
  includeGroupHeader?: boolean
  includeSummaryPage?: boolean
}

// ── Column definitions — append here for new data joins ──────────────────────

export const COLUMN_DEFS: ColumnDef[] = [
  { key: "name",         label: "Name",          getValue: v => v.name,                  default: true },
  { key: "phoneNumber",  label: "Phone",          getValue: v => v.phoneNumber ?? "",      default: true },
  { key: "displayAddress", label: "Address",      getValue: v => v.displayAddress,         default: true },
  { key: "status",       label: "Status",         getValue: v => v.status,                 default: false },
  { key: "visited",      label: "Visited",        getValue: v => v.visited ? "Yes" : "No", default: false },
  { key: "areaCluster",  label: "Area",           getValue: v => v.areaCluster,            default: false },
  { key: "age",          label: "Age",            getValue: v => v.age,                    default: false },
  { key: "gender",       label: "Gender",         getValue: v => v.gender,                 default: false },
  { key: "relativeName", label: "Relative Name",  getValue: v => v.relativeName ?? "",     default: false },
  { key: "relativeType", label: "Relative Type",  getValue: v => v.relativeType ?? "",     default: false },
  { key: "epicNumber",   label: "EPIC Number",    getValue: v => v.epicNumber ?? "",        default: false },
  { key: "distance",     label: "Distance (km)",  getValue: v => v.distance !== undefined ? v.distance.toFixed(2) : "", default: false },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHeaders(selectedColumns: string[], blankColumns: BlankColumnConfig): string[] {
  const dataHeaders = COLUMN_DEFS
    .filter(c => selectedColumns.includes(c.key))
    .map(c => c.label)
  const blankHeaders = blankColumns.count === 0
    ? []
    : blankColumns.headers
      ? Array.from({ length: blankColumns.count }, (_, i) =>
          blankColumns.pattern.replace("{n}", String(i + 1))
        )
      : Array(blankColumns.count).fill("")
  return [...dataHeaders, ...blankHeaders]
}

function getRowData(voter: ExportVoter, selectedColumns: string[], blankCount: number): string[] {
  const data = COLUMN_DEFS
    .filter(c => selectedColumns.includes(c.key))
    .map(c => c.getValue(voter))
  return [...data, ...Array(blankCount).fill("")]
}

function escapeCsvCell(cell: string): string {
  if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
    return `"${cell.replace(/"/g, '""')}"`
  }
  return cell
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function buildPDFTable(
  doc: jsPDF,
  voters: ExportVoter[],
  startY: number,
  opts: PDFOptions,
  isGrouped = false,
): number {
  const headers = getHeaders(opts.selectedColumns, opts.blankColumns)
  const body = voters.map(v => getRowData(v, opts.selectedColumns, opts.blankColumns.count))

  const columnStyles: Record<number, { cellWidth: number }> = {}
  const dataColCount = headers.length - opts.blankColumns.count
  const blankWidthMm = opts.blankColumns.widthChars * 2.5
  for (let i = 0; i < opts.blankColumns.count; i++) {
    columnStyles[dataColCount + i] = { cellWidth: blankWidthMm }
  }

  autoTable(doc, {
    head: [headers],
    body,
    startY,
    theme: "grid",
    headStyles: {
      fillColor: [41, 128, 185],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 9,
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
    },
    styles: {
      overflow: "linebreak",
      cellWidth: "auto",
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
    },
    margin: { top: 10, right: 14, bottom: 10, left: 14 },
    columnStyles,
    didDrawPage: !isGrouped ? (data) => {
      const total = doc.getNumberOfPages()
      doc.setFontSize(8)
      doc.setFont("helvetica", "normal")
      doc.text(
        `Page ${data.pageNumber} of ${total}`,
        doc.internal.pageSize.getWidth() - 30,
        doc.internal.pageSize.getHeight() - 10,
      )
    } : undefined,
  })

  // @ts-expect-error autoTable adds lastAutoTable
  return doc.lastAutoTable?.finalY ?? startY
}

function sortGroups(
  groups: [string, ExportVoter[]][],
  sortBy: "alphabetical" | "count",
  dir: "asc" | "desc",
): [string, ExportVoter[]][] {
  return [...groups].sort((a, b) => {
    const cmp = sortBy === "alphabetical"
      ? a[0].localeCompare(b[0])
      : a[1].length - b[1].length
    return dir === "asc" ? cmp : -cmp
  })
}

function groupByArea(voters: ExportVoter[]): [string, ExportVoter[]][] {
  const map = new Map<string, ExportVoter[]>()
  voters.forEach(v => {
    if (!map.has(v.areaCluster)) map.set(v.areaCluster, [])
    map.get(v.areaCluster)!.push(v)
  })
  return Array.from(map.entries())
}

// ── Public API ────────────────────────────────────────────────────────────────

export function downloadCSV(voters: ExportVoter[], opts: CSVOptions, filename?: string) {
  const headers = getHeaders(opts.selectedColumns, opts.blankColumns)
  const rows = voters.map(v => getRowData(v, opts.selectedColumns, opts.blankColumns.count))

  const csv = [headers, ...rows]
    .map(row => row.map(escapeCsvCell).join(","))
    .join("\n")

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  triggerDownload(blob, filename ?? `voters_${new Date().toISOString().split("T")[0]}.csv`)
}

export function downloadGroupedCSV(voters: ExportVoter[], opts: CSVOptions, groupedOpts: { sortBy: "alphabetical" | "count"; sortDir: "asc" | "desc" }, filename?: string) {
  const headers = getHeaders(opts.selectedColumns, opts.blankColumns)
  const rawGroups = groupByArea(voters)
  const groups = sortGroups(rawGroups, groupedOpts.sortBy, groupedOpts.sortDir)

  let csv = ""

  if (opts.includeSummary) {
    csv += "AREA SUMMARY\n"
    csv += `Total Areas,${groups.length}\nTotal Voters,${voters.length}\n\n`
    csv += "Area,Voter Count\n"
    groups.forEach(([area, vs]) => { csv += `${escapeCsvCell(area)},${vs.length}\n` })
    csv += "\n\n"
  }

  groups.forEach(([area, vs], i) => {
    if (opts.includeGroupHeader) csv += `${escapeCsvCell(area)},${vs.length} voters\n`
    csv += headers.map(escapeCsvCell).join(",") + "\n"
    vs.forEach(v => { csv += getRowData(v, opts.selectedColumns, opts.blankColumns.count).map(escapeCsvCell).join(",") + "\n" })
    if (i < groups.length - 1) csv += "\n\n"
  })

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  triggerDownload(blob, filename ?? `voters_grouped_${new Date().toISOString().split("T")[0]}.csv`)
}

export function downloadPDF(voters: ExportVoter[], opts: PDFOptions, filename?: string) {
  const doc = new jsPDF({ orientation: opts.orientation, unit: "mm", format: opts.pageSize })
  let y = 14

  if (opts.includeTitle) {
    doc.setFontSize(20); doc.setFont("helvetica", "bold")
    doc.text("Voter Export Report", 14, y); y += 10
  }
  if (opts.includeTimestamp) {
    doc.setFontSize(10); doc.setFont("helvetica", "normal")
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, y); y += 6
  }
  doc.text(`Total Records: ${voters.length}`, 14, y); y += 10

  if (opts.includeFilters && opts.filterLabels?.length) {
    doc.setFontSize(9); doc.setFont("helvetica", "italic")
    const text = `Filters: ${opts.filterLabels.join(" | ")}`
    const split = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - 28)
    doc.text(split, 14, y); y += split.length * 4 + 6
  }

  buildPDFTable(doc, voters, y, opts)
  doc.save(filename ?? `voters_${new Date().toISOString().split("T")[0]}.pdf`)
}

export function downloadGroupedPDF(voters: ExportVoter[], opts: PDFOptions, filename?: string) {
  const doc = new jsPDF({ orientation: opts.orientation, unit: "mm", format: opts.pageSize })
  const rawGroups = groupByArea(voters)
  const groups = sortGroups(rawGroups, opts.sortGroupsBy ?? "alphabetical", opts.sortDir ?? "asc")
  let y = 14
  let firstPage = true

  if (opts.includeSummaryPage) {
    if (opts.includeTitle) {
      doc.setFontSize(20); doc.setFont("helvetica", "bold")
      doc.text("Voter Export Report — Grouped by Area", 14, y); y += 12
    }
    if (opts.includeTimestamp) {
      doc.setFontSize(10); doc.setFont("helvetica", "normal")
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, y); y += 8
    }
    doc.setFontSize(12); doc.setFont("helvetica", "bold")
    doc.text("Area Summary", 14, y); y += 8
    autoTable(doc, {
      head: [["Area", "Voter Count"]],
      body: groups.map(([area, vs]) => [area, vs.length]),
      startY: y,
      theme: "striped",
      headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 10 },
    })
    doc.addPage(); firstPage = false; y = 14
  }

  groups.forEach(([area, vs], idx) => {
    if (!firstPage && opts.newPagePerGroup) { doc.addPage(); y = 14 }

    if (opts.includeGroupHeader) {
      doc.setFontSize(14); doc.setFont("helvetica", "bold")
      doc.text(area, 14, y); y += 6
      doc.setFontSize(9); doc.setFont("helvetica", "normal")
      const pending = vs.filter(v => v.status === "pending").length
      const done = vs.filter(v => v.status === "done").length
      const revisit = vs.filter(v => v.status === "revisit").length
      doc.text(`${vs.length} voters | Pending: ${pending} | Done: ${done} | Revisit: ${revisit}`, 14, y); y += 10
    }

    const finalY = buildPDFTable(doc, vs, y, opts, true)
    firstPage = false
    y = finalY + 10

    if (idx < groups.length - 1 && !opts.newPagePerGroup && y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage(); y = 14
    }
  })

  doc.save(filename ?? `voters_grouped_${new Date().toISOString().split("T")[0]}.pdf`)
}

/** Quick single-area CSV — used by area headers in the dashboard */
export function downloadAreaCSV(areaName: string, voters: ExportVoter[]) {
  const opts: CSVOptions = {
    selectedColumns: ["name", "phoneNumber", "displayAddress", "status", "age", "gender"],
    blankColumns: { count: 0, headers: false, pattern: "Notes {n}", widthChars: 15 },
  }
  const safe = areaName.replace(/[^a-zA-Z0-9]/g, "_")
  downloadCSV(voters, opts, `cluster_${safe}_${voters.length}_voters_${new Date().toISOString().split("T")[0]}.csv`)
}

/** Quick single-area PDF — used by area headers in the dashboard */
export function downloadAreaPDF(areaName: string, voters: ExportVoter[]) {
  const opts: PDFOptions = {
    selectedColumns: ["name", "phoneNumber", "displayAddress", "status", "age"],
    blankColumns: { count: 0, headers: false, pattern: "Notes {n}", widthChars: 15 },
    pageSize: "a4",
    orientation: "portrait",
    includeTitle: true,
    includeTimestamp: true,
    includeFilters: false,
  }
  const safe = areaName.replace(/[^a-zA-Z0-9]/g, "_")
  downloadPDF(voters, opts, `cluster_${safe}_${new Date().toISOString().split("T")[0]}.pdf`)
}
