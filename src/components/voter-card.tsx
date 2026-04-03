"use client";

import type { NearbyVoter, VoterStatus } from "@/lib/types";

const STATUS_ACTIONS: Array<{ label: string; value: VoterStatus }> = [
  { label: "Done", value: "done" },
  { label: "Locked", value: "locked" },
  { label: "Revisit", value: "revisit" },
  { label: "Wrong", value: "wrong_address" },
];

function formatDistance(distanceMeters: number | null): string {
  if (distanceMeters === null) {
    return "Approx. area match";
  }
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m away`;
  }
  return `${(distanceMeters / 1000).toFixed(1)} km away`;
}

function buildMapsHref(voter: NearbyVoter): string {
  if (voter.lat !== null && voter.lng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${voter.lat},${voter.lng}`
    )}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${voter.display_address}, Pimple Saudagar, Pune`
  )}`;
}

type Props = {
  voter: NearbyVoter;
  isSaving: boolean;
  onUpdateStatus: (id: number, status: VoterStatus) => Promise<void>;
  onToggleQueue: (id: number) => Promise<void>;
};

export function VoterCard({ voter, isSaving, onUpdateStatus, onToggleQueue }: Props) {
  return (
    <article className="glass-card status-ring rounded-[28px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-label">{voter.area_cluster}</p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
            {voter.name || "Unnamed voter"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {voter.display_address}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onToggleQueue(voter.id)}
          className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${
            voter.queue_selected
              ? "bg-[var(--sun)] text-white"
              : "border border-[var(--line)] bg-white/70 text-[var(--ink)]"
          }`}
        >
          {voter.queue_selected ? "Queued" : "Pin today"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
          {formatDistance(voter.distance_meters)}
        </span>
        <span className="rounded-full bg-stone-200 px-3 py-1 text-xs font-semibold text-stone-700">
          {voter.status.replace("_", " ")}
        </span>
        {voter.phone_number ? (
          <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-[var(--ink)]">
            {voter.phone_number}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {voter.phone_number ? (
          <a
            href={`tel:${voter.phone_number}`}
            className="rounded-[18px] bg-[var(--accent)] px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Call
          </a>
        ) : (
          <span className="cursor-not-allowed rounded-[18px] border border-[var(--line)] bg-white/60 px-4 py-3 text-center text-sm font-semibold text-[var(--muted)]">
            No phone
          </span>
        )}
        <a
          href={buildMapsHref(voter)}
          target="_blank"
          rel="noreferrer"
          className="rounded-[18px] border border-[var(--line)] bg-white/70 px-4 py-3 text-center text-sm font-semibold text-[var(--ink)]"
        >
          Navigate
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {STATUS_ACTIONS.map((action) => (
          <button
            key={action.value}
            type="button"
            disabled={isSaving}
            onClick={() => void onUpdateStatus(voter.id, action.value)}
            className="rounded-[16px] border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-medium text-[var(--ink)] disabled:opacity-50"
          >
            Mark {action.label}
          </button>
        ))}
      </div>
    </article>
  );
}
