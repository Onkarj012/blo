import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-server";
import { verifyPassword, createSession, serializeSessionCookie } from "@/lib/auth";
import { api } from "@convex/_generated/api";

// CORS headers for phone access
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
  "Access-Control-Allow-Credentials": "true",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Get user from Convex
    const user = await convexClient.query(api.users.getUserByUsername, { username });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401, headers: corsHeaders }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: "Account is inactive" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Create session
    const token = await createSession({
      userId: user._id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    });

    // Set cookie and return success
    const response = NextResponse.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });

    response.headers.set("Set-Cookie", serializeSessionCookie(token));
    
    // Add CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
