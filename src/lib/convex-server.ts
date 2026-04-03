// Server-side Convex client for API routes
import { ConvexHttpClient } from "convex/browser";

// Use NEXT_PUBLIC_CONVEX_URL which is set by `npx convex dev`
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set. Please run 'npx convex dev' first.");
}

export const convexClient = new ConvexHttpClient(convexUrl);
