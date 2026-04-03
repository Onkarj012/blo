"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SessionPayload } from "@/lib/auth";

interface Voter {
  _id: string;
  name: string;
  status: "pending" | "done" | "locked" | "revisit" | "wrong_address";
  visited: boolean;
  areaCluster: string;
  displayAddress: string;
  phoneNumber?: string;
  age: string;
  gender: string;
  relativeName?: string;
  relativeType?: string;
  epicNumber?: string;
  distance?: number;
}

interface Filters {
  status: string;
  visited: "all" | "visited" | "unvisited";
  name: string;
  phone: string;
  address: string;
  gender: string;
  minAge: string;
  maxAge: string;
  areaCluster: string;
  phoneOnly: boolean;
  includeVague: boolean;
  includeMissing: boolean;
}

interface FieldDashboardProps {
  user: SessionPayload;
}

export function FieldDashboard({ user }: FieldDashboardProps) {
  const router = useRouter();
  const [voters, setVoters] = useState<Voter[]>([]);
  const [counts, setCounts] = useState({
    pending: 0,
    done: 0,
    locked: 0,
    revisit: 0,
    wrong_address: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  
  const [filters, setFilters] = useState<Filters>({
    status: "pending",
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
  });

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => {
          console.log("Location access denied or unavailable");
        }
      );
    }
  }, []);

  const fetchVoters = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.visited !== "all") params.set("visited", filters.visited);
      if (filters.name) params.set("name", filters.name);
      if (filters.phone) params.set("phone", filters.phone);
      if (filters.address) params.set("address", filters.address);
      if (filters.gender) params.set("gender", filters.gender);
      if (filters.minAge) params.set("minAge", filters.minAge);
      if (filters.maxAge) params.set("maxAge", filters.maxAge);
      if (filters.areaCluster) params.set("areaCluster", filters.areaCluster);
      if (filters.phoneOnly) params.set("phoneOnly", "true");
      if (filters.includeVague) params.set("includeVague", "true");
      if (filters.includeMissing) params.set("includeMissing", "true");
      if (location) {
        params.set("lat", location.lat.toString());
        params.set("lng", location.lng.toString());
        params.set("radius", "2000"); // 2km default
      }

      const response = await fetch(`/api/voters/nearby?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setVoters(data.items || []);
      setCounts(data.counts || counts);
    } catch (error) {
      console.error("Error fetching voters:", error);
    } finally {
      setLoading(false);
    }
  }, [filters, location]);

  useEffect(() => {
    fetchVoters();
  }, [fetchVoters]);

  async function updateVoter(voterId: string, updates: { status?: Voter["status"]; visited?: boolean }) {
    try {
      const response = await fetch(`/api/voters/${voterId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error("Failed to update");

      const data = await response.json();
      setCounts(data.counts);
      
      // Update local state
      setVoters((prev) =>
        prev.map((v) => (v._id === voterId ? { ...v, ...updates } : v))
      );
    } catch (error) {
      console.error("Error updating voter:", error);
    }
  }

  const canMarkDone = (status: string) => status !== "done";
  const canMarkPending = (status: string) => status !== "pending";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900">Field Voter Finder</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user.displayName}</span>
              {user.role === "admin" && (
                <a
                  href="/upload"
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                >
                  Upload
                </a>
              )}
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/login");
                }}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Logout
              </button>
            </div>
          </div>

          {/* View Toggle */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setView("list")}
              className={`px-4 py-2 rounded text-sm font-medium ${
                view === "list"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              List
            </button>
            <button
              onClick={() => setView("map")}
              className={`px-4 py-2 rounded text-sm font-medium ${
                view === "map"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Map
            </button>
          </div>

          {/* Stats */}
          <div className="mt-4 grid grid-cols-5 gap-2 text-center">
            <div className="bg-blue-50 rounded p-2">
              <div className="text-lg font-bold text-blue-600">{counts.total}</div>
              <div className="text-xs text-gray-600">Total</div>
            </div>
            <div className="bg-yellow-50 rounded p-2">
              <div className="text-lg font-bold text-yellow-600">{counts.pending}</div>
              <div className="text-xs text-gray-600">Pending</div>
            </div>
            <div className="bg-green-50 rounded p-2">
              <div className="text-lg font-bold text-green-600">{counts.done}</div>
              <div className="text-xs text-gray-600">Done</div>
            </div>
            <div className="bg-purple-50 rounded p-2">
              <div className="text-lg font-bold text-purple-600">{counts.revisit}</div>
              <div className="text-xs text-gray-600">Revisit</div>
            </div>
            <div className="bg-red-50 rounded p-2">
              <div className="text-lg font-bold text-red-600">{counts.locked + counts.wrong_address}</div>
              <div className="text-xs text-gray-600">Other</div>
            </div>
          </div>

          {/* Quick Status Filters */}
          <div className="mt-4 flex flex-wrap gap-2">
            {["all", "pending", "done", "locked", "revisit", "wrong_address"].map((status) => (
              <button
                key={status}
                onClick={() => setFilters(f => ({ ...f, status }))}
                className={`px-3 py-1 text-sm rounded capitalize ${
                  filters.status === status
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                {status.replace("_", " ")}
              </button>
            ))}
          </div>

          {/* Visited Filter */}
          <div className="mt-2 flex gap-2">
            {(["all", "visited", "unvisited"] as const).map((visited) => (
              <button
                key={visited}
                onClick={() => setFilters(f => ({ ...f, visited }))}
                className={`px-3 py-1 text-xs rounded capitalize ${
                  filters.visited === visited
                    ? "bg-teal-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {visited}
              </button>
            ))}
          </div>

          {/* Advanced Filters Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="mt-4 text-sm text-indigo-600 hover:text-indigo-800"
          >
            {showFilters ? "Hide" : "Show"} Advanced Filters
          </button>

          {/* Advanced Filters */}
          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Name contains..."
                  value={filters.name}
                  onChange={(e) => setFilters(f => ({ ...f, name: e.target.value }))}
                  className="px-3 py-2 border rounded text-sm"
                />
                <input
                  type="text"
                  placeholder="Phone contains..."
                  value={filters.phone}
                  onChange={(e) => setFilters(f => ({ ...f, phone: e.target.value }))}
                  className="px-3 py-2 border rounded text-sm"
                />
                <input
                  type="text"
                  placeholder="Address contains..."
                  value={filters.address}
                  onChange={(e) => setFilters(f => ({ ...f, address: e.target.value }))}
                  className="px-3 py-2 border rounded text-sm"
                />
                <input
                  type="text"
                  placeholder="Locality/Society"
                  value={filters.areaCluster}
                  onChange={(e) => setFilters(f => ({ ...f, areaCluster: e.target.value }))}
                  className="px-3 py-2 border rounded text-sm"
                />
              </div>
              
              <div className="grid grid-cols-4 gap-4">
                <select
                  value={filters.gender}
                  onChange={(e) => setFilters(f => ({ ...f, gender: e.target.value }))}
                  className="px-3 py-2 border rounded text-sm"
                >
                  <option value="">All Genders</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
                <input
                  type="number"
                  placeholder="Min Age"
                  value={filters.minAge}
                  onChange={(e) => setFilters(f => ({ ...f, minAge: e.target.value }))}
                  className="px-3 py-2 border rounded text-sm"
                />
                <input
                  type="number"
                  placeholder="Max Age"
                  value={filters.maxAge}
                  onChange={(e) => setFilters(f => ({ ...f, maxAge: e.target.value }))}
                  className="px-3 py-2 border rounded text-sm"
                />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.phoneOnly}
                    onChange={(e) => setFilters(f => ({ ...f, phoneOnly: e.target.checked }))}
                  />
                  Phone available only
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.includeVague}
                    onChange={(e) => setFilters(f => ({ ...f, includeVague: e.target.checked }))}
                  />
                  Include vague addresses
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.includeMissing}
                    onChange={(e) => setFilters(f => ({ ...f, includeMissing: e.target.checked }))}
                  />
                  Include missing addresses
                </label>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading...</div>
        ) : voters.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No voters found matching your filters
          </div>
        ) : view === "list" ? (
          <div className="space-y-4">
            {voters.map((voter) => (
              <VoterCard
                key={voter._id}
                voter={voter}
                onUpdate={updateVoter}
              />
            ))}
          </div>
        ) : (
          <MapView voters={voters} location={location} />
        )}
      </main>
    </div>
  );
}

