#!/usr/bin/env tsx
/**
 * Setup script to create the initial admin user in Convex
 * Run: npx tsx scripts/setup-admin.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { hashPassword } from "../src/lib/auth";
import { api } from "@convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;

if (!CONVEX_URL) {
  console.error("Error: NEXT_PUBLIC_CONVEX_URL environment variable is not set");
  console.error("Please run 'npx convex dev' first to get your deployment URL");
  process.exit(1);
}

async function main() {
  const client = new ConvexHttpClient(CONVEX_URL!);
  
  // Default admin credentials
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "changeme123";
  const displayName = process.env.ADMIN_DISPLAY_NAME || "Administrator";
  
  console.log("Creating admin user...");
  console.log(`Username: ${username}`);
  
  try {
    // Check if user already exists
    const existingUser = await client.query(api.users.getUserByUsername, { username });
    
    if (existingUser) {
      console.log("Admin user already exists.");
      process.exit(0);
    }
    
    // Hash password
    const passwordHash = await hashPassword(password);
    
    // Create admin user
    const userId = await client.mutation(api.users.createUser, {
      username,
      displayName,
      passwordHash,
      role: "admin",
      isActive: true,
    });
    
    console.log("✓ Admin user created successfully!");
    console.log(`User ID: ${userId}`);
    console.log("");
    console.log("⚠️  IMPORTANT: Change the default password after first login!");
    console.log(`   Default password: ${password}`);
    
  } catch (error) {
    console.error("Error creating admin user:", error);
    process.exit(1);
  }
}

main();
