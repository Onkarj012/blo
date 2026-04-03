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

type VoterStatus = "pending" | "done" | "locked" | "revisit" | "wrong_address";

const voterStatuses: VoterStatus[] = ["pending", "done", "locked", "revisit", "wrong_address"];

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const PATCH = requireAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    const payload = await request.json() as { status?: VoterStatus; visited?: boolean; note?: string };
    
    // Validate that at least one field is provided
    if (!payload.status && payload.visited === undefined) {
      const response = NextResponse.json({ error: "Either status or visited must be provided." }, { status: 400 });
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    }
    
    // Validate status if provided
    if (payload.status && !voterStatuses.includes(payload.status)) {
      const response = NextResponse.json({ error: "Invalid voter status." }, { status: 400 });
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    }
    
    // Update via Convex
    const result = await convexClient.mutation(api.voters.updateStatus, {
      voterId: id as Id<"voters">,
      status: payload.status,
      visited: payload.visited,
      note: payload.note?.trim(),
      userId: request.user!.userId as Id<"appUsers">,
    });
    
    const response = NextResponse.json({ 
      ok: true, 
      voter: result.voter,
      counts: result.counts,
    });
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    console.error("Error updating voter status:", error);
    const response = NextResponse.json(
      { error: "Failed to update voter status" },
      { status: 500 }
    );
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }
});
