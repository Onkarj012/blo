import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Query to get user by username
export const getUserByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
  },
});

// Query to get user by ID
export const getUserById = query({
  args: { id: v.id("appUsers") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.id);
    if (!user) return null;
    
    // Don't return password hash
    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword;
  },
});

// Query to get all users (admin only)
export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("appUsers").collect();
    // Don't return password hashes
    return users.map(({ passwordHash, ...user }) => user);
  },
});

// Mutation to create a new user
export const createUser = mutation({
  args: {
    username: v.string(),
    displayName: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Check if username already exists
    const existing = await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
    
    if (existing) {
      throw new Error("Username already exists");
    }
    
    const id = await ctx.db.insert("appUsers", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    
    return id;
  },
});

// Mutation to update user
export const updateUser = mutation({
  args: {
    id: v.id("appUsers"),
    displayName: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("user"))),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const updateData: Record<string, unknown> = { ...updates, updatedAt: Date.now() };
    
    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    
    await ctx.db.patch(id, updateData);
    return await ctx.db.get(id);
  },
});

// Mutation to delete user
export const deleteUser = mutation({
  args: { id: v.id("appUsers") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});
