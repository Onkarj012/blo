"use client"

import { useState, useMemo, useEffect, useCallback, memo, useRef } from "react"

import {
  MapPin,
  List,
  Filter,
  Search,
  User,
  Phone,
  MapPinned,
  CheckCircle2,
  Clock,
  RotateCcw,
  AlertCircle,
  X,
  ChevronDown,
  LogOut,
  Upload,
  Navigation,
  Sun,
  Moon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"

interface VoterMapProps {
  voters: Voter[]
  userLocation: { lat: number; lng: number } | null
}

// Dynamic import for map to avoid SSR issues
const VoterMap = dynamic<VoterMapProps>(() => import("./VoterMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <MapPin className="mx-auto mb-4 size-12 text-muted-foreground animate-pulse" />
        <p className="text-muted-foreground">Loading map...</p>
      </div>
    </div>
  ),
})

type VoterStatus = "pending" | "done" | "locked" | "revisit" | "wrong_address"
type UserRole = "admin" | "user"
type VisitedFilter = "all" | "visited" | "unvisited"
type Gender = "male" | "female" | "other"

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
  distance?: number
  lat?: number
  lng?: number
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
  areaCluster: string
  phoneOnly: boolean
  includeVague: boolean
  includeMissing: boolean
}

interface FieldDashboardProps {
  user: SessionPayload
}

const statusConfig: Record<VoterStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  pending: { label: "Pending", variant: "secondary", icon: <Clock className="size-3" /> },
  done: { label: "Done", variant: "default", icon: <CheckCircle2 className="size-3" /> },
  locked: { label: "Locked", variant: "outline", icon: <AlertCircle className="size-3" /> },
  revisit: { label: "Revisit", variant: "destructive", icon: <RotateCcw className="size-3" /> },
  wrong_address: { label: "Wrong Address", variant: "destructive", icon: <AlertCircle className="size-3" /> },
}

function StatCard({
  title,
  count,
  icon,
  variant = "default",
}: {
  title: string
  count: number
  icon: React.ReactNode
  variant?: "default" | "secondary" | "destructive" | "outline"
}) {
  return (
    <Card className="flex-1">
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2 ${variant === "default" ? "bg-primary/10 text-primary" : variant === "secondary" ? "bg-secondary text-secondary-foreground" : variant === "destructive" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
            {icon}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-semibold">{count}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

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
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 pt-0">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
      </CardFooter>
    </Card>
  )
}

// Virtualized list component for performance
function VirtualizedVoterList({
  voters,
  onUpdateStatus,
}: {
  voters: Voter[]
  onUpdateStatus?: (voterId: string, status: VoterStatus) => void
}) {
  const ITEM_HEIGHT = 280 // Approximate height of each voter card
  const OVERSCAN = 5 // Number of items to render above/below viewport
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateVisibleRange = () => {
      const scrollTop = container.scrollTop
      const containerHeight = container.clientHeight
      const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN)
      const end = Math.min(
        voters.length,
        Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN
      )
      setVisibleRange({ start, end })
    }

    updateVisibleRange()
    container.addEventListener("scroll", updateVisibleRange)
    window.addEventListener("resize", updateVisibleRange)

    return () => {
      container.removeEventListener("scroll", updateVisibleRange)
      window.removeEventListener("resize", updateVisibleRange)
    }
  }, [voters.length])

  const totalHeight = voters.length * ITEM_HEIGHT
  const visibleVoters = voters.slice(visibleRange.start, visibleRange.end)

  return (
    <div
      ref={containerRef}
      className="relative overflow-auto"
      style={{ height: "calc(100vh - 20rem)" }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleVoters.map((voter, index) => (
          <div
            key={voter._id}
            style={{
              position: "absolute",
              top: (visibleRange.start + index) * ITEM_HEIGHT,
              left: 0,
              right: 0,
            }}
          >
            <VoterCard voter={voter} onUpdateStatus={onUpdateStatus} />
          </div>
        ))}
      </div>
    </div>
  )
}

