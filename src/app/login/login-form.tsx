"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    const nextPath = searchParams.get("next");
    router.replace(nextPath?.startsWith("/") ? nextPath : "/");
    router.refresh();
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium" htmlFor="email">
        Email
        <input
          autoComplete="email"
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-slate-900 dark:border-slate-600 dark:focus:border-slate-100"
          id="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label className="block text-sm font-medium" htmlFor="password">
        Password
        <input
          autoComplete="current-password"
          className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-slate-900 dark:border-slate-600 dark:focus:border-slate-100"
          id="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error ? <p className="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p> : null}
      <button
        className="min-h-11 w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
