import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
