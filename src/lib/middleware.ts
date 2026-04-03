import { NextRequest, NextResponse } from "next/server";
import { verifySession, parseSessionCookie } from "./auth";

export interface AuthenticatedRequest extends NextRequest {
  user?: {
    userId: string;
    username: string;
    role: "admin" | "user";
    displayName: string;
  };
}

export async function authenticateRequest(
  request: NextRequest
): Promise<{ user: AuthenticatedRequest["user"] } | { error: string; status: number }> {
  const cookieHeader = request.headers.get("cookie");
  const token = parseSessionCookie(cookieHeader);
  
  if (!token) {
    return { error: "Unauthorized", status: 401 };
  }
  
  const session = await verifySession(token);
  
  if (!session) {
    return { error: "Invalid or expired session", status: 401 };
  }
  
  return { user: session };
}

export function requireAuth<
  TContext = unknown
>(
  handler: (req: AuthenticatedRequest, context: TContext) => Promise<NextResponse>
): (req: NextRequest, context: TContext) => Promise<NextResponse> {
  return async (request: NextRequest, context: TContext) => {
    const result = await authenticateRequest(request);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const authReq = request as AuthenticatedRequest;
    authReq.user = result.user;

    return handler(authReq, context);
  };
}

export function requireAdmin<
  TContext = unknown
>(
  handler: (req: AuthenticatedRequest, context: TContext) => Promise<NextResponse>
): (req: NextRequest, context: TContext) => Promise<NextResponse> {
  return async (request: NextRequest, context: TContext) => {
    const result = await authenticateRequest(request);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (!result.user || result.user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const authReq = request as AuthenticatedRequest;
    authReq.user = result.user;

    return handler(authReq, context);
  };
}
