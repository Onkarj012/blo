"use client"

import { useState, useMemo } from "react"
import { Download, FileSpreadsheet, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { toast } from "sonner"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  voters: Voter[]
  filters: Filters
}

interface Voter {
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

interface Filters {
  status: string
  visited: string
  name: string
  phone: string
  address: string
  gender: string
  minAge: string
  maxAge: string
  areaCluster: string
  phoneOnly: boolean
  includeVague: boolean
  includeMissing: boolean
}

interface ColumnConfig {
  key: keyof Voter
  label: string
  default: boolean
}

const columns: ColumnConfig[] = [
  { key: "name", label: "Name", default: true },
  { key: "phoneNumber", label: "Phone", default: true },
  { key: "displayAddress", label: "Address", default: true },
  { key: "status", label: "Status", default: false },
  { key: "visited", label: "Visited", default: false },
  { key: "areaCluster", label: "Area", default: false },
  { key: "age", label: "Age", default: false },
  { key: "gender", label: "Gender", default: false },
  { key: "relativeName", label: "Relative Name", default: false },
  { key: "relativeType", label: "Relative Type", default: false },
  { key: "epicNumber", label: "EPIC Number", default: false },
  { key: "distance", label: "Distance (km)", default: false },
]

export function ExportDialog({ open, onOpenChange, voters, filters }: ExportDialogProps) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    columns.filter((c) => c.default).map((c) => c.key as string)
  )
  const [pdfLayout, setPdfLayout] = useState<"portrait" | "landscape" | "letter">("portrait")
  const [includeHeader, setIncludeHeader] = useState(true)
  const [includeFilters, setIncludeFilters] = useState(true)
  const [isExporting, setIsExporting] = useState(false)

  const activeColumnCount = selectedColumns.length

  const handleColumnToggle = (columnKey: string) => {
    setSelectedColumns((prev) =>
      prev.includes(columnKey)
        ? prev.filter((k) => k !== columnKey)
        : [...prev, columnKey]
    )
  }

  const handleSelectAll = () => {
    setSelectedColumns(columns.map((c) => c.key as string))
  }

  const handleDeselectAll = () => {
    setSelectedColumns([])
  }

  const exportToCSV = () => {
    if (selectedColumns.length === 0) {
      toast.error("Please select at least one column")
      return
    }

    setIsExporting(true)
    try {
      const headers = columns
        .filter((c) => selectedColumns.includes(c.key as string))
        .map((c) => c.label)

      const rows = voters.map((voter) =>
        columns
          .filter((c) => selectedColumns.includes(c.key as string))
          .map((c) => {
            const value = voter[c.key]
            if (c.key === "visited") return value ? "Yes" : "No"
            if (c.key === "distance") return value !== undefined ? (value as number).toFixed(2) : ""
            return value ?? ""
          })
      )

      const csvContent = [headers, ...rows]
        .map((row) =>
          row
            .map((cell) => {
              const stringCell = String(cell)
              if (stringCell.includes(",") || stringCell.includes('"') || stringCell.includes("\n")) {
                return `"${stringCell.replace(/"/g, '""')}"`
              }
              return stringCell
            })
            .join(",")
        )
        .join("\n")

      const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `voters_export_${new Date().toISOString().split("T")[0]}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`Exported ${voters.length} voters to CSV`)
      onOpenChange(false)
    } catch (error) {
      toast.error("Failed to export CSV")
      console.error(error)
    } finally {
      setIsExporting(false)
    }
  }

  const exportToPDF = () => {
    if (selectedColumns.length === 0) {
      toast.error("Please select at least one column")
      return
    }

    setIsExporting(true)
    try {
      const pageSize = pdfLayout === "letter" ? "letter" : "a4"
      const orientation = pdfLayout === "landscape" ? "landscape" : "portrait"

      const doc = new jsPDF({
        orientation,
        unit: "mm",
        format: pageSize,
      })

      // Header
      if (includeHeader) {
        doc.setFontSize(20)
        doc.setFont("helvetica", "bold")
        doc.text("Voter Export Report", 14, 20)

        doc.setFontSize(10)
        doc.setFont("helvetica", "normal")
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 28)
        doc.text(`Total Records: ${voters.length}`, 14, 33)
      }

      // Filter summary
      let startY = includeHeader ? 40 : 14
      if (includeFilters) {
        const activeFilters: string[] = []
        if (filters.status !== "all") activeFilters.push(`Status: ${filters.status}`)
        if (filters.visited !== "all") activeFilters.push(`Visited: ${filters.visited}`)
        if (filters.name) activeFilters.push(`Name: ${filters.name}`)
        if (filters.phone) activeFilters.push(`Phone: ${filters.phone}`)
        if (filters.address) activeFilters.push(`Address: ${filters.address}`)
        if (filters.gender) activeFilters.push(`Gender: ${filters.gender}`)
        if (filters.areaCluster) activeFilters.push(`Area: ${filters.areaCluster}`)

        if (activeFilters.length > 0) {
          doc.setFontSize(9)
          doc.setFont("helvetica", "italic")
          doc.text(`Filters: ${activeFilters.join(" | ")}`, 14, startY)
          startY += 10
        }
      }

      // Table
      const headers = columns
        .filter((c) => selectedColumns.includes(c.key as string))
        .map((c) => c.label)

      const body = voters.map((voter) =>
        columns
          .filter((c) => selectedColumns.includes(c.key as string))
          .map((c) => {
            const value = voter[c.key]
            if (c.key === "visited") return value ? "Yes" : "No"
            if (c.key === "distance") return value !== undefined ? (value as number).toFixed(2) : "-"
            return String(value ?? "-")
          })
      )

      autoTable(doc, {
        head: [headers],
        body,
        startY,
        theme: "striped",
        headStyles: {
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: "bold",
          fontSize: 9,
        },
        bodyStyles: {
          fontSize: 8,
        },
        alternateRowStyles: {
          fillColor: [245, 245, 245],
        },
        margin: { top: 10, right: 14, bottom: 10, left: 14 },
        styles: {
          overflow: "linebreak",
          cellWidth: "auto",
        },
        didDrawPage: (data) => {
          // Page numbers
          const pageCount = doc.getNumberOfPages()
          const currentPage = data.pageNumber
          doc.setFontSize(8)
          doc.setFont("helvetica", "normal")
          doc.text(
            `Page ${currentPage} of ${pageCount}`,
            doc.internal.pageSize.getWidth() - 30,
            doc.internal.pageSize.getHeight() - 10
          )
        },
      })

      doc.save(`voters_export_${new Date().toISOString().split("T")[0]}.pdf`)

      toast.success(`Exported ${voters.length} voters to PDF`)
      onOpenChange(false)
    } catch (error) {
      toast.error("Failed to export PDF")
      console.error(error)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-5" />
            Export Voters
          </DialogTitle>
          <DialogDescription>
            Export {voters.length} filtered voters with selected columns
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="csv" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="csv" className="gap-2">
              <FileSpreadsheet className="size-4" />
              CSV
            </TabsTrigger>
            <TabsTrigger value="pdf" className="gap-2">
              <FileText className="size-4" />
              PDF
            </TabsTrigger>
          </TabsList>

          <TabsContent value="csv" className="space-y-4 mt-4">
            <ColumnSelector
              columns={columns}
              selectedColumns={selectedColumns}
              onToggle={handleColumnToggle}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
            />

            <Separator />

            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {activeColumnCount} of {columns.length} columns selected
              </p>
              <Button
                onClick={exportToCSV}
                disabled={isExporting || activeColumnCount === 0}
                className="gap-2"
              >
                <Download className="size-4" />
                {isExporting ? "Exporting..." : "Export CSV"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="pdf" className="space-y-4 mt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Page Layout</Label>
                <Select
                  value={pdfLayout}
                  onValueChange={(value) => setPdfLayout(value as typeof pdfLayout)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">A4 Portrait</SelectItem>
                    <SelectItem value="landscape">A4 Landscape</SelectItem>
                    <SelectItem value="letter">Letter Size</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-header"
                    checked={includeHeader}
                    onCheckedChange={(checked) => setIncludeHeader(checked as boolean)}
                  />
                  <Label htmlFor="include-header">Include header with title and timestamp</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-filters"
                    checked={includeFilters}
                    onCheckedChange={(checked) => setIncludeFilters(checked as boolean)}
                  />
                  <Label htmlFor="include-filters">Include filter summary</Label>
                </div>
              </div>
            </div>

            <Separator />

            <ColumnSelector
              columns={columns}
              selectedColumns={selectedColumns}
              onToggle={handleColumnToggle}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
            />

            <Separator />

            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {activeColumnCount} of {columns.length} columns selected
              </p>
              <Button
                onClick={exportToPDF}
                disabled={isExporting || activeColumnCount === 0}
                className="gap-2"
              >
                <Download className="size-4" />
                {isExporting ? "Exporting..." : "Export PDF"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function ColumnSelector({
  columns,
  selectedColumns,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  columns: ColumnConfig[]
  selectedColumns: string[]
  onToggle: (key: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Select Columns</Label>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onSelectAll}>
            Select All
          </Button>
          <Button variant="ghost" size="sm" onClick={onDeselectAll}>
            Deselect All
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {columns.map((column) => (
          <div key={column.key} className="flex items-center space-x-2">
            <Checkbox
              id={`col-${column.key}`}
              checked={selectedColumns.includes(column.key as string)}
              onCheckedChange={() => onToggle(column.key as string)}
            />
            <Label
              htmlFor={`col-${column.key}`}
              className="text-sm font-normal cursor-pointer"
            >
              {column.label}
            </Label>
            {column.default && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                Default
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
