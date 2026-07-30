"use client"

import { useState, useMemo, useEffect, useLayoutEffect, useCallback, memo, useRef, useSyncExternalStore } from "react"
import {
  MapPin, List, Filter, Search, User, Phone, MapPinned,
  CheckCircle2, Clock, RotateCcw, AlertCircle, X, ChevronDown,
  LogOut, Upload, Navigation, Sun, Moon, Download, ChevronUp,
  MoreHorizontal, FileSpreadsheet, FileText, Edit2, AlertTriangle,
} from "lucide-react"
import { List as VirtualList, useDynamicRowHeight, type RowComponentProps } from "react-window"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import { ExportDialog } from "./ExportDialog"
import { downloadAreaCSV, downloadAreaPDF } from "@/lib/export/engine"

interface VoterMapProps {
  voters: Voter[]
  userLocation: { lat: number; lng: number } | null
}

const VoterMap = dynamic<VoterMapProps>(() => import("./VoterMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <MapPin className="mx-auto mb-4 size-12 text-muted-foreground animate-pulse" />
        <p className="text-muted-foreground">Loading map…</p>
      </div>
    </div>
  ),
})

// ── Types ─────────────────────────────────────────────────────────────────────

type VoterStatus = "pending" | "done" | "locked" | "revisit" | "wrong_address"
type UserRole = "admin" | "user"
type VisitedFilter = "all" | "visited" | "unvisited"

interface Voter {
  _id: string
  name: string
  status: VoterStatus
  visited?: boolean
  areaCluster: string
  displayAddress: string
  phoneNumber?: string
  age: string
  gender: string
  relativeName?: string
  relativeType?: string
  epicNumber?: string
  partNumber?: string
  partSerialNumber?: string
  distance?: number
  lat?: number
  lng?: number
  addressQuality?: "actionable" | "vague" | "missing"
  areaClusterNeedsReview?: boolean
  areaClusterSuggested?: string
}

interface ClusterSummary {
  name: string
  total: number
  pending: number
  done: number
  locked: number
  revisit: number
  wrong_address: number
}

interface SessionPayload {
  userId: string
  username: string
  role: UserRole
  displayName: string
}

interface Filters {
  status: VoterStatus | "all"
  visited: VisitedFilter
  name: string
  phone: string
  address: string
  gender: string
  minAge: string
  maxAge: string
  phoneOnly: boolean
  includeVague: boolean
  includeMissing: boolean
  needsReview: boolean
}

interface FieldDashboardProps {
  user: SessionPayload
}

const INITIAL_FILTERS: Filters = {
  status: "all",
  visited: "all",
  name: "",
  phone: "",
  address: "",
  gender: "",
  minAge: "",
  maxAge: "",
  phoneOnly: false,
  includeVague: false,
  includeMissing: false,
  needsReview: false,
}

// ── Status config ──────────────────────────────────────────────────────────────

const statusConfig: Record<VoterStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  pending: { label: "Pending", variant: "secondary", icon: <Clock className="size-3" /> },
  done: { label: "Done", variant: "default", icon: <CheckCircle2 className="size-3" /> },
  locked: { label: "Locked", variant: "outline", icon: <AlertCircle className="size-3" /> },
  revisit: { label: "Revisit", variant: "destructive", icon: <RotateCcw className="size-3" /> },
  wrong_address: { label: "Wrong Address", variant: "destructive", icon: <AlertCircle className="size-3" /> },
}

// ── Layout measurement helper ────────────────────────────────────────────────
// Measures the live top offset (viewport px) of a scroll container so its
// height can be derived from the *actual* rendered layout above it, instead
// of a guessed fixed rem value. Combined with `dvh` this keeps exactly one
// scroll region on mobile: the list/map fills to the real bottom of the
// viewport instead of over- or under-shooting it.

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

function useMeasuredTop<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [top, setTop] = useState(0)

  // Re-measure after every commit so layout changes above the container
  // (header wrapping, stats collapsing, filter bar height, etc.) are picked
  // up immediately.
  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setTop(prev => (Math.abs(prev - rect.top) > 0.5 ? rect.top : prev))
  })

  // Also react to things that don't trigger a React re-render.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setTop(prev => (Math.abs(prev - rect.top) > 0.5 ? rect.top : prev))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    window.addEventListener("resize", measure)
    window.addEventListener("orientationchange", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
      window.removeEventListener("orientationchange", measure)
    }
  }, [])

  return [ref, top] as const
}

// Fills from the measured top offset down to the real viewport bottom,
// leaving room for the page's own bottom padding + iOS safe area.
function fillHeightStyle(top: number, minPx = 240): React.CSSProperties {
  return { height: `max(${minPx}px, calc(100dvh - ${top}px - 1rem - env(safe-area-inset-bottom)))` }
}

// ── StatCard ───────────────────────────────────────────────────────────────────

