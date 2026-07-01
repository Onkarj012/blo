import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-server";
import { requireAuth, AuthenticatedRequest } from "@/lib/middleware";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
  "Access-Control-Allow-Credentials": "true",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const PATCH = requireAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    const payload = await request.json() as { areaCluster: string };

    if (!payload.areaCluster || typeof payload.areaCluster !== "string") {
      const response = NextResponse.json({ error: "areaCluster is required." }, { status: 400 });
      Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    await convexClient.mutation(api.voters.updateAreaCluster, {
      id: id as Id<"voters">,
      areaCluster: payload.areaCluster.trim(),
    });

    const response = NextResponse.json({ ok: true });
    Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  } catch (error) {
    console.error("Error updating voter area:", error);
    const response = NextResponse.json({ error: "Failed to update voter area" }, { status: 500 });
    Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
});
