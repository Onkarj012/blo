"use client"

import { useState, useMemo } from "react"
import { Download, FileSpreadsheet, FileText, Layers, ChevronDown, ChevronUp, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import {
  COLUMN_DEFS,
  downloadCSV,
  downloadGroupedCSV,
  downloadPDF,
  downloadGroupedPDF,
  type ExportVoter,
  type BlankColumnConfig,
  type PDFOptions,
} from "@/lib/export/engine"

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  voters: ExportVoter[]
  filterLabels?: string[]
}

type ExportFormat = "csv" | "pdf" | "grouped"

export function ExportDialog({ open, onOpenChange, voters, filterLabels }: ExportDialogProps) {
  // Step 1 — Columns
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    COLUMN_DEFS.filter(c => c.default).map(c => c.key)
  )
  const [blankEnabled, setBlankEnabled] = useState(false)
  const [blankColumns, setBlankColumns] = useState<BlankColumnConfig>({
    count: 2,
    headers: false,
    pattern: "Notes {n}",
    widthChars: 15,
  })

  // Step 2 — Format
  const [format, setFormat] = useState<ExportFormat>("csv")
  const [pageSize, setPageSize] = useState<"a4" | "letter" | "legal">("a4")
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait")
  const [includeTitle, setIncludeTitle] = useState(true)
  const [includeTimestamp, setIncludeTimestamp] = useState(true)
  const [includeFilters, setIncludeFilters] = useState(true)
  const [sortGroupsBy, setSortGroupsBy] = useState<"alphabetical" | "count">("alphabetical")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [newPagePerGroup, setNewPagePerGroup] = useState(true)
  const [includeGroupHeader, setIncludeGroupHeader] = useState(true)
  const [includeSummaryPage, setIncludeSummaryPage] = useState(true)

  const [isExporting, setIsExporting] = useState(false)

  const effectiveBlank = blankEnabled ? blankColumns : { count: 0, headers: false, pattern: "Notes {n}", widthChars: 15 }

  const blankPreview = useMemo(() => {
    if (!blankEnabled || blankColumns.count === 0) return []
    if (!blankColumns.headers) return Array(blankColumns.count).fill("")
    return Array.from({ length: blankColumns.count }, (_, i) =>
      blankColumns.pattern.replace("{n}", String(i + 1))
    )
  }, [blankEnabled, blankColumns])

  const allHeaders = useMemo(() => {
    const data = COLUMN_DEFS.filter(c => selectedColumns.includes(c.key)).map(c => c.label)
    return [...data, ...blankPreview]
  }, [selectedColumns, blankPreview])

  // Summary line for step 3
  const summary = useMemo(() => {
    const cols = selectedColumns.length
    const blank = effectiveBlank.count
    const fmt = format === "csv" ? "CSV" : format === "pdf" ? "PDF" : "Grouped PDF"
    const layout = format !== "csv" ? ` · ${pageSize.toUpperCase()} ${orientation}` : ""
    const blankStr = blank > 0 ? ` + ${blank} blank` : ""
    return `Exporting ${voters.length} voters · ${cols} columns${blankStr} · ${fmt}${layout}`
  }, [voters.length, selectedColumns.length, effectiveBlank.count, format, pageSize, orientation])

  function handleExport() {
    if (selectedColumns.length === 0 && effectiveBlank.count === 0) {
      toast.error("Select at least one column")
      return
    }
    setIsExporting(true)
    try {
      const csvOpts = {
        selectedColumns,
        blankColumns: effectiveBlank,
        includeGroupHeader,
        includeSummary: includeSummaryPage,
      }
      const pdfOpts: PDFOptions = {
        selectedColumns,
        blankColumns: effectiveBlank,
        pageSize,
        orientation,
        includeTitle,
        includeTimestamp,
        includeFilters,
        filterLabels,
        sortGroupsBy,
        sortDir,
        newPagePerGroup,
        includeGroupHeader,
        includeSummaryPage,
      }

      if (format === "csv") {
        downloadCSV(voters, csvOpts)
        toast.success(`Exported ${voters.length} voters to CSV`)
      } else if (format === "pdf") {
        downloadPDF(voters, pdfOpts)
        toast.success(`Exported ${voters.length} voters to PDF`)
      } else {
        const grpOpts = { sortBy: sortGroupsBy, sortDir }
        downloadGroupedCSV(voters, csvOpts, grpOpts)
        downloadGroupedPDF(voters, pdfOpts)
        toast.success(`Exported ${voters.length} voters as grouped PDF + CSV`)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error("Export failed")
      console.error(err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl h-[92dvh] max-h-[92dvh] sm:h-auto sm:max-h-[85vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Download className="size-5" />
            Export Voters
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{voters.length} voters · choose columns and format</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-7">
          {/* ── Step 1: Columns ─────────────────────────────────────────── */}
          <section className="space-y-4">
            <StepLabel n={1} title="Columns" />

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{selectedColumns.length} of {COLUMN_DEFS.length} selected</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-9 sm:h-7 text-xs" onClick={() => setSelectedColumns(COLUMN_DEFS.map(c => c.key))}>All</Button>
                <Button variant="ghost" size="sm" className="h-9 sm:h-7 text-xs" onClick={() => setSelectedColumns([])}>None</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 sm:gap-y-2.5 p-2 sm:p-4 bg-muted/30 rounded-lg">
              {COLUMN_DEFS.map(col => (
                <CheckRow
                  key={col.key}
                  id={`col-${col.key}`}
                  label={col.label}
                  checked={selectedColumns.includes(col.key)}
                  onCheckedChange={() =>
                    setSelectedColumns(prev =>
                      prev.includes(col.key) ? prev.filter(k => k !== col.key) : [...prev, col.key]
                    )
                  }
                  badge={col.default ? <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Default</Badge> : undefined}
                />
              ))}
            </div>

            {/* Blank columns — collapsed until toggled */}
            <div className="space-y-3">
              <SwitchRow label="Add blank columns for notes" checked={blankEnabled} onCheckedChange={setBlankEnabled} />

              {blankEnabled && (
                <div className="pl-2 space-y-4 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Count</Label>
                      <Input
                        type="number" min={1} max={10}
                        value={blankColumns.count}
                        onChange={e => setBlankColumns(p => ({ ...p, count: Math.max(1, parseInt(e.target.value) || 1) }))}
                        className="h-11 sm:h-8"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Width (chars ≈ {Math.round(blankColumns.widthChars * 2.5)}mm)</Label>
                      <Input
                        type="number" min={1} max={50}
                        value={blankColumns.widthChars}
                        onChange={e => setBlankColumns(p => ({ ...p, widthChars: Math.max(1, Math.min(50, parseInt(e.target.value) || 15)) }))}
                        className="h-11 sm:h-8"
                      />
                    </div>
                  </div>
                  <CheckRow
                    id="blank-headers"
                    label="Label blank columns"
                    checked={blankColumns.headers}
                    onCheckedChange={(v) => setBlankColumns(p => ({ ...p, headers: v }))}
                  />
                  {blankColumns.headers && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Pattern (use {"{n}"} for number)</Label>
                      <Input
                        value={blankColumns.pattern}
                        onChange={e => setBlankColumns(p => ({ ...p, pattern: e.target.value }))}
                        placeholder="Notes {n}"
                      />
                    </div>
                  )}
                  {blankEnabled && blankColumns.count > 0 && (
                    <div className="bg-muted/30 p-3 rounded-lg">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                        <Eye className="size-3" /> Column header preview:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {allHeaders.map((h, i) => (
                          <Badge key={i} variant={i < selectedColumns.length ? "default" : "secondary"} className="text-[10px] px-2 py-0.5">
                            {h || "(blank)"}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* ── Step 2: Format ──────────────────────────────────────────── */}
          <section className="space-y-4">
            <StepLabel n={2} title="Format & Layout" />

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <FormatCard
                icon={<FileSpreadsheet className="size-5" />}
                label="CSV"
                description="Spreadsheet"
                selected={format === "csv"}
                onClick={() => setFormat("csv")}
              />
              <FormatCard
                icon={<FileText className="size-5" />}
                label="PDF"
                description="Print-ready"
                selected={format === "pdf"}
                onClick={() => setFormat("pdf")}
              />
              <FormatCard
                icon={<Layers className="size-5" />}
                label="Grouped PDF"
                description="By area"
                selected={format === "grouped"}
                onClick={() => setFormat("grouped")}
              />
            </div>

            {/* Shared layout controls — only when PDF/Grouped */}
            {(format === "pdf" || format === "grouped") && (
              <div className="space-y-4 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Page Size</Label>
                    <Select value={pageSize} onValueChange={v => setPageSize(v as typeof pageSize)}>
                      <SelectTrigger className="w-full h-11 sm:h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="a4">A4</SelectItem>
                        <SelectItem value="letter">Letter</SelectItem>
                        <SelectItem value="legal">Legal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Orientation</Label>
                    <Select value={orientation} onValueChange={v => setOrientation(v as typeof orientation)}>
                      <SelectTrigger className="w-full h-11 sm:h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="portrait">Portrait</SelectItem>
                        <SelectItem value="landscape">Landscape</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Include in PDF</Label>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap gap-x-6 gap-y-0.5">
                    {[
                      { id: "title", label: "Title", value: includeTitle, set: setIncludeTitle },
                      { id: "ts", label: "Timestamp", value: includeTimestamp, set: setIncludeTimestamp },
                      { id: "fl", label: "Filter summary", value: includeFilters, set: setIncludeFilters },
                    ].map(opt => (
                      <CheckRow key={opt.id} id={opt.id} label={opt.label} checked={opt.value} onCheckedChange={opt.set} />
                    ))}
                  </div>
                </div>

                {/* Grouped-only options */}
                {format === "grouped" && (
                  <div className="space-y-3 pt-1">
                    <Separator />
                    <Label className="text-xs text-muted-foreground">Grouping Options</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Sort areas by</Label>
                        <Select value={sortGroupsBy} onValueChange={v => setSortGroupsBy(v as typeof sortGroupsBy)}>
                          <SelectTrigger className="w-full h-11 sm:h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="alphabetical">Alphabetical</SelectItem>
                            <SelectItem value="count">Voter Count</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Direction</Label>
                        <Select value={sortDir} onValueChange={v => setSortDir(v as typeof sortDir)}>
                          <SelectTrigger className="w-full h-11 sm:h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="asc">Ascending</SelectItem>
                            <SelectItem value="desc">Descending</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-x-6 gap-y-0.5">
                      {[
                        { id: "nppg", label: "New page per area", value: newPagePerGroup, set: setNewPagePerGroup },
                        { id: "gh", label: "Area headers", value: includeGroupHeader, set: setIncludeGroupHeader },
                        { id: "sp", label: "Summary page", value: includeSummaryPage, set: setIncludeSummaryPage },
                      ].map(opt => (
                        <CheckRow key={opt.id} id={opt.id} label={opt.label} checked={opt.value} onCheckedChange={opt.set} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <Separator />

          {/* ── Step 3: Review ──────────────────────────────────────────── */}
          <section className="space-y-4">
            <StepLabel n={3} title="Review & Export" />

            <div className="rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              {summary}
            </div>
          </section>
        </div>

        {/* Sticky footer — actions always reachable */}
        <div className="shrink-0 border-t bg-popover px-4 sm:px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 h-11 sm:h-8">
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || (selectedColumns.length === 0 && effectiveBlank.count === 0)}
            className="flex-1 h-11 sm:h-8 gap-2"
          >
            <Download className="size-4" />
            {isExporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
        {n}
      </div>
      <span className="font-semibold">{title}</span>
    </div>
  )
}

function FormatCard({
  icon, label, description, selected, onClick,
}: {
  icon: React.ReactNode
  label: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border-2 p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-2 sm:p-4 ${
        selected
          ? "border-primary bg-primary/8"
          : "border-border hover:border-primary/50 hover:bg-muted/40"
      }`}
    >
      <div className={selected ? "text-primary" : "text-muted-foreground"}>{icon}</div>
      <div>
        <p className="text-xs font-semibold sm:text-sm">{label}</p>
        <p className="hidden text-xs text-muted-foreground sm:block">{description}</p>
      </div>
    </button>
  )
}

function CheckRow({
  id, label, checked, onCheckedChange, badge,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  badge?: React.ReactNode
}) {
  return (
    <div
      className="-mx-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 select-none hover:bg-muted/40 sm:min-h-0"
      onClick={() => onCheckedChange(!checked)}
    >
      <span onClick={e => e.stopPropagation()} className="flex items-center">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={v => onCheckedChange(v as boolean)}
        />
      </span>
      <Label htmlFor={id} className="flex-1 text-sm font-normal">
        {label}
      </Label>
      {badge}
    </div>
  )
}

function SwitchRow({
  label, checked, onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div
      className="flex min-h-11 cursor-pointer items-center justify-between gap-2 select-none sm:min-h-0"
      onClick={() => onCheckedChange(!checked)}
    >
      <Label className="text-sm">{label}</Label>
      <span onClick={e => e.stopPropagation()} className="flex items-center">
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </span>
    </div>
  )
}