function StatCard({ title, count, icon, variant = "default" }: {
  title: string; count: number; icon: React.ReactNode
  variant?: "default" | "secondary" | "destructive" | "outline"
}) {
  const styles = {
    default: "bg-primary/15 text-primary",
    secondary: "bg-secondary text-secondary-foreground",
    destructive: "bg-destructive/15 text-destructive",
    outline: "bg-muted text-muted-foreground",
  }
  return (
    <Card className="hover:shadow-md transition-shadow glass-surface">
      <CardContent className="flex items-center gap-2.5 p-3 sm:gap-4 sm:p-5">
        <div className={`shrink-0 rounded-xl p-2 sm:p-3 ${styles[variant]}`}>{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground sm:mb-1 sm:text-sm">{title}</p>
          <p className="text-xl font-bold tracking-tight tabular-nums sm:text-3xl">{count}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ── VoterRowSkeleton ──────────────────────────────────────────────────────────

function VoterRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border rounded-lg">
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-60" />
      </div>
      <Skeleton className="h-7 w-14" />
    </div>
  )
}

// ── VoterCardSkeleton ──────────────────────────────────────────────────────────

function VoterCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 pt-0">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
      </CardFooter>
    </Card>
  )
}

// ── VoterRow ──────────────────────────────────────────────────────────────────

