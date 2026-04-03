import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
  "Access-Control-Allow-Credentials": "true",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export const GET = requireAuth(async (request) => {
  const response = NextResponse.json({
    user: {
      id: request.user!.userId,
      username: request.user!.username,
      displayName: request.user!.displayName,
      role: request.user!.role,
    },
  });
  
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
});
