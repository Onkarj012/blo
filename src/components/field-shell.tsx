"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState, startTransition } from "react";

import { VoterCard } from "@/components/voter-card";
import type { DashboardStats, NearbyVoter, StatusFilter, VoterStatus } from "@/lib/types";

type NearbyResponse = {
  items: NearbyVoter[];
  counts: Record<StatusFilter, number>;
};

const FILTERS: Array<{ label: string; value: StatusFilter }> = [
  { label: "Pending only", value: "pending" },
  { label: "All", value: "all" },
  { label: "Done", value: "done" },
  { label: "Revisit", value: "revisit" },
];

const RADII = [600, 1200, 2000];

function getDeviceId(): string {
  const existing = window.localStorage.getItem("field-voter-device-id");
  if (existing) {
    return existing;
  }
  const created = crypto.randomUUID();
  window.localStorage.setItem("field-voter-device-id", created);
  return created;
}

function formatCount(count: number): string {
  return new Intl.NumberFormat("en-IN").format(count);
}

export function FieldShell({ initialStats }: { initialStats: DashboardStats }) {
  const [deviceId, setDeviceId] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [radiusMeters, setRadiusMeters] = useState(1200);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState("Finding your location...");
  const [nearby, setNearby] = useState<NearbyResponse>({
    items: [],
    counts: {
      all: initialStats.total,
      pending: initialStats.pending,
      done: initialStats.done,
      revisit: initialStats.revisit,
    },
  });
  const [todayQueue, setTodayQueue] = useState<NearbyVoter[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isQueueSaving, setIsQueueSaving] = useState(false);
  const [savingIds, setSavingIds] = useState<number[]>([]);

  const deferredLocation = useDeferredValue(location);
  const queueIds = new Set(todayQueue.map((item) => item.id));

  function updateCardsWithQueue(queuedIds: Set<number>) {
    setNearby((current) => ({
      ...current,
      items: current.items.map((item) => ({
        ...item,
        queue_selected: queuedIds.has(item.id),
      })),
    }));
  }

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setLocationLabel("Location is unavailable on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        startTransition(() => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setLocationLabel("Using live phone location");
        });
      },
      () => {
        setLocationLabel("Location blocked. Showing area-based results.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }

  useEffect(() => {
    setDeviceId(getDeviceId());
    requestLocation();
  }, []);

  useEffect(() => {
    if (!deviceId) {
      return;
    }

    void (async () => {
      const response = await fetch("/api/today-queue", {
        headers: { "x-device-id": deviceId },
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { items: NearbyVoter[] };
      startTransition(() => {
        setTodayQueue(payload.items);
        updateCardsWithQueue(new Set(payload.items.map((item) => item.id)));
      });
    })();
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) {
      return;
    }

    void (async () => {
      setIsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          status_filter: statusFilter,
          radius_m: String(radiusMeters),
          limit: "80",
        });
        if (deferredLocation) {
          params.set("lat", String(deferredLocation.lat));
          params.set("lng", String(deferredLocation.lng));
        }
        const response = await fetch(`/api/voters/nearby?${params.toString()}`, {
          headers: { "x-device-id": deviceId },
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Unable to load nearby voters.");
        }
        const payload = (await response.json()) as NearbyResponse;
        startTransition(() => {
          setNearby(payload);
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load voters.");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [deviceId, statusFilter, radiusMeters, deferredLocation]);

  async function refreshTodayQueue() {
    if (!deviceId) {
      return;
    }
    const response = await fetch("/api/today-queue", {
      headers: { "x-device-id": deviceId },
      cache: "no-store",
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { items: NearbyVoter[] };
    startTransition(() => {
      setTodayQueue(payload.items);
      updateCardsWithQueue(new Set(payload.items.map((item) => item.id)));
    });
  }

  async function refreshNearby() {
    if (!deviceId) {
      return;
    }
    const params = new URLSearchParams({
      status_filter: statusFilter,
      radius_m: String(radiusMeters),
      limit: "80",
    });
    if (location) {
      params.set("lat", String(location.lat));
      params.set("lng", String(location.lng));
    }
    const response = await fetch(`/api/voters/nearby?${params.toString()}`, {
      headers: { "x-device-id": deviceId },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Unable to load nearby voters.");
    }
    const payload = (await response.json()) as NearbyResponse;
    startTransition(() => {
      setNearby(payload);
    });
  }

  async function updateStatusWithRetry(voterId: number, status: VoterStatus) {
    setSavingIds((current) => [...current, voterId]);
    const previousNearby = nearby;
    const previousQueue = todayQueue;

    startTransition(() => {
      setNearby((current) => ({
        ...current,
        items:
          statusFilter === "pending"
            ? current.items.filter((item) => item.id !== voterId)
            : current.items.map((item) =>
                item.id === voterId ? { ...item, status } : item
              ),
      }));
      setTodayQueue((current) =>
        current.map((item) => (item.id === voterId ? { ...item, status } : item))
      );
    });

    async function sendUpdate() {
      const response = await fetch(`/api/voters/${voterId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error("Status update failed.");
      }
    }

    try {
      try {
        await sendUpdate();
      } catch {
        await sendUpdate();
      }
      await Promise.all([refreshNearby(), refreshTodayQueue()]);
    } catch (statusError) {
      startTransition(() => {
        setNearby(previousNearby);
        setTodayQueue(previousQueue);
      });
      setError(statusError instanceof Error ? statusError.message : "Status update failed.");
    } finally {
      setSavingIds((current) => current.filter((value) => value !== voterId));
    }
  }

  async function toggleQueue(voterId: number) {
    if (!deviceId) {
      return;
    }

    setIsQueueSaving(true);
    const previousQueue = todayQueue;
    const nextIds = queueIds.has(voterId)
      ? todayQueue.filter((item) => item.id !== voterId).map((item) => item.id)
      : [...todayQueue.map((item) => item.id), voterId];

    updateCardsWithQueue(new Set(nextIds));

    try {
      const response = await fetch("/api/today-queue", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-id": deviceId,
        },
        body: JSON.stringify({ voterIds: nextIds }),
      });
      if (!response.ok) {
        throw new Error("Queue update failed.");
      }
      await refreshTodayQueue();
    } catch (queueError) {
      startTransition(() => {
        setTodayQueue(previousQueue);
        updateCardsWithQueue(new Set(previousQueue.map((item) => item.id)));
      });
      setError(queueError instanceof Error ? queueError.message : "Queue update failed.");
    } finally {
      setIsQueueSaving(false);
    }
  }

  return (
    <main className="px-4 py-5 sm:px-6">
      <div className="field-shell space-y-4">
        <section className="glass-card rounded-[30px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-label">Field voter finder</p>
              <h1 className="mt-2 text-[2.4rem] leading-none font-semibold tracking-[-0.07em] text-[var(--ink)]">
                Walk smarter.
              </h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-[var(--muted)]">
                Nearby households, quick status updates, and a pinned Today queue
                built for door-to-door form collection.
              </p>
            </div>
            <Link
              href="/upload"
              className="rounded-full border border-[var(--line)] bg-white/75 px-4 py-2 text-sm font-medium text-[var(--ink)]"
            >
              Upload CSV
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-[22px] bg-[var(--paper-strong)] p-4">
              <p className="section-label">Pending</p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {formatCount(nearby.counts.pending)}
              </p>
            </div>
            <div className="rounded-[22px] bg-white/70 p-4">
              <p className="section-label">Imported</p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {formatCount(initialStats.total)}
              </p>
            </div>
          </div>
        </section>

        <section className="glass-card rounded-[28px] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-label">Location</p>
              <p className="mt-1 text-sm font-medium text-[var(--ink)]">{locationLabel}</p>
            </div>
            <button
              type="button"
              onClick={requestLocation}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            >
              Refresh
            </button>
          </div>

          <div className="soft-scroll mt-4 flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => startTransition(() => setStatusFilter(filter.value))}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${
                  statusFilter === filter.value
                    ? "bg-[var(--sun)] text-white"
                    : "border border-[var(--line)] bg-white/70 text-[var(--ink)]"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="soft-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
            {RADII.map((radius) => (
              <button
                key={radius}
                type="button"
                onClick={() => startTransition(() => setRadiusMeters(radius))}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm ${
                  radiusMeters === radius
                    ? "bg-[var(--accent)] text-white"
                    : "border border-[var(--line)] bg-white/70 text-[var(--muted)]"
                }`}
              >
                {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}
              </button>
            ))}
          </div>
        </section>

        <section className="glass-card rounded-[28px] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-label">Today queue</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {todayQueue.length} pinned house{todayQueue.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="rounded-full bg-[var(--paper-strong)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
              {isQueueSaving ? "Saving..." : "Ready"}
            </span>
          </div>

          {todayQueue.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              Pin voters from the list below to build today&apos;s route.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {todayQueue.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="rounded-[18px] border border-[var(--line)] bg-white/70 px-4 py-3"
                >
                  <p className="font-medium text-[var(--ink)]">{item.name}</p>
                  <p className="text-sm text-[var(--muted)]">{item.display_address}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {error ? (
          <section className="rounded-[22px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </section>
        ) : null}

        <section className="space-y-3 pb-6">
          {isLoading ? (
            <div className="glass-card rounded-[28px] p-5 text-sm text-[var(--muted)]">
              Loading nearby voters...
            </div>
          ) : nearby.items.length === 0 ? (
            <div className="glass-card rounded-[28px] p-5 text-sm text-[var(--muted)]">
              No voters found for this filter yet. Try a wider radius or switch filters.
            </div>
          ) : (
            nearby.items.map((voter) => (
              <VoterCard
                key={voter.id}
                voter={{ ...voter, queue_selected: queueIds.has(voter.id) }}
                isSaving={savingIds.includes(voter.id)}
                onUpdateStatus={updateStatusWithRetry}
                onToggleQueue={toggleQueue}
              />
            ))
          )}
        </section>
      </div>
    </main>
  );
}