const VoterRow = memo(({ voter, onUpdateStatus }: {
  voter: Voter
  onUpdateStatus?: (id: string, s: VoterStatus) => void
}) => {
  const status = statusConfig[voter.status]
  const needsReview = voter.areaClusterNeedsReview || voter.areaCluster.startsWith("Uncertain:")

  return (
    <div className="flex items-start gap-2 rounded-lg border border-l-4 border-l-transparent px-3 py-2.5 transition-colors hover:border-l-primary hover:bg-muted/30 sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="max-w-[60vw] truncate font-medium text-sm sm:max-w-none">{voter.name}</span>
          {needsReview && <AlertTriangle className="size-3 shrink-0 text-amber-500" />}
          <Badge variant={status.variant} className="shrink-0 gap-1 px-1.5 py-0 text-[10px]">
            {status.icon} {status.label}
          </Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className="max-w-[55vw] truncate sm:max-w-xs">{voter.areaCluster}</span>
          {voter.partNumber && (
            <span className="hidden shrink-0 sm:inline">
              · Part {voter.partNumber}{voter.partSerialNumber ? ` / ${voter.partSerialNumber}` : ""}
            </span>
          )}
          <span className="shrink-0">· {voter.age}y</span>
          <span className="hidden shrink-0 capitalize sm:inline">{voter.gender.charAt(0).toUpperCase()}</span>
          {voter.phoneNumber && (
            <span className="hidden shrink-0 font-mono sm:inline">· {voter.phoneNumber}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        {voter.phoneNumber && (
          <a href={`tel:${voter.phoneNumber}`}>
            <Button variant="ghost" size="icon" className="size-11 touch-manipulation sm:size-7">
              <Phone className="size-4 sm:size-3.5" />
            </Button>
          </a>
        )}
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(voter.displayAddress)}`} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="icon" className="size-11 touch-manipulation sm:size-7">
            <Navigation className="size-4 sm:size-3.5" />
          </Button>
        </a>
        {voter.status !== "done" ? (
          <Button size="sm" className="h-11 touch-manipulation px-3 text-xs sm:h-7 sm:px-2.5" onClick={() => onUpdateStatus?.(voter._id, "done")}>
            Done
          </Button>
        ) : (
          <span className="flex items-center gap-1 px-1 text-xs font-medium text-primary">
            <CheckCircle2 className="size-3.5" />Done
          </span>
        )}
      </div>
    </div>
  )
})
VoterRow.displayName = "VoterRow"

// ── VirtualizedVoterList ───────────────────────────────────────────────────────
// Real (measured) row heights: each row's actual rendered height is observed
// via ResizeObserver (through react-window's dynamic row-height cache) and
// used to position subsequent rows. The compact/detail constants below are
// only the *initial estimate* for not-yet-measured rows — real content can be
// (and at phone widths, will be) taller than that estimate.

interface VoterRowData {
  voters: Voter[]
  onUpdateStatus?: (id: string, s: VoterStatus) => void
  onUpdateArea?: (id: string, area: string) => void
  areaNames: string[]
  detailView: boolean
}

function VirtualRow({ index, style, voters, onUpdateStatus, onUpdateArea, areaNames, detailView }: RowComponentProps<VoterRowData>) {
  const voter = voters[index]
  if (!voter) return null
  return (
    <div style={style} className="px-0.5 pb-2">
      {detailView
        ? <VoterCard voter={voter} onUpdateStatus={onUpdateStatus} onUpdateArea={onUpdateArea} areaNames={areaNames} />
        : <VoterRow voter={voter} onUpdateStatus={onUpdateStatus} />
      }
    </div>
  )
}

function VirtualizedVoterList({ voters, onUpdateStatus, onUpdateArea, areaNames, detailView }: {
  voters: Voter[]
  onUpdateStatus?: (id: string, s: VoterStatus) => void
  onUpdateArea?: (id: string, area: string) => void
  areaNames: string[]
  detailView: boolean
}) {
  const [containerRef, top] = useMeasuredTop<HTMLDivElement>()
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: detailView ? 340 : 76,
    key: detailView ? "detail" : "compact",
  })
  const rowProps = useMemo<VoterRowData>(
    () => ({ voters, onUpdateStatus, onUpdateArea, areaNames, detailView }),
    [voters, onUpdateStatus, onUpdateArea, areaNames, detailView]
  )

  return (
    <div ref={containerRef} style={fillHeightStyle(top)} className="overscroll-contain">
      <VirtualList
        rowComponent={VirtualRow}
        rowCount={voters.length}
        rowHeight={rowHeight}
        rowProps={rowProps}
        overscanCount={6}
        className="soft-scroll"
        style={{ height: "100%" }}
      />
    </div>
  )
}

// ── GroupedVoterList ───────────────────────────────────────────────────────────

function GroupedVoterList({ voters, onUpdateStatus, onUpdateArea, areaNames, detailView }: {
  voters: Voter[]
  onUpdateStatus?: (id: string, s: VoterStatus) => void
  onUpdateArea?: (id: string, area: string) => void
  areaNames: string[]
  detailView: boolean
}) {
  const [containerRef, top] = useMeasuredTop<HTMLDivElement>()
  const groups = useMemo(() => {
    const map = new Map<string, Voter[]>()
    voters.forEach(v => {
      if (!map.has(v.areaCluster)) map.set(v.areaCluster, [])
      map.get(v.areaCluster)!.push(v)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [voters])

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.map(([n]) => n)))

  const toggle = (name: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s })

  return (
    <div
      ref={containerRef}
      style={fillHeightStyle(top)}
      className="soft-scroll overflow-auto overscroll-contain space-y-3"
    >
      {groups.map(([area, areaVoters]) => {
        const isOpen = expanded.has(area)
        const pending = areaVoters.filter(v => v.status === "pending").length
        const done = areaVoters.filter(v => v.status === "done").length
        const revisit = areaVoters.filter(v => v.status === "revisit").length

        return (
          <div key={area} className="rounded-xl border overflow-hidden">
            <div className="flex items-center justify-between p-3.5 hover:bg-muted/50 transition-colors">
              <button onClick={() => toggle(area)} className="flex flex-1 items-center gap-3 py-1 text-left touch-manipulation">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary font-semibold text-sm tabular-nums shrink-0">
                  {areaVoters.length}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{area}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1"><Clock className="size-3" />{pending}</span>
                    <span className="flex items-center gap-1"><CheckCircle2 className="size-3" />{done}</span>
                    <span className="flex items-center gap-1"><RotateCcw className="size-3" />{revisit}</span>
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex size-11 items-center justify-center rounded-md touch-manipulation hover:bg-accent hover:text-accent-foreground transition-colors sm:size-8">
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => downloadAreaCSV(area, areaVoters)} className="gap-2">
                      <FileSpreadsheet className="size-4" />Export CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => downloadAreaPDF(area, areaVoters)} className="gap-2">
                      <FileText className="size-4" />Export PDF
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button onClick={() => toggle(area)} className="flex size-11 items-center justify-center rounded touch-manipulation hover:bg-muted sm:size-8">
                  {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                </button>
              </div>
            </div>
            {isOpen && (
              <div className={`border-t bg-muted/20 p-3 ${detailView ? "space-y-3" : "space-y-1.5"}`}>
                {areaVoters.map(voter => detailView
                  ? <VoterCard key={voter._id} voter={voter} onUpdateStatus={onUpdateStatus} onUpdateArea={onUpdateArea} areaNames={areaNames} />
                  : <VoterRow key={voter._id} voter={voter} onUpdateStatus={onUpdateStatus} />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── VoterCard ──────────────────────────────────────────────────────────────────

const VoterCard = memo(({ voter, onUpdateStatus, onUpdateArea, areaNames }: {
  voter: Voter
  onUpdateStatus?: (id: string, s: VoterStatus) => void
  onUpdateArea?: (id: string, area: string) => void
  areaNames: string[]
}) => {
  const status = statusConfig[voter.status]
  const needsReview = voter.areaClusterNeedsReview || voter.areaCluster.startsWith("Uncertain:")
  const [areaOpen, setAreaOpen] = useState(false)
  const [areaSearch, setAreaSearch] = useState("")

  const filteredAreas = areaNames.filter(a => a.toLowerCase().includes(areaSearch.toLowerCase()))

  return (
    <Card className="hover:shadow-md transition-shadow border-l-4 border-l-transparent hover:border-l-primary">
      <CardHeader className="pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg font-semibold leading-tight mb-1">{voter.name}</CardTitle>
            <CardDescription className="text-sm leading-relaxed line-clamp-2">{voter.displayAddress}</CardDescription>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {needsReview && (
              <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0.5 text-amber-500 border-amber-500/50">
                <AlertTriangle className="size-3" /> Review
              </Badge>
            )}
            <Badge variant={status.variant} className="gap-1.5 px-2.5 py-1 text-xs font-medium">
              {status.icon} {status.label}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium min-w-[40px]">Area:</span>
            <span className="text-foreground truncate">{voter.areaCluster}</span>
            {onUpdateArea && (
              <Popover open={areaOpen} onOpenChange={setAreaOpen}>
                <PopoverTrigger
                  className="ml-1 rounded p-2.5 text-muted-foreground transition-colors touch-manipulation hover:bg-muted hover:text-foreground sm:p-0.5"
                  title="Reassign area"
                >
                  <Edit2 className="size-3" />
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search areas…" value={areaSearch} onValueChange={setAreaSearch} />
                    <CommandList>
                      <CommandEmpty>No area found.</CommandEmpty>
                      {areaSearch.trim() && !areaNames.some((area) => area.toLowerCase() === areaSearch.trim().toLowerCase()) && (
                        <CommandGroup heading="New area">
                          <CommandItem
                            value={`new-${areaSearch.trim()}`}
                            onSelect={() => {
                              onUpdateArea(voter._id, areaSearch.trim())
                              setAreaOpen(false)
                              setAreaSearch("")
                            }}
                          >
                            Use “{areaSearch.trim()}”
                          </CommandItem>
                        </CommandGroup>
                      )}
                      <CommandGroup>
                        {filteredAreas.slice(0, 30).map(area => (
                          <CommandItem
                            key={area}
                            value={area}
                            onSelect={() => {
                              onUpdateArea(voter._id, area)
                              setAreaOpen(false)
                              setAreaSearch("")
                            }}
                          >
                            {area}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium min-w-[40px]">Age:</span>
            <span className="text-foreground tabular-nums">{voter.age} yrs</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium min-w-[40px]">Gender:</span>
            <span className="text-foreground capitalize">{voter.gender}</span>
          </div>
          {voter.phoneNumber && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium min-w-[40px]">Phone:</span>
              <span className="text-foreground font-mono text-xs tabular-nums">{voter.phoneNumber}</span>
            </div>
          )}
          {voter.relativeName && (
            <div className="col-span-1 flex items-center gap-2 sm:col-span-2">
              <span className="text-muted-foreground font-medium min-w-[80px]">{voter.relativeType}:</span>
              <span className="text-foreground">{voter.relativeName}</span>
            </div>
          )}
          {voter.distance !== undefined && (
            <div className="col-span-1 flex items-center gap-2 text-xs sm:col-span-2">
              <span className="text-muted-foreground font-medium">Distance:</span>
              <span className="text-muted-foreground tabular-nums">{voter.distance.toFixed(2)} km</span>
            </div>
          )}
        </div>

        {/* Apply suggestion */}
        {voter.areaClusterSuggested && voter.areaClusterSuggested !== voter.areaCluster && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm">
            <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
            <span className="text-muted-foreground">Suggested: <strong className="text-foreground">{voter.areaClusterSuggested}</strong></span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-9 touch-manipulation px-2 text-xs sm:h-7"
              onClick={() => onUpdateArea?.(voter._id, voter.areaClusterSuggested!)}
            >
              Apply
            </Button>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-2 pt-0 pb-4 px-4">
        <div className="flex w-full flex-wrap gap-2">
          {voter.status !== "done" ? (
            <Button size="sm" className="h-11 min-w-[140px] flex-1 touch-manipulation" onClick={() => onUpdateStatus?.(voter._id, "done")}>
              <CheckCircle2 className="mr-1.5 size-4" />Mark Done
            </Button>
          ) : (
            <div className="flex h-11 flex-1 min-w-[140px] items-center justify-center gap-1.5 rounded-md bg-primary/10 px-3 text-sm font-medium text-primary">
              <CheckCircle2 className="size-4" />Done
            </div>
          )}
          {voter.phoneNumber && (
            <a href={`tel:${voter.phoneNumber}`}>
              <Button variant="outline" size="icon" className="size-11 shrink-0 touch-manipulation"><Phone className="size-4" /></Button>
            </a>
          )}
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(voter.displayAddress)}`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="icon" className="size-11 shrink-0 touch-manipulation"><Navigation className="size-4" /></Button>
          </a>
        </div>
        <div className="flex w-full flex-wrap gap-1.5">
          {voter.status !== "pending" && (
            <Button variant="outline" size="sm" className="h-11 min-w-[100px] flex-1 touch-manipulation text-sm sm:h-9 sm:text-xs sm:px-2" onClick={() => onUpdateStatus?.(voter._id, "pending")}>Pending</Button>
          )}
          {voter.status !== "revisit" && (
            <Button variant="secondary" size="sm" className="h-11 min-w-[100px] flex-1 touch-manipulation text-sm sm:h-9 sm:text-xs sm:px-2" onClick={() => onUpdateStatus?.(voter._id, "revisit")}>Revisit</Button>
          )}
          <Button
            variant={voter.visited ? "default" : "outline"}
            size="sm"
            className="h-11 min-w-[100px] flex-1 touch-manipulation text-sm sm:h-9 sm:text-xs sm:px-2"
            onClick={() => onUpdateStatus?.(voter._id, voter.status)}
          >
            {voter.visited ? "Unvisit" : "Visit"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
})
VoterCard.displayName = "VoterCard"

// ── AreaPanel ──────────────────────────────────────────────────────────────────

function AreaPanel({ clusters, selectedAreas, onToggle, onSelectAll, onClearAll }: {
  clusters: ClusterSummary[]
  selectedAreas: Set<string>
  onToggle: (area: string) => void
  onSelectAll: () => void
  onClearAll: () => void
}) {
  const [search, setSearch] = useState("")
  const filtered = clusters.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="font-semibold">Areas</Label>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-9 touch-manipulation px-2.5 text-xs sm:h-6 sm:px-2" onClick={onSelectAll}>All</Button>
          <Button variant="ghost" size="sm" className="h-9 touch-manipulation px-2.5 text-xs sm:h-6 sm:px-2" onClick={onClearAll}>Clear</Button>
        </div>
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <Input
          placeholder="Search areas…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>
      <ScrollArea className="h-56">
        <div className="space-y-0.5 pr-1">
          {filtered.map(cluster => {
            const pct = cluster.total > 0 ? Math.round((cluster.done / cluster.total) * 100) : 0
            return (
              <label
                key={cluster.name}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 cursor-pointer touch-manipulation hover:bg-muted/50 transition-colors sm:py-1.5"
              >
                <Checkbox
                  checked={selectedAreas.has(cluster.name)}
                  onCheckedChange={() => onToggle(cluster.name)}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-tight truncate">{cluster.name}</p>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {cluster.done}/{cluster.total}
                </div>
              </label>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No areas found</p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ── ThemeToggle ────────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  if (!mounted) return <Button variant="ghost" size="icon" className="size-11 touch-manipulation sm:size-8"><Sun className="size-4" /></Button>

  return (
    <Button variant="ghost" size="icon" className="size-11 touch-manipulation sm:size-8" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}

// ── FilterPanel ────────────────────────────────────────────────────────────────
// Hoisted out of FieldDashboard's render body: previously this was defined as
// a component *inside* the render function, so React saw a new component
// type on every render and remounted it — dropping input focus and any local
// state every keystroke. As a real top-level component its identity is
// stable across renders.

function FilterPanel({
  clusterSummary, selectedAreas, onToggleArea, onSelectAllAreas, onClearAllAreas,
  filters, onUpdateFilter, hasActiveFilters, onClearFilters,
}: {
  clusterSummary: ClusterSummary[]
  selectedAreas: Set<string>
  onToggleArea: (area: string) => void
  onSelectAllAreas: () => void
  onClearAllAreas: () => void
  filters: Filters
  onUpdateFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Area checklist */}
      {clusterSummary.length > 0 && (
        <>
          <AreaPanel
            clusters={clusterSummary}
            selectedAreas={selectedAreas}
            onToggle={onToggleArea}
            onSelectAll={onSelectAllAreas}
            onClearAll={onClearAllAreas}
          />
          <Separator />
        </>
      )}

      {/* Text search filters */}
      <div className="space-y-2">
        <Label>Name</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Enter voter name…" value={filters.name} onChange={e => onUpdateFilter("name", e.target.value)} className="pl-9" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Phone</Label>
        <div className="relative">
          <Phone className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Search by phone…" value={filters.phone} onChange={e => onUpdateFilter("phone", e.target.value)} className="pl-9" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Address</Label>
        <div className="relative">
          <MapPinned className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Search by address…" value={filters.address} onChange={e => onUpdateFilter("address", e.target.value)} className="pl-9" />
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={filters.status} onValueChange={v => onUpdateFilter("status", v as Filters["status"])}>
            <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="locked">Locked</SelectItem>
              <SelectItem value="revisit">Revisit</SelectItem>
              <SelectItem value="wrong_address">Wrong Address</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Visited</Label>
          <Select value={filters.visited} onValueChange={v => onUpdateFilter("visited", v as VisitedFilter)}>
            <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="visited">Visited</SelectItem>
              <SelectItem value="unvisited">Unvisited</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Gender</Label>
        <Select value={filters.gender || ""} onValueChange={v => onUpdateFilter("gender", v ?? "")}>
          <SelectTrigger><SelectValue placeholder="All Genders" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Genders</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Min Age</Label>
          <Input type="number" placeholder="Min" value={filters.minAge} onChange={e => onUpdateFilter("minAge", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Max Age</Label>
          <Input type="number" placeholder="Max" value={filters.maxAge} onChange={e => onUpdateFilter("maxAge", e.target.value)} />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        {[
          { id: "phone-only", label: "Phone available only", key: "phoneOnly" as const },
          { id: "incl-vague", label: "Include vague addresses", key: "includeVague" as const },
          { id: "incl-missing", label: "Include missing addresses", key: "includeMissing" as const },
          { id: "needs-review", label: "Needs review only", key: "needsReview" as const },
        ].map(opt => (
          <div key={opt.id} className="flex items-center justify-between">
            <Label htmlFor={opt.id}>{opt.label}</Label>
            <Switch id={opt.id} checked={filters[opt.key]} onCheckedChange={v => onUpdateFilter(opt.key, v)} />
          </div>
        ))}
      </div>

      {hasActiveFilters && (
        <>
          <Separator />
          <Button variant="outline" className="w-full h-11 touch-manipulation sm:h-9" onClick={onClearFilters}>
            <X className="mr-1 size-4" />Clear All Filters
          </Button>
        </>
      )}
    </div>
  )
}

// ── MapTabContent ──────────────────────────────────────────────────────────────

function MapTabContent({ voters, location }: { voters: Voter[]; location: { lat: number; lng: number } | null }) {
  const [containerRef, top] = useMeasuredTop<HTMLDivElement>()
  return (
    <div ref={containerRef} style={fillHeightStyle(top, 320)}>
      <Card className="h-full overflow-hidden">
        <VoterMap voters={voters} userLocation={location} />
      </Card>
    </div>
  )
}

// ── FieldDashboard ─────────────────────────────────────────────────────────────

export function FieldDashboard({ user }: FieldDashboardProps) {
  const router = useRouter()
  const [voters, setVoters] = useState<Voter[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set())
  const [clusterSummary, setClusterSummary] = useState<ClusterSummary[]>([])
  const [activeTab, setActiveTab] = useState("list")
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [statsCollapsed, setStatsCollapsed] = useState(false)
  const [detailView, setDetailView] = useState(false)

  // Location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      )
    }
  }, [])

  // Fetch cluster summary (for area panel) once on mount
  useEffect(() => {
    fetch("/api/clusters/summary")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.clusters) setClusterSummary(data.clusters) })
      .catch(() => {})
  }, [])

  // Load all voters — only location triggers refetch (for distance computation)
  const fetchVoters = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      // No status/filter params: load everything, filter client-side
      params.set("includeVague", "true")
      params.set("includeMissing", "true")
      params.set("limit", "2000")
      if (location) {
        params.set("lat", location.lat.toString())
        params.set("lng", location.lng.toString())
        // No radius — just compute distance, don't restrict
      }
      const res = await fetch(`/api/voters/nearby?${params.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      setVoters(data.items ?? [])
    } catch {
      toast.error("Failed to load voters")
    } finally {
      setIsLoading(false)
    }
  }, [location])

  useEffect(() => { fetchVoters() }, [fetchVoters])

  // Update status
  async function handleUpdateStatus(voterId: string, status: VoterStatus) {
    try {
      const res = await fetch(`/api/voters/${voterId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Status updated")
      fetchVoters()
    } catch {
      toast.error("Failed to update status")
    }
  }

  // Update area (Plan 04)
  async function handleUpdateArea(voterId: string, areaCluster: string) {
    try {
      const res = await fetch(`/api/voters/${voterId}/area`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaCluster }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success(`Area reassigned to "${areaCluster}"`)
      fetchVoters()
    } catch {
      toast.error("Failed to update area")
    }
  }

  // Area names for reassign dropdown — derive from loaded voters + cluster summary
  const areaNames = useMemo(() => {
    const fromSummary = clusterSummary.map(c => c.name)
    const fromVoters = Array.from(new Set(voters.map(v => v.areaCluster)))
    return Array.from(new Set([...fromSummary, ...fromVoters])).sort()
  }, [clusterSummary, voters])

  // Client-side filter
  const filteredVoters = useMemo(() => {
    return voters.filter(voter => {
      // Area filter
      if (selectedAreas.size > 0 && !selectedAreas.has(voter.areaCluster)) return false
      // Status
      if (filters.status !== "all" && voter.status !== filters.status) return false
      // Visited
      if (filters.visited === "visited" && !voter.visited) return false
      if (filters.visited === "unvisited" && voter.visited) return false
      // Address quality toggles
      if (!filters.includeVague && voter.addressQuality === "vague") return false
      if (!filters.includeMissing && voter.addressQuality === "missing") return false
      // Text filters
      if (filters.name && !voter.name.toLowerCase().includes(filters.name.toLowerCase())) return false
      if (filters.phone && !voter.phoneNumber?.includes(filters.phone)) return false
      if (filters.address && !voter.displayAddress.toLowerCase().includes(filters.address.toLowerCase())) return false
      // Gender
      if (filters.gender && voter.gender.toLowerCase() !== filters.gender.toLowerCase()) return false
      // Age
      if (filters.minAge && parseInt(voter.age) < parseInt(filters.minAge)) return false
      if (filters.maxAge && parseInt(voter.age) > parseInt(filters.maxAge)) return false
      // Phone only
      if (filters.phoneOnly && !voter.phoneNumber) return false
      // Needs review (Plan 04)
      if (filters.needsReview && !voter.areaClusterNeedsReview && !voter.areaCluster.startsWith("Uncertain:")) return false
      return true
    })
  }, [voters, filters, selectedAreas])

  // Stats from all loaded voters (not filtered — overall picture)
  const stats = useMemo(() => ({
    total: voters.length,
    pending: voters.filter(v => v.status === "pending").length,
    done: voters.filter(v => v.status === "done").length,
    revisit: voters.filter(v => v.status === "revisit").length,
    other: voters.filter(v => !["pending", "done", "revisit"].includes(v.status)).length,
  }), [voters])

  const hasActiveFilters = Boolean(
    filters.status !== "all" || filters.visited !== "all" || filters.name || filters.phone ||
    filters.address || filters.gender || filters.minAge || filters.maxAge || filters.phoneOnly ||
    filters.includeVague || filters.includeMissing || filters.needsReview || selectedAreas.size > 0
  )

  const updateFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters(prev => ({ ...prev, [key]: value })), [])

  const clearFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS)
    setSelectedAreas(new Set())
  }, [])

  const toggleArea = useCallback((area: string) =>
    setSelectedAreas(prev => { const s = new Set(prev); s.has(area) ? s.delete(area) : s.add(area); return s }), [])

  const selectAllAreas = useCallback(() => setSelectedAreas(new Set(clusterSummary.map(c => c.name))), [clusterSummary])
  const clearAllAreas = useCallback(() => setSelectedAreas(new Set()), [])

  // Filter labels for PDF export
  const filterLabels = useMemo(() => {
    const labels: string[] = []
    if (selectedAreas.size > 0) labels.push(`Areas: ${Array.from(selectedAreas).join(", ")}`)
    if (filters.status !== "all") labels.push(`Status: ${filters.status}`)
    if (filters.name) labels.push(`Name: ${filters.name}`)
    if (filters.gender) labels.push(`Gender: ${filters.gender}`)
    return labels
  }, [selectedAreas, filters])

  // Show grouped list when 2+ areas selected
  const showGrouped = selectedAreas.size >= 2

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      {/* Dark texture background */}
      <div className="pointer-events-none fixed inset-0 -z-10 hidden dark:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(680px_360px_at_50%_-8%,rgba(255,255,255,0.06),transparent_70%)]" />
        <div className="bg-grid-texture absolute inset-0 opacity-50" />
      </div>
      {/* Light texture background */}
      <div className="pointer-events-none fixed inset-0 -z-10 block dark:hidden" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(680px_360px_at_50%_-8%,rgba(0,0,0,0.03),transparent_70%)]" />
        <div className="bg-grid-texture-light absolute inset-0 opacity-60" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 glass-header pt-[env(safe-area-inset-top)]">
        <div className="container mx-auto flex h-14 items-center justify-between gap-2 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <MapPin className="size-5 shrink-0 text-primary" />
              <h1 className="truncate font-semibold text-sm sm:text-base">Field Dashboard</h1>
            </div>
            <Badge variant="outline" className="hidden sm:inline-flex">
              {user.role === "admin" ? "Admin" : "Field Agent"}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <ThemeToggle />

            {/* Desktop identity + actions */}
            <div className="hidden items-center gap-3 sm:flex">
              <div className="text-right">
                <p className="text-sm font-medium">{user.displayName}</p>
                <p className="text-xs text-muted-foreground">{user.username}</p>
              </div>
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <User className="size-4" />
              </div>
              {user.role === "admin" && (
                <a href="/upload">
                  <Button variant="outline" size="sm">
                    <Upload className="mr-1 size-4" />Upload
                  </Button>
                </a>
              )}
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="size-4" />
              </Button>
            </div>

            {/* Mobile overflow menu — Upload / logout / identity collapse in here */}
            <DropdownMenu>
              <DropdownMenuTrigger className="-mr-1.5 inline-flex size-11 items-center justify-center rounded-md touch-manipulation hover:bg-accent hover:text-accent-foreground transition-colors sm:hidden">
                <MoreHorizontal className="size-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-1.5 py-1.5">
                  <p className="text-sm font-medium">{user.displayName}</p>
                  <p className="text-xs text-muted-foreground">{user.username} · {user.role === "admin" ? "Admin" : "Field Agent"}</p>
                </div>
                <DropdownMenuSeparator />
                {user.role === "admin" && (
                  <DropdownMenuItem onClick={() => router.push("/upload")} className="gap-2">
                    <Upload className="size-4" />Upload
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleLogout} className="gap-2">
                  <LogOut className="size-4" />Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Stats */}
        <div className="container mx-auto px-4 pt-4 pb-2">
          <button
            onClick={() => setStatsCollapsed(v => !v)}
            className="flex min-h-11 items-center gap-1.5 mb-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full touch-manipulation sm:min-h-0"
          >
            {statsCollapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            <span className="font-medium">Overview</span>
            {statsCollapsed && (
              <span className="ml-1 text-foreground font-medium">
                {stats.total} total · {stats.pending} pending · {stats.done} done · {stats.revisit} revisit
              </span>
            )}
          </button>
          {!statsCollapsed && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
              <StatCard title="Total" count={stats.total} icon={<User className="size-4 sm:size-5" />} />
              <StatCard title="Pending" count={stats.pending} icon={<Clock className="size-4 sm:size-5" />} variant="secondary" />
              <StatCard title="Done" count={stats.done} icon={<CheckCircle2 className="size-4 sm:size-5" />} variant="default" />
              <StatCard title="Revisit" count={stats.revisit} icon={<RotateCcw className="size-4 sm:size-5" />} variant="destructive" />
              <StatCard title="Other" count={stats.other} icon={<AlertCircle className="size-4 sm:size-5" />} variant="outline" />
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="container mx-auto px-4 pb-4 sm:pb-10">
          <div className="flex gap-8">
            {/* Desktop sidebar */}
            <div className="hidden w-72 shrink-0 lg:block">
              <Card className="sticky top-20 glass-surface">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Filter className="size-5" />Filters
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-[calc(100dvh-14rem)]">
                    <div className="pr-2">
                      <FilterPanel
                        clusterSummary={clusterSummary}
                        selectedAreas={selectedAreas}
                        onToggleArea={toggleArea}
                        onSelectAllAreas={selectAllAreas}
                        onClearAllAreas={clearAllAreas}
                        filters={filters}
                        onUpdateFilter={updateFilter}
                        hasActiveFilters={hasActiveFilters}
                        onClearFilters={clearFilters}
                      />
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Right content */}
            <div className="flex-1 min-w-0">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4">
                  <TabsList className="h-11 sm:h-8">
                    <TabsTrigger value="list" className="gap-1">
                      <List className="size-4" /><span className="hidden sm:inline">List</span>
                    </TabsTrigger>
                    <TabsTrigger value="map" className="gap-1">
                      <MapPin className="size-4" /><span className="hidden sm:inline">Map</span>
                    </TabsTrigger>
                  </TabsList>

                  {/* Mobile filter button */}
                  <Sheet>
                    <SheetTrigger className="lg:hidden inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground h-11 px-3 touch-manipulation sm:h-8">
                      <Filter className="size-4" /><span className="hidden sm:inline">Filters</span>
                      {hasActiveFilters && <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">Active</Badge>}
                    </SheetTrigger>
                    <SheetContent side="left" className="flex w-full flex-col sm:max-w-md">
                      <SheetHeader>
                        <SheetTitle>Filters</SheetTitle>
                        <SheetDescription>Refine your voter search</SheetDescription>
                      </SheetHeader>
                      <ScrollArea className="min-h-0 flex-1 px-4">
                        <div className="pb-4">
                          <FilterPanel
                            clusterSummary={clusterSummary}
                            selectedAreas={selectedAreas}
                            onToggleArea={toggleArea}
                            onSelectAllAreas={selectAllAreas}
                            onClearAllAreas={clearAllAreas}
                            filters={filters}
                            onUpdateFilter={updateFilter}
                            hasActiveFilters={hasActiveFilters}
                            onClearFilters={clearFilters}
                          />
                        </div>
                      </ScrollArea>
                      <SheetFooter className="flex-row gap-2 border-t pb-[calc(1rem+env(safe-area-inset-bottom))]">
                        <Button variant="outline" className="h-11 flex-1 touch-manipulation" onClick={clearFilters}>
                          Clear all
                        </Button>
                        <SheetClose
                          render={<Button className="h-11 flex-1 touch-manipulation" />}
                        >
                          Show {filteredVoters.length} results
                        </SheetClose>
                      </SheetFooter>
                    </SheetContent>
                  </Sheet>
                </div>

                <TabsContent value="list" className="mt-0">
                  {/* Summary bar */}
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4">
                    <p className="text-sm text-muted-foreground">
                      {isLoading ? "Loading…" : (
                        selectedAreas.size > 0
                          ? `${selectedAreas.size} ${selectedAreas.size === 1 ? "area" : "areas"} · ${filteredVoters.length} voters`
                          : `${filteredVoters.length} voters`
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailView(v => !v)}
                        className="gap-1 h-11 touch-manipulation px-2.5 text-xs sm:h-8"
                        title={detailView ? "Switch to compact view" : "Switch to detailed view"}
                      >
                        {detailView ? <List className="size-3.5" /> : <MoreHorizontal className="size-3.5" />}
                        {detailView ? "Compact" : "Detailed"}
                      </Button>
                      {!isLoading && filteredVoters.length > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setIsExportOpen(true)} className="h-11 touch-manipulation gap-1 sm:h-8">
                          <Download className="size-4" /><span className="hidden sm:inline">Export</span>
                        </Button>
                      )}
                      {hasActiveFilters && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="h-11 touch-manipulation sm:h-8">
                          <X className="mr-1 size-4" /><span className="hidden sm:inline">Clear</span>
                        </Button>
                      )}
                    </div>
                  </div>

                  {isLoading ? (
                    <div className={detailView ? "space-y-4" : "space-y-2"}>
                      {Array.from({ length: 5 }).map((_, i) => detailView ? <VoterCardSkeleton key={i} /> : <VoterRowSkeleton key={i} />)}
                    </div>
                  ) : filteredVoters.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Search className="mb-4 size-12 text-muted-foreground" />
                      <h3 className="text-lg font-semibold">No voters found</h3>
                      <p className="text-sm text-muted-foreground">Try adjusting your filters</p>
                      {hasActiveFilters && (
                        <Button variant="outline" className="mt-4" onClick={clearFilters}>Clear Filters</Button>
                      )}
                    </div>
                  ) : showGrouped ? (
                    <GroupedVoterList
                      voters={filteredVoters}
                      onUpdateStatus={handleUpdateStatus}
                      onUpdateArea={handleUpdateArea}
                      areaNames={areaNames}
                      detailView={detailView}
                    />
                  ) : (
                    <VirtualizedVoterList
                      voters={filteredVoters}
                      onUpdateStatus={handleUpdateStatus}
                      onUpdateArea={handleUpdateArea}
                      areaNames={areaNames}
                      detailView={detailView}
                    />
                  )}
                </TabsContent>

                <TabsContent value="map" className="mt-0">
                  <MapTabContent voters={filteredVoters} location={location} />
                </TabsContent>

              </Tabs>
            </div>
          </div>
        </div>
      </main>

      <ExportDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        voters={filteredVoters}
        filterLabels={filterLabels}
      />
    </div>
  )
}
