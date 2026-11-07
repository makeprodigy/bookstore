import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ReaderLoader } from "./reader-loader";
import type { Bookmark, Highlight, ReaderProps } from "./reader.types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReadPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ReadPage({ params }: ReadPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: book, error: bookError } = await supabase
    .from("books")
    .select("id, title, storage_path, num_pages, last_page, read_till")
    .eq("id", id)
    .single();

  if (bookError || !book) {
    notFound();
  }

  const { data: signedUrl, error: signedUrlError } = await supabase.storage
    .from("books")
    .createSignedUrl(book.storage_path, 60 * 60);

  if (signedUrlError || !signedUrl?.signedUrl) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center p-6">
        <p className="text-red-700 dark:text-red-400" role="alert">
          Could not open this PDF. Please return to your library and try again.
        </p>
      </main>
    );
  }

  const [bookmarksResult, highlightsResult] = await Promise.all([
    supabase
      .from("bookmarks")
      .select("id, page, label, created_at")
      .eq("book_id", book.id)
      .order("page", { ascending: true }),
    supabase
      .from("highlights")
      .select("id, page, rects, text, color, created_at")
      .eq("book_id", book.id)
      .order("created_at", { ascending: true }),
  ]);

  const initialDataError = bookmarksResult.error?.message ?? highlightsResult.error?.message ?? null;

  const readerProps: ReaderProps = {
    bookId: book.id,
    initialBookmarks: (bookmarksResult.data ?? []) as Bookmark[],
    initialDataError,
    initialHighlights: (highlightsResult.data ?? []) as Highlight[],
    initialLastPage: book.last_page,
    initialNumPages: book.num_pages,
    initialReadTill: book.read_till,
    signedUrl: signedUrl.signedUrl,
    storagePath: book.storage_path,
    title: book.title,
    userId: user.id,
  };

  return <ReaderLoader {...readerProps} />;
}
