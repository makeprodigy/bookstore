"use client";

import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { createClient } from "@/lib/supabase/client";

import type { Bookmark, Highlight, HighlightRect, ReaderProps } from "./reader.types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type SaveStatus = "idle" | "saving" | "saved" | "error";

function clampPage(page: number, numPages: number): number {
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(numPages, 1));
}

function clampFraction(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function selectedRects(range: Range, wrapperRect: DOMRect): HighlightRect[] {
  if (wrapperRect.width === 0 || wrapperRect.height === 0) {
    return [];
  }

  return Array.from(range.getClientRects()).flatMap((rect) => {
    const left = Math.max(rect.left, wrapperRect.left);
    const top = Math.max(rect.top, wrapperRect.top);
    const right = Math.min(rect.right, wrapperRect.right);
    const bottom = Math.min(rect.bottom, wrapperRect.bottom);

    if (right <= left || bottom <= top) {
      return [];
    }

    return [{
      height: clampFraction((bottom - top) / wrapperRect.height),
      left: clampFraction((left - wrapperRect.left) / wrapperRect.width),
      top: clampFraction((top - wrapperRect.top) / wrapperRect.height),
      width: clampFraction((right - left) / wrapperRect.width),
    }];
  });
}

export function Reader({
  bookId,
  initialBookmarks,
  initialDataError,
  initialHighlights,
  initialLastPage,
  initialNumPages,
  initialReadTill,
  signedUrl,
  title,
  userId,
}: ReaderProps) {
  const supabase = useMemo(() => createClient(), []);
  const initialPage = clampPage(initialLastPage, initialNumPages);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(initialNumPages);
  const [readTill, setReadTill] = useState(Math.min(Math.max(initialReadTill, 0), initialNumPages));
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [pageWidth, setPageWidth] = useState<number>();
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [highlights, setHighlights] = useState(initialHighlights);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState(initialDataError);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isMarkingReadTill, setIsMarkingReadTill] = useState(false);
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [deletingHighlightId, setDeletingHighlightId] = useState<string | null>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageRef = useRef(initialPage);
  const savedPageRef = useRef(initialPage);
  const touchStartXRef = useRef<number | null>(null);

  const currentBookmark = bookmarks.find((bookmark) => bookmark.page === currentPage);
  const pageHighlights = highlights.filter((highlight) => highlight.page === currentPage);

  const changePage = useCallback((nextPage: number) => {
    const clampedPage = clampPage(nextPage, numPages);
    currentPageRef.current = clampedPage;
    setCurrentPage(clampedPage);
    setPageInput(String(clampedPage));
  }, [numPages]);

  const flushLastPage = useCallback(async () => {
    const pageToSave = currentPageRef.current;

    if (pageToSave === savedPageRef.current) {
      return;
    }

    setSaveStatus("saving");
    const { error } = await supabase
      .from("books")
      .update({ last_page: pageToSave, updated_at: new Date().toISOString() })
      .eq("id", bookId);

    if (error) {
      setSaveStatus("error");
      setRequestError(`Could not save your page: ${error.message}`);
      return;
    }

    savedPageRef.current = pageToSave;
    setSaveStatus("saved");
  }, [bookId, supabase]);

  useEffect(() => {
    const container = pageContainerRef.current;

    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      setPageWidth(Math.floor(entry.contentRect.width));
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      void flushLastPage();
    }, 800);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [currentPage, flushLastPage]);

  useEffect(() => {
    const updateLastOpenedAt = async () => {
      const openedAt = new Date().toISOString();
      const { error } = await supabase
        .from("books")
        .update({ last_opened_at: openedAt, updated_at: openedAt })
        .eq("id", bookId);

      if (error) {
        setRequestError(`Could not record this reading session: ${error.message}`);
      }
    };

    void updateLastOpenedAt();
  }, [bookId, supabase]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushLastPage();
      }
    };

    const handlePageHide = () => {
      void flushLastPage();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      void flushLastPage();
    };
  }, [flushLastPage]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        changePage(currentPageRef.current - 1);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        changePage(currentPageRef.current + 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changePage]);

  function commitPageInput() {
    const requestedPage = Number.parseInt(pageInput, 10);

    if (Number.isNaN(requestedPage)) {
      setPageInput(String(currentPage));
      return;
    }

    changePage(requestedPage);
  }

  function handlePageInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitPageInput();
      event.currentTarget.blur();
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") {
      touchStartXRef.current = event.clientX;
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const touchStartX = touchStartXRef.current;
    touchStartXRef.current = null;

    if (touchStartX === null || window.getSelection()?.toString().trim()) {
      return;
    }

    const horizontalDistance = event.clientX - touchStartX;

    if (Math.abs(horizontalDistance) >= 50) {
      changePage(currentPageRef.current + (horizontalDistance < 0 ? 1 : -1));
    }
  }

  async function markReadTillHere() {
    setRequestError(null);
    setIsMarkingReadTill(true);

    try {
      const updatedAt = new Date().toISOString();
      const { error } = await supabase
        .from("books")
        .update({ read_till: currentPage, updated_at: updatedAt })
        .eq("id", bookId);

      if (error) {
        throw error;
      }

      setReadTill(currentPage);
    } catch (markError) {
      setRequestError(`Could not update read till: ${errorMessage(markError)}`);
    } finally {
      setIsMarkingReadTill(false);
    }
  }

  async function toggleBookmark() {
    setRequestError(null);
    setIsBookmarking(true);

    if (currentBookmark) {
      const previousBookmarks = bookmarks;
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== currentBookmark.id));

      const { error } = await supabase.from("bookmarks").delete().eq("id", currentBookmark.id);

      if (error) {
        setBookmarks(previousBookmarks);
        setRequestError(`Could not remove bookmark: ${error.message}`);
      }

      setIsBookmarking(false);
      return;
    }

    const temporaryBookmark: Bookmark = {
      created_at: new Date().toISOString(),
      id: `temporary-${crypto.randomUUID()}`,
      label: `Page ${currentPage}`,
      page: currentPage,
    };
    setBookmarks((current) => [...current, temporaryBookmark].sort((a, b) => a.page - b.page));

    const { data, error } = await supabase
      .from("bookmarks")
      .insert({
        book_id: bookId,
        label: temporaryBookmark.label,
        page: currentPage,
        user_id: userId,
      })
      .select("id, page, label, created_at")
      .single();

    if (error) {
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== temporaryBookmark.id));
      setRequestError(`Could not add bookmark: ${error.message}`);
    } else {
      setBookmarks((current) => current.map((bookmark) => (bookmark.id === temporaryBookmark.id ? data as Bookmark : bookmark)));
    }

    setIsBookmarking(false);
  }

  async function addHighlight() {
    const selection = window.getSelection();
    const wrapper = pageWrapperRef.current;

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !wrapper) {
      setRequestError("Select text on the page before highlighting it.");
      return;
    }

    const range = selection.getRangeAt(0);

    if (!wrapper.contains(range.commonAncestorContainer)) {
      setRequestError("Select text from this page only.");
      return;
    }

    const text = selection.toString().trim();
    const rects = selectedRects(range, wrapper.getBoundingClientRect());

    if (!text || rects.length === 0) {
      setRequestError("Could not determine the selected text position.");
      return;
    }

    setRequestError(null);
    setIsHighlighting(true);
    const temporaryHighlight: Highlight = {
      color: "#facc15",
      created_at: new Date().toISOString(),
      id: `temporary-${crypto.randomUUID()}`,
      page: currentPage,
      rects,
      text,
    };
    setHighlights((current) => [...current, temporaryHighlight]);
    selection.removeAllRanges();

    const { data, error } = await supabase
      .from("highlights")
      .insert({
        book_id: bookId,
        color: temporaryHighlight.color,
        page: currentPage,
        rects,
        text,
        user_id: userId,
      })
      .select("id, page, rects, text, color, created_at")
      .single();

    if (error) {
      setHighlights((current) => current.filter((highlight) => highlight.id !== temporaryHighlight.id));
      setRequestError(`Could not add highlight: ${error.message}`);
    } else {
      setHighlights((current) => current.map((highlight) => (highlight.id === temporaryHighlight.id ? data as Highlight : highlight)));
    }

    setIsHighlighting(false);
  }

  async function deleteHighlight(highlight: Highlight) {
    const previousHighlights = highlights;
    setRequestError(null);
    setDeletingHighlightId(highlight.id);
    setHighlights((current) => current.filter((item) => item.id !== highlight.id));

    const { error } = await supabase.from("highlights").delete().eq("id", highlight.id);

    if (error) {
      setHighlights(previousHighlights);
      setRequestError(`Could not delete highlight: ${error.message}`);
    }

    setDeletingHighlightId(null);
  }

  const annotationPanel = (
    <aside
      aria-label="Annotations"
      className={`${isDrawerOpen ? "flex sm:grid" : "hidden"} fixed inset-x-0 bottom-0 z-30 max-h-[75dvh] flex-col gap-4 overflow-y-auto rounded-t-2xl border border-slate-200 bg-[var(--background)] p-4 shadow-2xl dark:border-slate-700 sm:static sm:mt-4 sm:max-h-none sm:rounded-xl sm:shadow-none lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:block`}
    >
      <div className="flex items-center justify-between sm:hidden">
        <h2 className="font-semibold">Reading tools</h2>
        <button className="min-h-11 px-2 text-sky-700 dark:text-sky-300" onClick={() => setIsDrawerOpen(false)} type="button">Done</button>
      </div>
      <div className="grid gap-2 sm:hidden">
        <button className="min-h-11 rounded-md bg-sky-700 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-sky-500 dark:text-slate-950" disabled={isMarkingReadTill} onClick={() => void markReadTillHere()} type="button">{isMarkingReadTill ? "Marking…" : "Mark read till here"}</button>
        <button className="min-h-11 rounded-md border border-slate-300 px-4 py-2 font-medium disabled:opacity-50 dark:border-slate-600" disabled={readTill < 1} onClick={() => changePage(readTill)} type="button">Jump to read-till{readTill > 0 ? ` (p.${readTill})` : ""}</button>
      </div>
      <section>
        <h2 className="font-semibold">Bookmarks</h2>
        {bookmarks.length === 0 ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No bookmarks yet.</p> : <ul className="mt-2 space-y-2">{bookmarks.map((bookmark) => <li key={bookmark.id}><button className="min-h-11 text-left text-sm text-sky-700 underline underline-offset-4 dark:text-sky-300" onClick={() => changePage(bookmark.page)} type="button">{bookmark.label || `Page ${bookmark.page}`}</button></li>)}</ul>}
      </section>
      <section className="mt-2">
        <h2 className="font-semibold">Highlights</h2>
        {highlights.length === 0 ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No highlights yet.</p> : <ul className="mt-2 space-y-3">{highlights.map((highlight) => <li className="flex items-start justify-between gap-3" key={highlight.id}><button className="min-w-0 text-left text-sm text-sky-700 underline underline-offset-4 dark:text-sky-300" onClick={() => changePage(highlight.page)} type="button"><span className="block font-medium">Page {highlight.page}</span><span className="block truncate">{highlight.text}</span></button><button className="min-h-11 shrink-0 rounded-md border border-red-300 px-3 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-400" disabled={deletingHighlightId === highlight.id} onClick={() => void deleteHighlight(highlight)} type="button">{deletingHighlightId === highlight.id ? "Deleting…" : "Delete"}</button></li>)}</ul>}
      </section>
    </aside>
  );

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-8">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link className="inline-flex min-h-11 items-center text-sm text-sky-700 underline underline-offset-4 dark:text-sky-300" href="/library">← Library</Link>
          <h1 className="truncate text-2xl font-semibold sm:text-3xl">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-slate-600 dark:text-slate-300" aria-live="polite">{saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : ""}</p>
          <button aria-expanded={isDrawerOpen} className="min-h-11 rounded-md border border-slate-300 px-3 font-medium dark:border-slate-600 sm:hidden" onClick={() => setIsDrawerOpen((open) => !open)} type="button">More</button>
        </div>
      </header>

      <section className="sticky top-0 z-10 mt-3 hidden flex-wrap items-center gap-2 border-y border-slate-200 bg-[var(--background)] py-3 dark:border-slate-700 sm:flex" aria-label="Reader controls">
        <button className="min-h-11 rounded-md border border-slate-300 px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)} type="button">Previous</button>
        <button className="min-h-11 rounded-md border border-slate-300 px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600" disabled={currentPage >= numPages} onClick={() => changePage(currentPage + 1)} type="button">Next</button>
        <label className="flex min-h-11 items-center gap-2 text-sm" htmlFor="page-number">Page<input className="min-h-11 w-16 rounded-md border border-slate-300 bg-transparent px-2 text-center dark:border-slate-600" id="page-number" inputMode="numeric" max={numPages} min={1} onBlur={commitPageInput} onChange={(event) => setPageInput(event.target.value)} onKeyDown={handlePageInputKeyDown} type="number" value={pageInput} /><span>of {numPages}</span></label>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="min-h-11 rounded-md border border-slate-300 px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600" disabled={isBookmarking} onClick={() => void toggleBookmark()} type="button">{isBookmarking ? "Saving…" : currentBookmark ? "Remove bookmark" : "Bookmark page"}</button>
          <button className="min-h-11 rounded-md border border-slate-300 px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600" disabled={isHighlighting} onClick={() => void addHighlight()} onPointerDown={(event) => event.preventDefault()} type="button">{isHighlighting ? "Highlighting…" : "Highlight selection"}</button>
          <button aria-expanded={isDrawerOpen} className="min-h-11 rounded-md border border-slate-300 px-4 py-2 font-medium dark:border-slate-600" onClick={() => setIsDrawerOpen((open) => !open)} type="button">Annotations ({bookmarks.length + highlights.length})</button>
          <button className="min-h-11 rounded-md bg-sky-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:text-slate-950" disabled={isMarkingReadTill} onClick={() => void markReadTillHere()} type="button">{isMarkingReadTill ? "Marking…" : "Mark read till here"}</button>
          <button className="min-h-11 rounded-md border border-slate-300 px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600" disabled={readTill < 1} onClick={() => changePage(readTill)} type="button">Jump to read-till{readTill > 0 ? ` (p.${readTill})` : ""}</button>
        </div>
      </section>

      <section className="sticky top-0 z-10 mt-3 flex gap-2 border-y border-slate-200 bg-[var(--background)] py-2 dark:border-slate-700 sm:hidden" aria-label="Reader actions">
        <button className="min-h-11 flex-1 rounded-md border border-slate-300 px-3 font-medium disabled:opacity-50 dark:border-slate-600" disabled={isBookmarking} onClick={() => void toggleBookmark()} type="button">{currentBookmark ? "Unbookmark" : "Bookmark"}</button>
        <button className="min-h-11 flex-1 rounded-md border border-slate-300 px-3 font-medium disabled:opacity-50 dark:border-slate-600" disabled={isHighlighting} onClick={() => void addHighlight()} onPointerDown={(event) => event.preventDefault()} type="button">Highlight</button>
      </section>

      {requestError ? <p className="mt-4 text-sm text-red-700 dark:text-red-400" role="alert">{requestError}</p> : null}

      {isDrawerOpen ? <button aria-label="Close annotations" className="fixed inset-0 z-20 bg-slate-950/40 sm:hidden" onClick={() => setIsDrawerOpen(false)} type="button" /> : null}
      <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-5">
        <div className="min-w-0">
          <div className="touch-pan-y rounded-xl bg-slate-200 p-1 dark:bg-slate-800" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} ref={pageContainerRef}>
            {documentError ? <p className="p-6 text-red-700 dark:text-red-400" role="alert">Could not render this PDF: {documentError}</p> : <Document file={signedUrl} loading={<p className="p-6 text-center text-slate-600 dark:text-slate-300">Loading PDF…</p>} onLoadError={(loadError) => setDocumentError(errorMessage(loadError))} onLoadSuccess={({ numPages: loadedPageCount }) => { setNumPages(loadedPageCount); const clampedPage = clampPage(currentPageRef.current, loadedPageCount); currentPageRef.current = clampedPage; setCurrentPage(clampedPage); setPageInput(String(clampedPage)); setReadTill((page) => Math.min(page, loadedPageCount)); }}>
              {pageWidth ? <div className="relative mx-auto w-fit" ref={pageWrapperRef}><Page className="overflow-hidden rounded-lg bg-white shadow-sm" loading={<p className="p-6 text-center text-slate-600">Loading page…</p>} pageNumber={currentPage} renderAnnotationLayer renderTextLayer width={Math.max(pageWidth - 8, 1)} />{pageHighlights.map((highlight) => highlight.rects.map((rect, index) => <div aria-hidden="true" key={`${highlight.id}-${index}`} style={{ backgroundColor: highlight.color, height: `${rect.height * 100}%`, left: `${rect.left * 100}%`, mixBlendMode: "multiply", opacity: 0.4, pointerEvents: "none", position: "absolute", top: `${rect.top * 100}%`, width: `${rect.width * 100}%` }} />))}</div> : null}
            </Document>}
          </div>
        </div>
        {annotationPanel}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-slate-200 bg-[var(--background)] px-3 py-2 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] dark:border-slate-700 sm:hidden" aria-label="Page navigation" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        <button aria-label="Previous page" className="min-h-11 flex-1 rounded-md border border-slate-300 px-3 font-medium disabled:opacity-50 dark:border-slate-600" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)} type="button">Previous</button>
        <label className="flex min-h-11 items-center gap-1 text-sm" htmlFor="mobile-page-number"><input aria-label="Page number" className="min-h-11 w-14 rounded-md border border-slate-300 bg-transparent px-1 text-center dark:border-slate-600" id="mobile-page-number" inputMode="numeric" max={numPages} min={1} onBlur={commitPageInput} onChange={(event) => setPageInput(event.target.value)} onKeyDown={handlePageInputKeyDown} type="number" value={pageInput} /><span>/{numPages}</span></label>
        <button aria-label="Next page" className="min-h-11 flex-1 rounded-md border border-slate-300 px-3 font-medium disabled:opacity-50 dark:border-slate-600" disabled={currentPage >= numPages} onClick={() => changePage(currentPage + 1)} type="button">Next</button>
      </nav>
    </main>
  );
}
