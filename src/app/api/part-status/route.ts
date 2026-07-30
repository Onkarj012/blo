import { NextResponse } from "next/server";

import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { convexClient } from "@/lib/convex-server";
import { requireAdmin, AuthenticatedRequest } from "@/lib/middleware";

const UPDATE_BATCH_SIZE = 200;

type PartStatusBody = {
  partNumber?: unknown;
  pendingSerialNumbers?: unknown;
};

type PartVoter = {
  _id: Id<"voters">;
  partSerialNumber?: string;
  status: "pending" | "done" | "locked" | "revisit" | "wrong_address";
};

function normalizeSerialNumber(value: string): string {
  const normalized = value.trim().replace(/^0+(?=\d)/, "");
  return normalized || "0";
}

function parsePendingSerialNumbers(value: unknown): {
  serialNumbers?: string[];
  error?: string;
} {
  if (typeof value !== "string") {
    return { error: "pendingSerialNumbers must be a comma-separated string." };
  }

  const tokens = value.split(/[\s,]+/).filter(Boolean);
  const invalid = tokens.filter((token) => !/^\d+$/.test(token));
  if (invalid.length > 0) {
    return {
      error: `Invalid serial number(s): ${invalid.slice(0, 10).join(", ")}`,
    };
  }

  const serialNumbers = Array.from(
    new Set(tokens.map(normalizeSerialNumber))
  );
  if (serialNumbers.length === 0) {
    return { error: "Enter at least one pending serial number." };
  }

  return { serialNumbers };
}

export const POST = requireAdmin(async (request: AuthenticatedRequest) => {
  try {
    const body = (await request.json().catch(() => null)) as PartStatusBody | null;
    const partNumber = typeof body?.partNumber === "string"
      ? body.partNumber.trim()
      : "";

    if (!partNumber) {
      return NextResponse.json(
        { error: "partNumber is required." },
        { status: 400 }
      );
    }

    const parsed = parsePendingSerialNumbers(body?.pendingSerialNumbers);
    if (!parsed.serialNumbers) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const pendingSerialNumbers = new Set(parsed.serialNumbers);
    const voterResult = await convexClient.query(api.voters.getVoters, {
      partNumber,
      includeVague: true,
      includeMissing: true,
      limit: 10000,
    });
    const partVoters = voterResult.items as PartVoter[];
    const sourceSerialNumbers = new Set<string>();
    const updates: Array<{
      voterId: Id<"voters">;
      status: "pending" | "done";
    }> = [];

    for (const voter of partVoters) {
      if (!voter.partSerialNumber) continue;

      const serialNumber = normalizeSerialNumber(voter.partSerialNumber);
      sourceSerialNumbers.add(serialNumber);
      updates.push({
        voterId: voter._id,
        status: pendingSerialNumbers.has(serialNumber) ? "pending" : "done",
      });
    }

    let updated = 0;
    const note = `Part ${partNumber} pending list sync`;
    for (let start = 0; start < updates.length; start += UPDATE_BATCH_SIZE) {
      const result = await convexClient.mutation(api.voters.batchUpdateStatus, {
        updates: updates.slice(start, start + UPDATE_BATCH_SIZE),
        userId: request.user!.userId as Id<"appUsers">,
        note,
      });
      updated += result.updated;
    }

    return NextResponse.json({
      ok: true,
      partNumber,
      totalPartRecords: updates.length,
      pendingRequested: pendingSerialNumbers.size,
      matchedPending: parsed.serialNumbers.filter((serial) =>
        sourceSerialNumbers.has(serial)
      ).length,
      pending: updates.filter((update) => update.status === "pending").length,
      done: updates.filter((update) => update.status === "done").length,
      updated,
      unmatchedSerialNumbers: parsed.serialNumbers.filter(
        (serial) => !sourceSerialNumbers.has(serial)
      ),
    });
  } catch (error) {
    console.error("Error syncing part pending list:", error);
    return NextResponse.json(
      { error: "Failed to update the pending list." },
      { status: 500 }
    );
  }
});
