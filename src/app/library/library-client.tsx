"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";

import { SignOutButton } from "@/app/sign-out-button";
import { createClient } from "@/lib/supabase/client";

export type LibraryBook = {
  id: string;
  title: string;
  storage_path: string;
  num_pages: number;
  last_page: number;
  read_till: number;
  last_opened_at: string | null;
};

type LibraryClientProps = {
  initialBooks: LibraryBook[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function bookTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "") || "Untitled PDF";
}

async function getPdfPageCount(file: File): Promise<number> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const document = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });

  try {
    const pdf = await document.promise;
    return pdf.numPages;
  } finally {
    await document.destroy();
  }
}

export function LibraryClient({ initialBooks }: LibraryClientProps) {
  const [books, setBooks] = useState(initialBooks);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadBook(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file.");
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const numPages = await getPdfPageCount(file);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const storagePath = `${user.id}/${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await supabase.storage.from("books").upload(storagePath, file, {
        contentType: "application/pdf",
        upsert: false,
      });

      if (uploadError) {
        throw uploadError;
      }

      const now = new Date().toISOString();
      const { data: insertedBook, error: insertError } = await supabase
        .from("books")
        .insert({
          user_id: user.id,
          title: bookTitle(file.name),
          storage_path: storagePath,
          num_pages: numPages,
          last_page: 1,
          read_till: 0,
          last_opened_at: now,
          updated_at: now,
        })
        .select("id, title, storage_path, num_pages, last_page, read_till, last_opened_at")
        .single();

      if (insertError) {
        await supabase.storage.from("books").remove([storagePath]);
        throw insertError;
      }

      setBooks((currentBooks) => [insertedBook as LibraryBook, ...currentBooks]);
    } catch (uploadError) {
      setError(`Upload failed: ${errorMessage(uploadError)}`);
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (file) {
      void uploadBook(file);
    }
  }

  async function deleteBook(book: LibraryBook) {
    if (!window.confirm(`Delete “${book.title}”? This removes the PDF and its reading data.`)) {
      return;
    }

    setError(null);
    setDeletingBookId(book.id);

    try {
      const supabase = createClient();
      const { error: storageError } = await supabase.storage.from("books").remove([book.storage_path]);

      if (storageError) {
        throw storageError;
      }

      const { error: deleteError } = await supabase.from("books").delete().eq("id", book.id);

      if (deleteError) {
        throw deleteError;
      }

      setBooks((currentBooks) => currentBooks.filter((currentBook) => currentBook.id !== book.id));
    } catch (deleteError) {
      setError(`Delete failed: ${errorMessage(deleteError)}`);
    } finally {
      setDeletingBookId(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Your library</h1>
          <p className="mt-1 text-slate-600 dark:text-slate-300">Upload a PDF and pick up where you left off.</p>
        </div>
        <SignOutButton />
      </header>

      <section className="mt-8 rounded-xl border border-dashed border-slate-300 p-5 dark:border-slate-600" aria-labelledby="upload-heading">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold" id="upload-heading">Add a book</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">PDF files are uploaded directly to your private library.</p>
          </div>
          <input
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={isUploading}
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="min-h-11 rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            {isUploading ? "Uploading…" : "Upload PDF"}
          </button>
        </div>
      </section>

      {error ? <p className="mt-4 text-sm text-red-700 dark:text-red-400" role="alert">{error}</p> : null}

      <section className="mt-8" aria-labelledby="books-heading">
        <h2 className="text-xl font-semibold" id="books-heading">Books</h2>
        {books.length === 0 ? (
          <p className="mt-4 rounded-xl border border-slate-200 p-6 text-slate-600 dark:border-slate-700 dark:text-slate-300">No books yet. Upload your first PDF to begin.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {books.map((book) => {
              const readTill = Math.min(Math.max(book.read_till, 0), book.num_pages);
              const progress = book.num_pages > 0 ? Math.round((readTill / book.num_pages) * 100) : 0;
              const isDeleting = deletingBookId === book.id;

              return (
                <li className="rounded-xl border border-slate-200 p-4 dark:border-slate-700" key={book.id}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-lg font-semibold">{book.title}</h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Read till page {readTill} of {book.num_pages}</p>
                      <div aria-label={`${progress}% read`} className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress}>
                        <div className="h-full rounded-full bg-sky-600" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 py-2 font-medium text-white dark:bg-slate-100 dark:text-slate-900" href={`/read/${book.id}`}>
                        Continue p.{Math.min(Math.max(book.last_page, 1), book.num_pages)}
                      </Link>
                      <button
                        className="min-h-11 rounded-md border border-red-300 px-4 py-2 font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-400"
                        disabled={isDeleting}
                        onClick={() => void deleteBook(book)}
                        type="button"
                      >
                        {isDeleting ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
