import { getTodayQueue, replaceTodayQueue } from "@/lib/db";

export const runtime = "nodejs";

function requireDeviceId(request: Request): string | null {
  return request.headers.get("x-device-id");
}

export async function GET(request: Request) {
  const deviceId = requireDeviceId(request);
  if (!deviceId) {
    return Response.json({ error: "Missing device id." }, { status: 400 });
  }

  return Response.json({ items: getTodayQueue(deviceId) });
}

export async function POST(request: Request) {
  const deviceId = requireDeviceId(request);
  if (!deviceId) {
    return Response.json({ error: "Missing device id." }, { status: 400 });
  }

  const payload = (await request.json()) as { voterIds?: number[] };
  const voterIds = Array.isArray(payload.voterIds)
    ? payload.voterIds.filter((value) => Number.isFinite(value)).map(Number)
    : [];
  replaceTodayQueue(deviceId, voterIds, new Date().toISOString());
  return Response.json({ ok: true });
}

