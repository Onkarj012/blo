import { requireAuth } from "@/lib/server-auth";
import { FieldDashboard } from "./FieldDashboard";

export default async function HomePage() {
  const user = await requireAuth();
  
  return <FieldDashboard user={user} />;
}