const VoterCard = memo(({ voter, onUpdateStatus }: { voter: Voter; onUpdateStatus?: (voterId: string, status: VoterStatus) => void }) => {
  const status = statusConfig[voter.status]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{voter.name}</CardTitle>
            <CardDescription className="line-clamp-1">
              {voter.displayAddress}
            </CardDescription>
          </div>
          <Badge variant={status.variant} className="gap-1">
            {status.icon}
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">Area:</span>{" "}
            {voter.areaCluster}
          </div>
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">Age:</span>{" "}
            {voter.age} yrs
          </div>
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">Gender:</span>{" "}
            {voter.gender}
          </div>
          {voter.phoneNumber && (
            <div className="text-muted-foreground">
              <span className="font-medium text-foreground">Phone:</span>{" "}
              {voter.phoneNumber}
            </div>
          )}
          {voter.relativeName && (
            <div className="col-span-2 text-muted-foreground">
              <span className="font-medium text-foreground">
                {voter.relativeType}:
              </span>{" "}
              {voter.relativeName}
            </div>
          )}
          {voter.distance !== undefined && (
            <div className="col-span-2 text-xs text-muted-foreground">
              Distance: {voter.distance.toFixed(2)} km
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 pt-0">
        {voter.status !== "done" && (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => onUpdateStatus?.(voter._id, "done")}
          >
            <CheckCircle2 className="mr-1 size-4" />
            Mark Done
          </Button>
        )}
        {voter.status !== "pending" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUpdateStatus?.(voter._id, "pending")}
          >
            <RotateCcw className="mr-1 size-4" />
            Pending
          </Button>
        )}
        {voter.status !== "revisit" && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onUpdateStatus?.(voter._id, "revisit")}
          >
            <RotateCcw className="mr-1 size-4" />
            Revisit
          </Button>
        )}
        <Button
          variant={voter.visited ? "default" : "outline"}
          size="sm"
          onClick={() => onUpdateStatus?.(voter._id, voter.status)}
        >
          {voter.visited ? "Unvisit" : "Visit"}
        </Button>
        {voter.phoneNumber && (
          <a href={`tel:${voter.phoneNumber}`}>
            <Button variant="outline" size="sm">
              <Phone className="mr-1 size-4" />
              Call
            </Button>
          </a>
        )}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            voter.displayAddress
          )}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm">
            <Navigation className="mr-1 size-4" />
            Map
          </Button>
        </a>
      </CardFooter>
    </Card>
  )
})

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="size-8">
        <Sun className="size-4" />
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  )
}

