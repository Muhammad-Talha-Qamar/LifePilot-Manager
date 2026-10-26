import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
