"use client"

import { useState, useMemo } from "react"
import { Download, FileSpreadsheet, FileText, Layers, ChevronDown, ChevronUp, Eye } from "lucide-react"
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
import { Input } from "@/components/ui/input"
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
  
  // Blank column settings
  const [blankColumnCount, setBlankColumnCount] = useState<number>(0)
  const [blankColumnHeaders, setBlankColumnHeaders] = useState<boolean>(false)
  const [blankColumnPattern, setBlankColumnPattern] = useState<string>("Notes {n}")
  
  // PDF options
  const [pdfLayout, setPdfLayout] = useState<"portrait" | "landscape" | "letter">("portrait")
  const [includeTitle, setIncludeTitle] = useState(true)
  const [includeTimestamp, setIncludeTimestamp] = useState(true)
  const [includeFilters, setIncludeFilters] = useState(true)
  
  // Grouped export options
  const [groupByField] = useState<"areaCluster">("areaCluster")
  const [sortGroupsBy, setSortGroupsBy] = useState<"alphabetical" | "count">("alphabetical")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  const [newPagePerGroup, setNewPagePerGroup] = useState(true)
  const [includeGroupHeader, setIncludeGroupHeader] = useState(true)
  const [includeSummaryPage, setIncludeSummaryPage] = useState(true)
  
  const [isExporting, setIsExporting] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["columns", "blank", "options"]))

  const activeColumnCount = selectedColumns.length

  // Generate preview of blank column headers
  const blankColumnPreview = useMemo(() => {
    if (blankColumnCount === 0) return []
    if (!blankColumnHeaders) return Array(blankColumnCount).fill("")
    return Array.from({ length: blankColumnCount }, (_, i) => 
      blankColumnPattern.replace("{n}", String(i + 1))
    )
  }, [blankColumnCount, blankColumnHeaders, blankColumnPattern])

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

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const getAllHeaders = () => {
    const dataHeaders = columns
      .filter((c) => selectedColumns.includes(c.key as string))
      .map((c) => c.label)
    return [...dataHeaders, ...blankColumnPreview]
  }

  // Group voters by area
  const groupVotersByArea = () => {
    const groups = new Map<string, Voter[]>()
    voters.forEach((voter) => {
      const key = voter[groupByField]
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(voter)
    })
    
    // Sort groups
    let sortedGroups = Array.from(groups.entries())
    if (sortGroupsBy === "alphabetical") {
      sortedGroups.sort((a, b) => {
        const comparison = a[0].localeCompare(b[0])
        return sortDirection === "asc" ? comparison : -comparison
      })
    } else {
      sortedGroups.sort((a, b) => {
        const comparison = a[1].length - b[1].length
        return sortDirection === "asc" ? comparison : -comparison
      })
    }
    
    return sortedGroups
  }

  const exportToCSV = (grouped: boolean = false) => {
    if (selectedColumns.length === 0 && blankColumnCount === 0) {
      toast.error("Please select at least one column or add blank columns")
      return
    }

    setIsExporting(true)
    try {
      const headers = getAllHeaders()
      
      if (!grouped) {
        // Standard CSV export
        const rows = voters.map((voter) =>
          [...getVoterRowData(voter), ...Array(blankColumnCount).fill("")]
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

        downloadCSV(csvContent, `voters_export_${new Date().toISOString().split("T")[0]}.csv`)
        toast.success(`Exported ${voters.length} voters to CSV`)
      } else {
        // Grouped CSV export with area separators
        const groups = groupVotersByArea()
        let csvContent = ""
        
        // Add summary if enabled
        if (includeSummaryPage) {
          csvContent += "AREA SUMMARY\n"
          csvContent += `Total Areas,${groups.length}\n`
          csvContent += `Total Voters,${voters.length}\n\n`
          csvContent += "Area,Voter Count\n"
          groups.forEach(([area, areaVoters]) => {
            csvContent += `"${area}",${areaVoters.length}\n`
          })
          csvContent += "\n\n"
        }
        
        // Add each area
        groups.forEach(([area, areaVoters], index) => {
          if (includeGroupHeader) {
            csvContent += `"${area}",${areaVoters.length} voters\n`
          }
          
          // Headers
          csvContent += headers.join(",") + "\n"
          
          // Data rows
          areaVoters.forEach((voter) => {
            const row = [...getVoterRowData(voter), ...Array(blankColumnCount).fill("")]
            csvContent += row
              .map((cell) => {
                const stringCell = String(cell)
                if (stringCell.includes(",") || stringCell.includes('"') || stringCell.includes("\n")) {
                  return `"${stringCell.replace(/"/g, '""')}"`
                }
                return stringCell
              })
              .join(",") + "\n"
          })
          
          // Add separator between areas (except last)
          if (index < groups.length - 1) {
            csvContent += "\n\n"
          }
        })

        downloadCSV(csvContent, `voters_grouped_${new Date().toISOString().split("T")[0]}.csv`)
        toast.success(`Exported ${voters.length} voters in ${groups.length} groups to CSV`)
      }
      
      onOpenChange(false)
    } catch (error) {
      toast.error("Failed to export CSV")
      console.error(error)
    } finally {
      setIsExporting(false)
    }
  }

  const getVoterRowData = (voter: Voter): string[] => {
    return columns
      .filter((c) => selectedColumns.includes(c.key as string))
      .map((c) => {
        const value = voter[c.key]
        if (c.key === "visited") return value ? "Yes" : "No"
        if (c.key === "distance") return value !== undefined ? (value as number).toFixed(2) : ""
        return String(value ?? "")
      })
  }

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const exportToPDF = (grouped: boolean = false) => {
    if (selectedColumns.length === 0 && blankColumnCount === 0) {
      toast.error("Please select at least one column or add blank columns")
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

      if (!grouped) {
        // Standard PDF export
        exportStandardPDF(doc)
      } else {
        // Grouped PDF export
        exportGroupedPDF(doc)
      }

      doc.save(`voters_${grouped ? 'grouped_' : ''}${new Date().toISOString().split("T")[0]}.pdf`)
      toast.success(`Exported ${voters.length} voters to ${grouped ? 'grouped ' : ''}PDF`)
      onOpenChange(false)
    } catch (error) {
      toast.error("Failed to export PDF")
      console.error(error)
    } finally {
      setIsExporting(false)
    }
  }

  const exportStandardPDF = (doc: jsPDF) => {
    let startY = 14

    // Title header
    if (includeTitle) {
      doc.setFontSize(20)
      doc.setFont("helvetica", "bold")
      doc.text("Voter Export Report", 14, startY)
      startY += 10
    }

    // Timestamp
    if (includeTimestamp) {
      doc.setFontSize(10)
      doc.setFont("helvetica", "normal")
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, startY)
      startY += 6
    }

    // Total count
    doc.text(`Total Records: ${voters.length}`, 14, startY)
    startY += 10

    // Filter summary
    if (includeFilters) {
      const activeFilters = getActiveFilters()
      if (activeFilters.length > 0) {
        doc.setFontSize(9)
        doc.setFont("helvetica", "italic")
        const filterText = `Filters: ${activeFilters.join(" | ")}`
        // Wrap long filter text
        const splitText = doc.splitTextToSize(filterText, doc.internal.pageSize.getWidth() - 28)
        doc.text(splitText, 14, startY)
        startY += splitText.length * 4 + 6
      }
    }

    // Table
    createPDFTable(doc, voters, startY)
  }

  const exportGroupedPDF = (doc: jsPDF) => {
    const groups = groupVotersByArea()
    let currentY = 14
    let isFirstPage = true

    // Summary page
    if (includeSummaryPage) {
      if (includeTitle) {
        doc.setFontSize(20)
        doc.setFont("helvetica", "bold")
        doc.text("Voter Export Report - Grouped by Area", 14, currentY)
        currentY += 12
      }

      if (includeTimestamp) {
        doc.setFontSize(10)
        doc.setFont("helvetica", "normal")
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, currentY)
        currentY += 8
      }

      // Summary table
      doc.setFontSize(12)
      doc.setFont("helvetica", "bold")
      doc.text("Area Summary", 14, currentY)
      currentY += 8

      autoTable(doc, {
        head: [["Area", "Voter Count"]],
        body: groups.map(([area, areaVoters]) => [area, areaVoters.length]),
        startY: currentY,
        theme: "striped",
        headStyles: {
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: "bold",
        },
        styles: {
          fontSize: 10,
        },
      })

      doc.addPage()
      isFirstPage = false
      currentY = 14
    }

    // Each area
    groups.forEach(([area, areaVoters], index) => {
      if (!isFirstPage && newPagePerGroup) {
        doc.addPage()
        currentY = 14
      }

      // Group header
      if (includeGroupHeader) {
        doc.setFontSize(14)
        doc.setFont("helvetica", "bold")
        doc.text(area, 14, currentY)
        currentY += 6

        doc.setFontSize(9)
        doc.setFont("helvetica", "normal")
        
        // Calculate status breakdown
        const pending = areaVoters.filter(v => v.status === "pending").length
        const done = areaVoters.filter(v => v.status === "done").length
        const revisit = areaVoters.filter(v => v.status === "revisit").length
        
        doc.text(`${areaVoters.length} voters | Pending: ${pending} | Done: ${done} | Revisit: ${revisit}`, 14, currentY)
        currentY += 10
      }

      // Table for this group
      const finalY = createPDFTable(doc, areaVoters, currentY, true)
      
      isFirstPage = false
      currentY = finalY + 10

      // Add new page if needed and not already added
      if (index < groups.length - 1 && !newPagePerGroup && currentY > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage()
        currentY = 14
        isFirstPage = true
      }
    })
  }

  const createPDFTable = (doc: jsPDF, data: Voter[], startY: number, isGrouped: boolean = false): number => {
    const headers = getAllHeaders()
    const body = data.map((voter) =>
      [...getVoterRowData(voter), ...Array(blankColumnCount).fill("")]
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
      didDrawPage: !isGrouped ? (data) => {
        const pageCount = doc.getNumberOfPages()
        const currentPage = data.pageNumber
        doc.setFontSize(8)
        doc.setFont("helvetica", "normal")
        doc.text(
          `Page ${currentPage} of ${pageCount}`,
          doc.internal.pageSize.getWidth() - 30,
          doc.internal.pageSize.getHeight() - 10
        )
      } : undefined,
    })

    // @ts-expect-error - autoTable adds lastAutoTable property
    return doc.lastAutoTable?.finalY || startY
  }

  const getActiveFilters = (): string[] => {
    const activeFilters: string[] = []
    if (filters.status !== "all") activeFilters.push(`Status: ${filters.status}`)
    if (filters.visited !== "all") activeFilters.push(`Visited: ${filters.visited}`)
    if (filters.name) activeFilters.push(`Name: ${filters.name}`)
    if (filters.phone) activeFilters.push(`Phone: ${filters.phone}`)
    if (filters.address) activeFilters.push(`Address: ${filters.address}`)
    if (filters.gender) activeFilters.push(`Gender: ${filters.gender}`)
    if (filters.areaCluster) activeFilters.push(`Area: ${filters.areaCluster}`)
    return activeFilters
  }

  const SectionHeader = ({ title, section, icon: Icon }: { title: string; section: string; icon: any }) => (
    <button
      onClick={() => toggleSection(section)}
      className="flex items-center justify-between w-full py-3 px-4 bg-muted/50 hover:bg-muted rounded-lg transition-colors"
    >
      <div className="flex items-center gap-3">
        {Icon && <Icon className="size-5 text-muted-foreground" />}
        <span className="font-semibold">{title}</span>
      </div>
      {expandedSections.has(section) ? (
        <ChevronUp className="size-5 text-muted-foreground" />
      ) : (
        <ChevronDown className="size-5 text-muted-foreground" />
      )}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <Download className="size-6" />
            Export Voters
          </DialogTitle>
          <DialogDescription className="text-base">
            Export {voters.length} filtered voters with your selected columns and options
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* Column Selection Section */}
          <div className="space-y-4">
            <SectionHeader title="Column Selection" section="columns" icon={Layers} />
            
            {expandedSections.has("columns") && (
              <div className="px-4 pt-2 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {activeColumnCount} of {columns.length} data columns selected
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleSelectAll}>
                      Select All
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDeselectAll}>
                      Deselect All
                    </Button>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
                  {columns.map((column) => (
                    <div key={column.key} className="flex items-center gap-3">
                      <Checkbox
                        id={`col-${column.key}`}
                        checked={selectedColumns.includes(column.key as string)}
                        onCheckedChange={() => handleColumnToggle(column.key as string)}
                      />
                      <Label
                        htmlFor={`col-${column.key}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {column.label}
                      </Label>
                      {column.default && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Default
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Blank Columns Section */}
          <div className="space-y-4">
            <SectionHeader title="Blank Columns" section="blank" icon={Layers} />
            
            {expandedSections.has("blank") && (
              <div className="px-4 pt-2 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label htmlFor="blank-count">Number of Blank Columns</Label>
                    <Input
                      id="blank-count"
                      type="number"
                      min={0}
                      value={blankColumnCount}
                      onChange={(e) => setBlankColumnCount(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="Enter number (0 or more)"
                    />
                    <p className="text-xs text-muted-foreground">
                      Add empty columns for manual notes
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        id="blank-headers"
                        checked={blankColumnHeaders}
                        onCheckedChange={(checked) => setBlankColumnHeaders(checked as boolean)}
                      />
                      <Label htmlFor="blank-headers" className="font-medium">
                        Add headers to blank columns
                      </Label>
                    </div>
                    
                    {blankColumnHeaders && (
                      <div className="space-y-2 pl-6">
                        <Label htmlFor="blank-pattern" className="text-sm">
                          Header Pattern (use {"{n}"} for number)
                        </Label>
                        <Input
                          id="blank-pattern"
                          value={blankColumnPattern}
                          onChange={(e) => setBlankColumnPattern(e.target.value)}
                          placeholder="e.g., Notes {n}"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Preview */}
                {blankColumnCount > 0 && (
                  <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Eye className="size-4" />
                      Preview of all column headers:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {getAllHeaders().map((header, index) => (
                        <Badge 
                          key={index} 
                          variant={index < activeColumnCount ? "default" : "secondary"}
                          className="text-xs py-1 px-3"
                        >
                          {header || "(blank)"}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Export Options Section */}
          <div className="space-y-4">
            <SectionHeader title="Export Options" section="options" icon={FileText} />
            
            {expandedSections.has("options") && (
              <div className="px-4 pt-2 space-y-6">
                <Tabs defaultValue="csv" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="csv" className="gap-2">
                      <FileSpreadsheet className="size-4" />
                      CSV
                    </TabsTrigger>
                    <TabsTrigger value="pdf" className="gap-2">
                      <FileText className="size-4" />
                      PDF
                    </TabsTrigger>
                    <TabsTrigger value="grouped" className="gap-2">
                      <Layers className="size-4" />
                      Grouped
                    </TabsTrigger>
                  </TabsList>

                  {/* CSV Options */}
                  <TabsContent value="csv" className="space-y-6 mt-6">
                    <div className="bg-muted/30 p-6 rounded-lg">
                      <p className="text-sm text-muted-foreground">
                        Export as CSV file with comma-separated values.
                        {blankColumnCount > 0 && (
                          <span> Blank columns will be included at the end of each row.</span>
                        )}
                      </p>
                    </div>

                    <div className="flex justify-end gap-3">
                      <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => exportToCSV(false)}
                        disabled={isExporting || (activeColumnCount === 0 && blankColumnCount === 0)}
                        className="gap-2"
                      >
                        <Download className="size-4" />
                        {isExporting ? "Exporting..." : "Export CSV"}
                      </Button>
                    </div>
                  </TabsContent>

                  {/* PDF Options */}
                  <TabsContent value="pdf" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
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

                      <div className="space-y-4">
                        <Label>Include in PDF</Label>
                        <div className="space-y-3">
                          <div className="flex items-center space-x-3">
                            <Checkbox
                              id="include-title"
                              checked={includeTitle}
                              onCheckedChange={(checked) => setIncludeTitle(checked as boolean)}
                            />
                            <Label htmlFor="include-title" className="font-normal">
                              Title header
                            </Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Checkbox
                              id="include-timestamp"
                              checked={includeTimestamp}
                              onCheckedChange={(checked) => setIncludeTimestamp(checked as boolean)}
                            />
                            <Label htmlFor="include-timestamp" className="font-normal">
                              Timestamp
                            </Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Checkbox
                              id="include-filters-pdf"
                              checked={includeFilters}
                              onCheckedChange={(checked) => setIncludeFilters(checked as boolean)}
                            />
                            <Label htmlFor="include-filters-pdf" className="font-normal">
                              Filter summary
                            </Label>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-3">
                      <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => exportToPDF(false)}
                        disabled={isExporting || (activeColumnCount === 0 && blankColumnCount === 0)}
                        className="gap-2"
                      >
                        <Download className="size-4" />
                        {isExporting ? "Exporting..." : "Export PDF"}
                      </Button>
                    </div>
                  </TabsContent>

                  {/* Grouped Options */}
                  <TabsContent value="grouped" className="space-y-6 mt-6">
                    <div className="bg-muted/30 p-6 rounded-lg space-y-4">
                      <h4 className="font-semibold">Group by: Area</h4>
                      <p className="text-sm text-muted-foreground">
                        Voters will be organized by their area/cluster, with each area on a separate page/section.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <Label>Sort Areas By</Label>
                        <div className="flex gap-3">
                          <Select
                            value={sortGroupsBy}
                            onValueChange={(value) => setSortGroupsBy(value as typeof sortGroupsBy)}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="alphabetical">Alphabetical</SelectItem>
                              <SelectItem value="count">Voter Count</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={sortDirection}
                            onValueChange={(value) => setSortDirection(value as typeof sortDirection)}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="asc">Ascending</SelectItem>
                              <SelectItem value="desc">Descending</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <Label>PDF Options</Label>
                        <div className="space-y-3">
                          <div className="flex items-center space-x-3">
                            <Checkbox
                              id="new-page"
                              checked={newPagePerGroup}
                              onCheckedChange={(checked) => setNewPagePerGroup(checked as boolean)}
                            />
                            <Label htmlFor="new-page" className="font-normal">
                              Start each area on new page
                            </Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Checkbox
                              id="group-header"
                              checked={includeGroupHeader}
                              onCheckedChange={(checked) => setIncludeGroupHeader(checked as boolean)}
                            />
                            <Label htmlFor="group-header" className="font-normal">
                              Include area header with stats
                            </Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Checkbox
                              id="summary-page"
                              checked={includeSummaryPage}
                              onCheckedChange={(checked) => setIncludeSummaryPage(checked as boolean)}
                            />
                            <Label htmlFor="summary-page" className="font-normal">
                              Include summary page
                            </Label>
                          </div>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-2 gap-4">
                      <Button
                        variant="outline"
                        onClick={() => exportToCSV(true)}
                        disabled={isExporting || (activeColumnCount === 0 && blankColumnCount === 0)}
                        className="gap-2"
                      >
                        <FileSpreadsheet className="size-4" />
                        {isExporting ? "Exporting..." : "Grouped CSV"}
                      </Button>
                      <Button
                        onClick={() => exportToPDF(true)}
                        disabled={isExporting || (activeColumnCount === 0 && blankColumnCount === 0)}
                        className="gap-2"
                      >
                        <FileText className="size-4" />
                        {isExporting ? "Exporting..." : "Grouped PDF"}
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
