import { redirectIfAuthenticated } from "@/lib/server-auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  // Redirect to home if already authenticated
  await redirectIfAuthenticated();
  
  return <LoginForm />;
}
