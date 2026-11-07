import { Suspense } from "react";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-2xl font-semibold">Bookstore</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Sign in to your private library.</p>
        <Suspense fallback={<p className="mt-6 text-sm text-slate-600 dark:text-slate-300">Loading sign-in form…</p>}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
