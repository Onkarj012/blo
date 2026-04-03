import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, type SessionPayload } from "./auth";

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  
  if (!token) {
    return null;
  }
  
  return verifySession(token);
}

export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  
  if (!session) {
    redirect("/login");
  }
  
  return session;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireAuth();
  
  if (session.role !== "admin") {
    redirect("/");
  }
  
  return session;
}

export async function redirectIfAuthenticated(): Promise<void> {
  const session = await getSession();
  
  if (session) {
    redirect("/");
  }
}
