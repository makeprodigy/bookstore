"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setError(null);
    setIsSigningOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();

    if (!error) {
      router.replace("/login");
      router.refresh();
      return;
    }

    setError(error.message);
    setIsSigningOut(false);
  }

  return (
    <div className="space-y-2">
      <button
        className="min-h-11 w-fit rounded-md border border-slate-300 px-4 py-2 font-medium dark:border-slate-600"
        disabled={isSigningOut}
        onClick={handleSignOut}
        type="button"
      >
        {isSigningOut ? "Signing out…" : "Sign out"}
      </button>
      {error ? <p className="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p> : null}
    </div>
  );
}