export function FieldDashboard({ user }: FieldDashboardProps) {
  const router = useRouter()
  const [voters, setVoters] = useState<Voter[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  
  // Pending filters (what user is typing)
  const [pendingFilters, setPendingFilters] = useState<Filters>({
    status: "all",
    visited: "all",
    name: "",
    phone: "",
    address: "",
    gender: "",
    minAge: "",
    maxAge: "",
    areaCluster: "",
    phoneOnly: false,
    includeVague: false,
    includeMissing: false,
  })

  // Applied filters (what was last submitted)
  const [appliedFilters, setAppliedFilters] = useState<Filters>(pendingFilters)
  const [activeTab, setActiveTab] = useState("list")
  const [isApplying, setIsApplying] = useState(false)

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          })
        },
        () => {
          console.log("Location access denied or unavailable")
        }
      )
    }
  }, [])

  // Fetch voters from API
  const fetchVoters = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (appliedFilters.status && appliedFilters.status !== "all") params.set("status", appliedFilters.status)
      if (appliedFilters.visited !== "all") params.set("visited", appliedFilters.visited)
      if (appliedFilters.name) params.set("name", appliedFilters.name)
      if (appliedFilters.phone) params.set("phone", appliedFilters.phone)
      if (appliedFilters.address) params.set("address", appliedFilters.address)
      if (appliedFilters.gender) params.set("gender", appliedFilters.gender)
      if (appliedFilters.minAge) params.set("minAge", appliedFilters.minAge)
      if (appliedFilters.maxAge) params.set("maxAge", appliedFilters.maxAge)
      if (appliedFilters.areaCluster) params.set("areaCluster", appliedFilters.areaCluster)
      if (appliedFilters.phoneOnly) params.set("phoneOnly", "true")
      if (appliedFilters.includeVague) params.set("includeVague", "true")
      if (appliedFilters.includeMissing) params.set("includeMissing", "true")
      if (location) {
        params.set("lat", location.lat.toString())
        params.set("lng", location.lng.toString())
        params.set("radius", "2000")
      }

      const response = await fetch(`/api/voters/nearby?${params.toString()}`)
      if (!response.ok) throw new Error("Failed to fetch")
      const data = await response.json()
      setVoters(data.items || [])
    } catch (error) {
      console.error("Error fetching voters:", error)
      toast.error("Failed to load voters")
    } finally {
      setIsLoading(false)
      setIsApplying(false)
    }
  }, [appliedFilters, location])

  // Initial fetch on mount
  useEffect(() => {
    fetchVoters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleApplyFilters() {
    setIsApplying(true)
    setAppliedFilters(pendingFilters)
    // fetchVoters will be called by the useEffect when appliedFilters changes
  }

  // Refetch when appliedFilters change
  useEffect(() => {
    fetchVoters()
  }, [appliedFilters, fetchVoters])

  async function handleUpdateStatus(voterId: string, status: VoterStatus) {
    try {
      const response = await fetch(`/api/voters/${voterId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) throw new Error("Failed to update")
      
      toast.success("Status updated")
      fetchVoters()
    } catch (error) {
      console.error("Error updating status:", error)
      toast.error("Failed to update status")
    }
  }

  const areaClusters = useMemo(() => {
    const clusters = new Set<string>()
    voters.forEach((voter: Voter) => clusters.add(voter.areaCluster))
    return Array.from(clusters).sort()
  }, [voters])

  const filteredVoters = useMemo(() => {
    return voters.filter((voter: Voter) => {
      if (appliedFilters.status !== "all" && voter.status !== appliedFilters.status) return false
      if (appliedFilters.visited === "visited" && !voter.visited) return false
      if (appliedFilters.visited === "unvisited" && voter.visited) return false
      if (appliedFilters.name && !voter.name.toLowerCase().includes(appliedFilters.name.toLowerCase())) return false
      if (appliedFilters.phone && !voter.phoneNumber?.includes(appliedFilters.phone)) return false
      if (appliedFilters.address && !voter.displayAddress.toLowerCase().includes(appliedFilters.address.toLowerCase())) return false
      if (appliedFilters.gender && voter.gender.toLowerCase() !== appliedFilters.gender.toLowerCase()) return false
      if (appliedFilters.minAge && parseInt(voter.age) < parseInt(appliedFilters.minAge)) return false
      if (appliedFilters.maxAge && parseInt(voter.age) > parseInt(appliedFilters.maxAge)) return false
      if (appliedFilters.areaCluster && voter.areaCluster !== appliedFilters.areaCluster) return false
      if (appliedFilters.phoneOnly && !voter.phoneNumber) return false
      return true
    })
  }, [voters, appliedFilters])

  const stats = useMemo(() => {
    const total = voters.length
    const pending = voters.filter((v: Voter) => v.status === "pending").length
    const done = voters.filter((v: Voter) => v.status === "done").length
    const revisit = voters.filter((v: Voter) => v.status === "revisit").length
    const other = voters.filter((v: Voter) => !["pending", "done", "revisit"].includes(v.status)).length
    return { total, pending, done, revisit, other }
  }, [voters])

  const clearFilters = () => {
    const cleared = {
      status: "all" as const,
      visited: "all" as const,
      name: "",
      phone: "",
      address: "",
      gender: "",
      minAge: "",
      maxAge: "",
      areaCluster: "",
      phoneOnly: false,
      includeVague: false,
      includeMissing: false,
    }
    setPendingFilters(cleared)
    setAppliedFilters(cleared)
  }

  const hasActiveFilters =
    appliedFilters.status !== "all" ||
    appliedFilters.visited !== "all" ||
    appliedFilters.name ||
    appliedFilters.phone ||
    appliedFilters.address ||
    appliedFilters.gender ||
    appliedFilters.minAge ||
    appliedFilters.maxAge ||
    appliedFilters.areaCluster ||
    appliedFilters.phoneOnly ||
    appliedFilters.includeVague ||
    appliedFilters.includeMissing

  const hasPendingChanges =
    pendingFilters.status !== appliedFilters.status ||
    pendingFilters.visited !== appliedFilters.visited ||
    pendingFilters.name !== appliedFilters.name ||
    pendingFilters.phone !== appliedFilters.phone ||
    pendingFilters.address !== appliedFilters.address ||
    pendingFilters.gender !== appliedFilters.gender ||
    pendingFilters.minAge !== appliedFilters.minAge ||
    pendingFilters.maxAge !== appliedFilters.maxAge ||
    pendingFilters.areaCluster !== appliedFilters.areaCluster ||
    pendingFilters.phoneOnly !== appliedFilters.phoneOnly ||
    pendingFilters.includeVague !== appliedFilters.includeVague ||
    pendingFilters.includeMissing !== appliedFilters.includeMissing

  const updatePendingFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setPendingFilters((prev) => ({ ...prev, [key]: value }))
  }

  const FilterContent = ({ showApply = false }: { showApply?: boolean }) => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Search by Name</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Enter voter name..."
            value={pendingFilters.name}
            onChange={(e) => updatePendingFilter("name", e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Phone Number</Label>
        <div className="relative">
          <Phone className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by phone..."
            value={pendingFilters.phone}
            onChange={(e) => updatePendingFilter("phone", e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Address</Label>
        <div className="relative">
          <MapPinned className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by address..."
            value={pendingFilters.address}
            onChange={(e) => updatePendingFilter("address", e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={pendingFilters.status}
            onValueChange={(value) => updatePendingFilter("status", value as Filters["status"])}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
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
          <Select
            value={pendingFilters.visited}
            onValueChange={(value) => updatePendingFilter("visited", value as VisitedFilter)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="visited">Visited</SelectItem>
              <SelectItem value="unvisited">Unvisited</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Gender</Label>
          <Select
            value={pendingFilters.gender}
            onValueChange={(value) => updatePendingFilter("gender", value || "")}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Genders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Genders</SelectItem>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Area Cluster</Label>
          <Popover>
            <PopoverTrigger className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
              {pendingFilters.areaCluster || "All Areas"}
              <ChevronDown className="size-4 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search area..." />
                <CommandList>
                  <CommandEmpty>No area found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="all"
                      onSelect={() => updatePendingFilter("areaCluster", "")}
                    >
                      All Areas
                    </CommandItem>
                    {areaClusters.map((cluster) => (
                      <CommandItem
                        key={cluster}
                        value={cluster}
                        onSelect={() => updatePendingFilter("areaCluster", cluster)}
                      >
                        {cluster}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Min Age</Label>
          <Input
            type="number"
            placeholder="Min age"
            value={pendingFilters.minAge}
            onChange={(e) => updatePendingFilter("minAge", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Max Age</Label>
          <Input
            type="number"
            placeholder="Max age"
            value={pendingFilters.maxAge}
            onChange={(e) => updatePendingFilter("maxAge", e.target.value)}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="phone-only">Phone available only</Label>
          <Switch
            id="phone-only"
            checked={pendingFilters.phoneOnly}
            onCheckedChange={(checked) => updatePendingFilter("phoneOnly", checked)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="include-vague">Include vague addresses</Label>
          <Switch
            id="include-vague"
            checked={pendingFilters.includeVague}
            onCheckedChange={(checked) => updatePendingFilter("includeVague", checked)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="include-missing">Include missing addresses</Label>
          <Switch
            id="include-missing"
            checked={pendingFilters.includeMissing}
            onCheckedChange={(checked) => updatePendingFilter("includeMissing", checked)}
          />
        </div>
      </div>

      {showApply && (
        <>
          <Separator />
          <Button 
            className="w-full" 
            onClick={handleApplyFilters}
            disabled={!hasPendingChanges || isApplying}
          >
            {isApplying ? "Applying..." : hasPendingChanges ? "Apply Filters" : "Filters Applied"}
          </Button>
          {hasActiveFilters && (
            <Button variant="outline" className="w-full" onClick={clearFilters}>
              <X className="mr-1 size-4" />
              Clear All
            </Button>
          )}
        </>
      )}
    </div>
  )

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="size-5 text-primary" />
              <h1 className="font-semibold">Field Dashboard</h1>
            </div>
            <Badge variant="outline" className="hidden sm:inline-flex">
              {user.role === "admin" ? "Admin" : "Field Agent"}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{user.displayName}</p>
              <p className="text-xs text-muted-foreground">{user.username}</p>
            </div>
            <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <User className="size-4" />
            </div>
            {user.role === "admin" && (
            <a href="/upload">
              <Button variant="outline" size="sm">
                <Upload className="mr-1 size-4" />
                Upload
              </Button>
            </a>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Stats Cards */}
        <div className="container px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              title="Total"
              count={stats.total}
              icon={<User className="size-5" />}
            />
            <StatCard
              title="Pending"
              count={stats.pending}
              icon={<Clock className="size-5" />}
              variant="secondary"
            />
            <StatCard
              title="Done"
              count={stats.done}
              icon={<CheckCircle2 className="size-5" />}
              variant="default"
            />
            <StatCard
              title="Revisit"
              count={stats.revisit}
              icon={<RotateCcw className="size-5" />}
              variant="destructive"
            />
            <StatCard
              title="Other"
              count={stats.other}
              icon={<AlertCircle className="size-5" />}
              variant="outline"
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="container px-4 pb-8">
          <div className="flex gap-6">
            {/* Desktop Sidebar Filters */}
            <div className="hidden w-64 shrink-0 lg:block">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Filter className="size-4" />
                    Filters
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <FilterContent showApply={true} />
                </CardContent>
              </Card>
            </div>

            {/* Main Content Area */}
            <div className="flex-1">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="mb-4 flex items-center justify-between">
                  <TabsList>
                    <TabsTrigger value="list" className="gap-1">
                      <List className="size-4" />
                      List
                    </TabsTrigger>
                    <TabsTrigger value="map" className="gap-1">
                      <MapPin className="size-4" />
                      Map
                    </TabsTrigger>
                  </TabsList>

                  {/* Mobile Filter Button */}
                  <Sheet>
                    <SheetTrigger className="lg:hidden inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground h-8 px-3">
                      <Filter className="size-4" />
                      Filters
                      {hasActiveFilters && (
                        <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                          Active
                        </Badge>
                      )}
                    </SheetTrigger>
                    <SheetContent side="left" className="w-full sm:max-w-md">
                      <SheetHeader>
                        <SheetTitle>Filters</SheetTitle>
                        <SheetDescription>
                          Refine your voter search
                        </SheetDescription>
                      </SheetHeader>
                      <ScrollArea className="h-[calc(100vh-12rem)] pr-4">
                        <div className="py-4">
                          <FilterContent showApply={true} />
                        </div>
                      </ScrollArea>
                    </SheetContent>
                  </Sheet>
                </div>

                <TabsContent value="list" className="mt-0">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {isLoading ? "Loading..." : `${filteredVoters.length} voters found`}
                    </p>
                    {hasActiveFilters && (
                      <Button variant="ghost" size="sm" onClick={clearFilters}>
                        <X className="mr-1 size-4" />
                        Clear
                      </Button>
                    )}
                  </div>

                  {isLoading ? (
                    <div className="space-y-4">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <VoterCardSkeleton key={i} />
                      ))}
                    </div>
                  ) : filteredVoters.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Search className="mb-4 size-12 text-muted-foreground" />
                      <h3 className="text-lg font-semibold">No voters found</h3>
                      <p className="text-sm text-muted-foreground">
                        Try adjusting your filters or upload a CSV file
                      </p>
                      {hasActiveFilters && (
                        <Button
                          variant="outline"
                          className="mt-4"
                          onClick={clearFilters}
                        >
                          Clear Filters
                        </Button>
                      )}
                    </div>
                  ) : (
                    <VirtualizedVoterList
                      voters={filteredVoters}
                      onUpdateStatus={handleUpdateStatus}
                    />
                  )}
                </TabsContent>

                <TabsContent value="map" className="mt-0">
                  <Card className="h-[calc(100vh-16rem)]">
                    <VoterMap 
                      voters={filteredVoters} 
                      userLocation={location}
                    />
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