function VoterCard({ voter, onUpdate }: { voter: Voter; onUpdate: (id: string, updates: Partial<Voter>) => void }) {
  return (
    <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{voter.name}</h3>
            {voter.visited && (
              <span className="px-2 py-0.5 text-xs bg-teal-100 text-teal-800 rounded">
                Visited
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600">{voter.displayAddress}</p>
          <p className="text-sm text-gray-500">
            {voter.areaCluster} • {voter.age} yrs • {voter.gender}
          </p>
          {voter.relativeName && (
            <p className="text-sm text-gray-500">
              {voter.relativeType}: {voter.relativeName}
            </p>
          )}
          {voter.phoneNumber && (
            <a
              href={`tel:${voter.phoneNumber}`}
              className="text-sm text-indigo-600 hover:underline"
            >
              {voter.phoneNumber}
            </a>
          )}
          {voter.distance && (
            <p className="text-sm text-gray-400">
              {(voter.distance / 1000).toFixed(1)} km away
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 items-end">
          <span
            className={`px-2 py-1 text-xs rounded capitalize ${
              voter.status === "done"
                ? "bg-green-100 text-green-800"
                : voter.status === "pending"
                ? "bg-yellow-100 text-yellow-800"
                : voter.status === "revisit"
                ? "bg-purple-100 text-purple-800"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {voter.status.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        {voter.status !== "done" && (
          <button
            onClick={() => onUpdate(voter._id, { status: "done" })}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
          >
            Mark Done
          </button>
        )}
        {voter.status !== "pending" && (
          <button
            onClick={() => onUpdate(voter._id, { status: "pending" })}
            className="px-3 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700"
          >
            Mark Pending
          </button>
        )}
        <button
          onClick={() => onUpdate(voter._id, { visited: !voter.visited })}
          className={`px-3 py-1 text-xs rounded ${
            voter.visited
              ? "bg-gray-600 text-white hover:bg-gray-700"
              : "bg-teal-600 text-white hover:bg-teal-700"
          }`}
        >
          {voter.visited ? "Unvisit" : "Mark Visited"}
        </button>
        {voter.status !== "revisit" && (
          <button
            onClick={() => onUpdate(voter._id, { status: "revisit" })}
            className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Revisit
          </button>
        )}
        {voter.status !== "locked" && (
          <button
            onClick={() => onUpdate(voter._id, { status: "locked" })}
            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
          >
            Locked
          </button>
        )}
        {voter.status !== "wrong_address" && (
          <button
            onClick={() => onUpdate(voter._id, { status: "wrong_address" })}
            className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Wrong Addr
          </button>
        )}
        {voter.phoneNumber && (
          <a
            href={`tel:${voter.phoneNumber}`}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Call
          </a>
        )}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            voter.displayAddress
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          Navigate
        </a>
      </div>
    </div>
  );
}

function MapView({ voters, location }: { voters: Voter[]; location: { lat: number; lng: number } | null }) {
  return (
    <div className="bg-gray-100 rounded-lg p-8 text-center">
      <p className="text-gray-600">Map view coming soon with Leaflet integration</p>
      <p className="text-sm text-gray-500 mt-2">
        Showing {voters.length} voters
        {location && ` near your location (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`}
      </p>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from(new Set(voters.map(v => v.areaCluster))).slice(0, 8).map(cluster => (
          <div key={cluster} className="bg-white p-3 rounded shadow text-sm">
            <div className="font-medium truncate">{cluster}</div>
            <div className="text-gray-500">
              {voters.filter(v => v.areaCluster === cluster).length} voters
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
