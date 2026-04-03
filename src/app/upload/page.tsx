import { requireAdmin } from "@/lib/server-auth";
import { ImportPage } from "./ImportPage";

export default async function UploadPage() {
  const user = await requireAdmin();
  
  return <ImportPage user={user} />;
}
