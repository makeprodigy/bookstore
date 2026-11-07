import { redirect } from "next/navigation";

import { SignOutButton } from "@/app/sign-out-button";
import { createClient } from "@/lib/supabase/server";

import { LibraryClient, type LibraryBook } from "./library-client";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("books")
    .select("id, title, storage_path, num_pages, last_page, read_till, last_opened_at")
    .order("last_opened_at", { ascending: false, nullsFirst: false });

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-6 p-6">
        <div>
          <h1 className="text-3xl font-semibold">Your library</h1>
          <p className="mt-2 text-red-700 dark:text-red-400" role="alert">
            Could not load your books: {error.message}
          </p>
        </div>
        <SignOutButton />
      </main>
    );
  }

  return <LibraryClient initialBooks={(data ?? []) as LibraryBook[]} />;
}
