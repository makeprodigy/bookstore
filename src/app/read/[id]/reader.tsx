"use client";

import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { createClient } from "@/lib/supabase/client";

import type { Bookmark, Highlight, HighlightRect, ReaderProps } from "./reader.types";
import { useFullscreen } from "./use-fullscreen";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type SaveStatus = "idle" | "saving" | "saved" | "error";
type FitMode = "fit-page" | "fit-width";

type Toast = {
  id: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
};

const STORAGE_FIT_MODE = "bookstore:reader:fit_mode";
const STORAGE_ZOOM = "bookstore:reader:zoom";

const HIGHLIGHT_COLORS = [
  { label: "Yellow", value: "#facc15", bgClass: "bg-amber-300" },
  { label: "Green", value: "#4ade80", bgClass: "bg-emerald-400" },
  { label: "Blue", value: "#60a5fa", bgClass: "bg-sky-400" },
  { label: "Pink", value: "#f472b6", bgClass: "bg-pink-400" },
];

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

    return [
      {
        height: clampFraction((bottom - top) / wrapperRect.height),
        left: clampFraction((left - wrapperRect.left) / wrapperRect.width),
        top: clampFraction((top - wrapperRect.top) / wrapperRect.height),
        width: clampFraction((right - left) / wrapperRect.width),
      },
    ];
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
  storagePath,
  title,
  userId,
}: ReaderProps) {
  const supabase = useMemo(() => createClient(), []);
  const initialPage = clampPage(initialLastPage, initialNumPages);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(initialNumPages);
  const [readTill, setReadTill] = useState(Math.min(Math.max(initialReadTill, 0), initialNumPages));
  const [pageInput, setPageInput] = useState(String(initialPage));

  const [currentSignedUrl] = useState(signedUrl);

  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [highlights, setHighlights] = useState(initialHighlights);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"bookmarks" | "highlights">("bookmarks");
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  const annotationsButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);


  const [documentError, setDocumentError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState(initialDataError);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isMarkingReadTill, setIsMarkingReadTill] = useState(false);
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [deletingHighlightId, setDeletingHighlightId] = useState<string | null>(null);

  // Sizing and Fit Mode
  const [fitMode, setFitMode] = useState<FitMode>(() => {
    if (typeof window === "undefined") return "fit-page";
    try {
      const stored = localStorage.getItem(STORAGE_FIT_MODE) as FitMode | null;
      if (stored === "fit-page" || stored === "fit-width") return stored;
      return window.innerWidth < 640 ? "fit-width" : "fit-page";
    } catch {
      return "fit-page";
    }
  });

  const [zoomScale, setZoomScale] = useState<number>(() => {
    if (typeof window === "undefined") return 1.0;
    try {
      const stored = localStorage.getItem(STORAGE_ZOOM);
      if (stored) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 3.0) return parsed;
      }
    } catch {}
    return 1.0;
  });

  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [pageAspect, setPageAspect] = useState<number>(0.707); // Default A4/US Letter aspect
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [sliderDragPage, setSliderDragPage] = useState<number>(initialPage);

  // Phase 3: Selection state & Floating Popover
  const [selectionRange, setSelectionRange] = useState<{
    text: string;
    rect: DOMRect;
  } | null>(null);
  const [selectedHighlightColor, setSelectedHighlightColor] = useState<string>("#facc15");

  // Phase 3: Toast Stack
  const [toasts, setToasts] = useState<Toast[]>([]);

  const readerShellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageRef = useRef(initialPage);
  const savedPageRef = useRef(initialPage);

  const {
    isFullscreen,
    isSupported: canFullscreen,
    showPwaHint,
    dismissPwaHint,
    toggle: toggleFullscreen,
    exit: exitFullscreen,
  } = useFullscreen(readerShellRef);

  const [isChromeVisible, setIsChromeVisible] = useState(true);
  const [isPageInputFocused, setIsPageInputFocused] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleBookmarkRef = useRef<() => Promise<void>>(async () => {});
  const addHighlightRef = useRef<(color?: string) => Promise<void>>(async () => {});
  const markReadTillHereRef = useRef<() => Promise<void>>(async () => {});
  const toggleFullscreenRef = useRef<() => Promise<void>>(async () => {});
  const exitFullscreenRef = useRef<() => Promise<void>>(async () => {});
  const handleZoomInRef = useRef<() => void>(() => {});
  const handleZoomOutRef = useRef<() => void>(() => {});
  const updateZoomRef = useRef<(z: number) => void>(() => {});

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    setIsChromeVisible(true);

    if (isFullscreen) {
      if (
        isPageInputFocused ||
        isDraggingSlider ||
        isDrawerOpen ||
        isMoreMenuOpen ||
        selectionRange !== null
      ) {
        return;
      }
      idleTimerRef.current = setTimeout(() => {
        setIsChromeVisible(false);
      }, 2500);
    }
  }, [isFullscreen, isPageInputFocused, isDraggingSlider, isDrawerOpen, isMoreMenuOpen, selectionRange]);

  // Immersive Chrome: auto-hide top/bottom bars after 2.5s of no input in fullscreen
  useEffect(() => {
    if (!isFullscreen) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }

    if (
      !isPageInputFocused &&
      !isDraggingSlider &&
      !isDrawerOpen &&
      !isMoreMenuOpen &&
      !selectionRange
    ) {
      idleTimerRef.current = setTimeout(() => {
        setIsChromeVisible(false);
      }, 2500);
    }

    const handleActivity = () => {
      resetIdleTimer();
    };

    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("pointermove", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("pointermove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
    };
  }, [
    isFullscreen,
    isPageInputFocused,
    isDraggingSlider,
    isDrawerOpen,
    isMoreMenuOpen,
    selectionRange,
    resetIdleTimer,
  ]);

  const isChromeHidden = false;

  const showToast = useCallback(
    (message: string, action?: { label: string; onClick: () => void }, duration = 3500) => {
      const id = crypto.randomUUID();
      setToasts((curr) => [...curr, { id, message, action }]);
      setTimeout(() => {
        setToasts((curr) => curr.filter((t) => t.id !== id));
      }, duration);
    },
    []
  );

  const changePage = useCallback((nextPage: number) => {
    const clampedPage = clampPage(nextPage, numPages);
    currentPageRef.current = clampedPage;
    setCurrentPage(clampedPage);
    setPageInput(String(clampedPage));
    setSelectionRange(null);
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

  // Viewport ResizeObserver
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect) {
        setViewportSize({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height),
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute rendered page width based on fit mode and zoom scale
  const pageWidth = useMemo(() => {
    if (viewportSize.width === 0 || viewportSize.height === 0) {
      return undefined;
    }

    const padX = viewportSize.width >= 640 ? 32 : 16;
    const padY = viewportSize.height >= 640 ? 32 : 16;
    const availW = Math.max(viewportSize.width - padX, 100);
    const availH = Math.max(viewportSize.height - padY, 100);

    let baseWidth: number;
    if (fitMode === "fit-width") {
      baseWidth = availW;
    } else {
      const pageWAtAvailH = availH * pageAspect;
      baseWidth = Math.min(availW, pageWAtAvailH);
    }

    return Math.max(Math.round(baseWidth * zoomScale), 50);
  }, [viewportSize, fitMode, pageAspect, zoomScale]);

  const updateFitMode = (mode: FitMode) => {
    setFitMode(mode);
    setZoomScale(1.0);
    try {
      localStorage.setItem(STORAGE_FIT_MODE, mode);
      localStorage.setItem(STORAGE_ZOOM, "1.0");
    } catch {}
  };

  const updateZoom = (nextZoom: number) => {
    const clamped = Math.min(Math.max(parseFloat(nextZoom.toFixed(2)), 0.5), 3.0);
    setZoomScale(clamped);
    try {
      localStorage.setItem(STORAGE_ZOOM, String(clamped));
    } catch {}
  };

  const handleZoomIn = () => updateZoom(zoomScale + 0.25);
  const handleZoomOut = () => updateZoom(zoomScale - 0.25);
  const toggleFitMode = () => updateFitMode(fitMode === "fit-page" ? "fit-width" : "fit-page");

  // Selection detection for highlight action & floating popover
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      const wrapper = pageWrapperRef.current;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !wrapper) {
        setSelectionRange(null);
        return;
      }

      const range = sel.getRangeAt(0);
      if (!wrapper.contains(range.commonAncestorContainer)) {
        setSelectionRange(null);
        return;
      }

      const text = sel.toString().trim();
      if (!text) {
        setSelectionRange(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setSelectionRange(null);
        return;
      }

      setSelectionRange({ text, rect });
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  // Reposition floating selection popover on scroll/resize
  useEffect(() => {
    if (!selectionRange) return;

    const updatePosition = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setSelectionRange((prev) => (prev ? { ...prev, rect } : null));
        }
      } catch {}
    };

    const viewport = viewportRef.current;
    viewport?.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition);

    return () => {
      viewport?.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, [selectionRange]);

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

  // Keyboard navigation & Shortcuts (Arrows, PageUp/Dn, Space, Home/End, g, b, h, m, f, [], +/-, 0)
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (event.key === "Escape") {
        if (isMoreMenuOpen) {
          event.preventDefault();
          setIsMoreMenuOpen(false);
          return;
        }
        if (isDrawerOpen) {
          event.preventDefault();
          setIsDrawerOpen(false);
          return;
        }
        if (selectionRange) {
          event.preventDefault();
          window.getSelection()?.removeAllRanges();
          setSelectionRange(null);
          return;
        }
        if (isFullscreen) {
          event.preventDefault();
          void exitFullscreenRef.current();
          return;
        }
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        changePage(currentPageRef.current - 1);
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        changePage(currentPageRef.current + 1);
      } else if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (event.shiftKey) {
          changePage(currentPageRef.current - 1);
        } else {
          changePage(currentPageRef.current + 1);
        }
      } else if (event.key === "Home") {
        event.preventDefault();
        changePage(1);
      } else if (event.key === "End") {
        event.preventDefault();
        changePage(numPages);
      } else if (event.key === "g" || event.key === "G") {
        event.preventDefault();
        pageInputRef.current?.focus();
        pageInputRef.current?.select();
      } else if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        void toggleBookmarkRef.current();
      } else if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        void addHighlightRef.current();
      } else if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        void markReadTillHereRef.current();
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreenRef.current();
      } else if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        setIsDrawerOpen((open) => !open);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        handleZoomInRef.current();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        handleZoomOutRef.current();
      } else if (event.key === "0") {
        event.preventDefault();
        updateZoomRef.current(1.0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changePage, isDrawerOpen, isFullscreen, isMoreMenuOpen, numPages, selectionRange]);

  function commitPageInput() {
    const requestedPage = Number.parseInt(pageInput, 10);
    if (Number.isNaN(requestedPage)) {
      setPageInput(String(currentPage));
      return;
    }
    const clamped = clampPage(requestedPage, numPages);
    changePage(clamped);
  }

  function handlePageInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitPageInput();
      event.currentTarget.blur();
    }
  }

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchLastRef = useRef<{ x: number; y: number } | null>(null);

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
    touchLastRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    if (touchStartRef.current && event.touches.length === 1) {
      const touch = event.touches[0];
      touchLastRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };
    }
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;

    // Guard: Disabled when zoomed beyond fit (allow scrolling/panning)
    if (zoomScale > 1.0) return;

    // Guard: Disabled when text is selected
    const hasTextSelected = Boolean(window.getSelection()?.toString().trim());
    if (hasTextSelected || selectionRange) return;

    const end = touchLastRef.current || start;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const elapsed = Date.now() - start.time;

    // Swipe gesture: dx > 50px, dy < 30px
    if (Math.abs(dx) >= 50 && Math.abs(dy) < 30) {
      if (dx < 0) {
        changePage(currentPageRef.current + 1);
      } else {
        changePage(currentPageRef.current - 1);
      }
      return;
    }

    // Tap gesture: pointer moved <= 10px and held <= 300ms
    if (dist <= 10 && elapsed <= 300) {
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, select, textarea, [role='button']")) {
        return;
      }

      const wrapper = pageWrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const relX = (end.x - rect.left) / rect.width;

      if (relX < 0.25) {
        changePage(currentPageRef.current - 1);
      } else if (relX > 0.75) {
        changePage(currentPageRef.current + 1);
      } else {
        // Center tap: toggle chrome in fullscreen mode, or dismiss open menus/drawer
        if (isFullscreen) {
          setIsChromeVisible((visible) => {
            const next = !visible;
            if (next) resetIdleTimer();
            return next;
          });
        } else {
          setIsMoreMenuOpen(false);
          setIsDrawerOpen(false);
        }
      }
    }
  }

  async function markReadTillHere() {
    setRequestError(null);
    setIsMarkingReadTill(true);
    const prevReadTill = readTill;
    const pageToMark = currentPage;

    try {
      const updatedAt = new Date().toISOString();
      const { error } = await supabase
        .from("books")
        .update({ read_till: pageToMark, updated_at: updatedAt })
        .eq("id", bookId);

      if (error) {
        throw error;
      }

      setReadTill(pageToMark);
      showToast(`Read till p.${pageToMark}`, {
        label: "Undo",
        onClick: () => {
          void (async () => {
            const undoUpdatedAt = new Date().toISOString();
            const { error: undoErr } = await supabase
              .from("books")
              .update({ read_till: prevReadTill, updated_at: undoUpdatedAt })
              .eq("id", bookId);

            if (!undoErr) {
              setReadTill(prevReadTill);
              showToast(prevReadTill > 0 ? `Reverted read-till to p.${prevReadTill}` : "Cleared read-till");
            }
          })();
        },
      });
    } catch (markError) {
      setRequestError(`Could not update read till: ${errorMessage(markError)}`);
    } finally {
      setIsMarkingReadTill(false);
    }
  }

  const currentBookmark = bookmarks.find((bookmark) => bookmark.page === currentPage);
  const pageHighlights = highlights.filter((highlight) => highlight.page === currentPage);

  async function toggleBookmark() {
    setRequestError(null);
    setIsBookmarking(true);
    const targetPage = currentPage;

    if (currentBookmark) {
      const previousBookmarks = bookmarks;
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== currentBookmark.id));

      const { error } = await supabase.from("bookmarks").delete().eq("id", currentBookmark.id);

      if (error) {
        setBookmarks(previousBookmarks);
        setRequestError(`Could not remove bookmark: ${error.message}`);
      } else {
        showToast(`Removed bookmark p.${targetPage}`);
      }

      setIsBookmarking(false);
      return;
    }

    const temporaryBookmark: Bookmark = {
      created_at: new Date().toISOString(),
      id: `temporary-${crypto.randomUUID()}`,
      label: `Page ${targetPage}`,
      page: targetPage,
    };
    setBookmarks((current) => [...current, temporaryBookmark].sort((a, b) => a.page - b.page));

    const { data, error } = await supabase
      .from("bookmarks")
      .insert({
        book_id: bookId,
        label: temporaryBookmark.label,
        page: targetPage,
        user_id: userId,
      })
      .select("id, page, label, created_at")
      .single();

    if (error) {
      setBookmarks((current) =>
        current.filter((bookmark) => bookmark.id !== temporaryBookmark.id)
      );
      setRequestError(`Could not add bookmark: ${error.message}`);
    } else {
      setBookmarks((current) =>
        current.map((bookmark) =>
          bookmark.id === temporaryBookmark.id ? (data as Bookmark) : bookmark
        )
      );
      showToast(`Bookmarked p.${targetPage}`);
    }

    setIsBookmarking(false);
  }

  async function addHighlight(colorOverride?: string) {
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
    const color = colorOverride || selectedHighlightColor;
    const targetPage = currentPage;

    const temporaryHighlight: Highlight = {
      color,
      created_at: new Date().toISOString(),
      id: `temporary-${crypto.randomUUID()}`,
      page: targetPage,
      rects,
      text,
    };
    setHighlights((current) => [...current, temporaryHighlight]);
    selection.removeAllRanges();
    setSelectionRange(null);

    const { data, error } = await supabase
      .from("highlights")
      .insert({
        book_id: bookId,
        color: temporaryHighlight.color,
        page: targetPage,
        rects,
        text,
        user_id: userId,
      })
      .select("id, page, rects, text, color, created_at")
      .single();

    if (error) {
      setHighlights((current) =>
        current.filter((highlight) => highlight.id !== temporaryHighlight.id)
      );
      setRequestError(`Could not add highlight: ${error.message}`);
    } else {
      setHighlights((current) =>
        current.map((highlight) =>
          highlight.id === temporaryHighlight.id ? (data as Highlight) : highlight
        )
      );
      showToast(`Highlighted on p.${targetPage}`);
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
    } else {
      showToast(`Deleted highlight on p.${highlight.page}`);
    }

    setDeletingHighlightId(null);
  }

  useEffect(() => {
    toggleBookmarkRef.current = toggleBookmark;
    addHighlightRef.current = addHighlight;
    markReadTillHereRef.current = markReadTillHere;
    toggleFullscreenRef.current = toggleFullscreen;
    exitFullscreenRef.current = exitFullscreen;
    handleZoomInRef.current = handleZoomIn;
    handleZoomOutRef.current = handleZoomOut;
    updateZoomRef.current = updateZoom;
  });

  const sliderPercent = numPages > 1 ? ((currentPage - 1) / (numPages - 1)) * 100 : 0;
  const draggingPercent = numPages > 1 ? ((sliderDragPage - 1) / (numPages - 1)) * 100 : 0;
  const readTillPercent = numPages > 1 && readTill > 0 ? ((readTill - 1) / (numPages - 1)) * 100 : null;

  // Floating selection popover positioning
  const popoverPosition = useMemo(() => {
    if (!selectionRange) return null;
    const { rect } = selectionRange;
    const popoverWidth = 200;
    const popoverHeight = 44;

    const left = Math.max(
      12,
      Math.min(window.innerWidth - popoverWidth - 12, rect.left + rect.width / 2 - popoverWidth / 2)
    );

    // Place above selection if there is room; else place below
    const top = rect.top >= 64 + popoverHeight ? rect.top - popoverHeight - 8 : rect.bottom + 8;

    return { left, top };
  }, [selectionRange]);

  return (
    <div
      ref={readerShellRef}
      data-reader-shell="true"
      className="fixed inset-0 h-[100dvh] max-h-[100dvh] flex flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)] select-none"
    >
      {/* =========================================================================
          TOP BAR: 48px + safe-area-top
          ← Library | Title (truncate) | ·· save status ·· | Zoom (lg+) | Bookmark | Highlight | Annotations | Fullscreen | More
          ========================================================================= */}
      <header
        className={`h-[calc(48px+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-[var(--background)] z-30 shrink-0 gap-2 transition-transform motion-reduce:transition-none duration-150 ease-out ${
          isFullscreen ? "absolute top-0 inset-x-0" : ""
        } ${isChromeHidden ? "-translate-y-full pointer-events-none" : "translate-y-0"}`}
        aria-label="Reader header"
      >
        {/* Left: Library link + Title */}
        <div className="flex items-center min-w-0 gap-2 shrink">
          <Link
            href="/library"
            className="min-h-11 min-w-11 px-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-400 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 shrink-0"
            aria-label="Back to library"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            <span className="hidden md:inline">Library</span>
          </Link>

          <h1
            className="truncate text-xs sm:text-sm font-semibold max-w-[110px] xs:max-w-[160px] sm:max-w-xs md:max-w-sm lg:max-w-md"
            title={title}
          >
            {title}
          </h1>

          {/* Save Status: "Saving…" → "Saved" → "Offline/Failed — retrying", dot only on phone */}
          <div
            className="flex items-center gap-1.5 pl-1 sm:pl-2 text-xs text-slate-500 dark:text-slate-400 shrink-0"
            aria-live="polite"
          >
            {saveStatus === "saving" && (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="hidden sm:inline">Saving…</span>
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="hidden sm:inline">Saved</span>
              </>
            )}
            {saveStatus === "error" && (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="hidden sm:inline">Offline/Failed — retrying</span>
              </>
            )}
          </div>
        </div>

        {/* Right: Zoom (>=1024px) + Actions */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Zoom & Fit controls: inline for >= 1024px */}
          <div className="hidden lg:flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomScale <= 0.5}
              className="min-h-11 min-w-11 p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 inline-flex items-center justify-center text-slate-700 dark:text-slate-200"
              aria-label="Zoom out"
              title="Zoom out (-)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={toggleFitMode}
              className="min-h-11 px-2.5 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 inline-flex items-center justify-center min-w-[5rem] text-slate-800 dark:text-slate-200"
              aria-label={`Toggle fit mode. Current: ${fitMode}, ${Math.round(zoomScale * 100)}%`}
              title="Toggle fit mode"
            >
              {zoomScale !== 1.0 ? `${Math.round(zoomScale * 100)}%` : fitMode === "fit-page" ? "Fit page" : "Fit width"}
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomScale >= 3.0}
              className="min-h-11 min-w-11 p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 inline-flex items-center justify-center text-slate-700 dark:text-slate-200"
              aria-label="Zoom in"
              title="Zoom in (+)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>

          {/* Bookmark icon: filled if current page bookmarked, toggles on tap */}
          <button
            type="button"
            onClick={() => void toggleBookmark()}
            disabled={isBookmarking}
            className={`min-h-11 min-w-11 p-2.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 inline-flex items-center justify-center ${
              currentBookmark
                ? "text-amber-500 hover:text-amber-600 bg-amber-50 dark:bg-amber-950/40"
                : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
            aria-label={currentBookmark ? "Remove bookmark" : "Bookmark page"}
            title={currentBookmark ? `Remove bookmark p.${currentPage}` : `Bookmark p.${currentPage}`}
          >
            <svg
              className="w-5 h-5"
              fill={currentBookmark ? "currentColor" : "none"}
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
              />
            </svg>
          </button>

          {/* Highlight icon: disabled when there is no text selection; selection-safe pointerDown */}
          <button
            type="button"
            onClick={() => void addHighlight()}
            onPointerDown={(event) => event.preventDefault()}
            disabled={isHighlighting || !selectionRange}
            className="min-h-11 min-w-11 p-2.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 inline-flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Highlight selection"
            title={selectionRange ? "Highlight selection" : "Select text on page to highlight"}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
              />
            </svg>
          </button>

          {/* Annotations drawer toggle */}
          <button
            ref={annotationsButtonRef}
            type="button"
            onClick={() => setIsDrawerOpen((open) => !open)}
            aria-expanded={isDrawerOpen}
            className="min-h-11 min-w-11 p-2.5 relative rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 inline-flex items-center justify-center"
            aria-label={`Annotations (${bookmarks.length + highlights.length})`}
            title="Annotations"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
              />
            </svg>
            {bookmarks.length + highlights.length > 0 && (
              <span className="absolute top-1.5 right-1.5 px-1 min-w-[18px] h-[18px] text-[10px] font-bold rounded-full bg-sky-600 text-white flex items-center justify-center shadow-sm">
                {bookmarks.length + highlights.length}
              </span>
            )}
          </button>

          {/* Conditional Fullscreen Button */}
          {canFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="min-h-11 min-w-11 p-2.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 inline-flex items-center justify-center"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              )}
            </button>
          )}

          {/* More (⋯) Button */}
          <div className="relative">
            <button
              ref={moreButtonRef}
              type="button"
              onClick={() => setIsMoreMenuOpen((open) => !open)}
              aria-expanded={isMoreMenuOpen}
              className="min-h-11 min-w-11 p-2.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 inline-flex items-center justify-center"
              aria-label="More options"
              title="More options"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
            </button>

            {/* Desktop More Popover / Mobile Bottom Sheet */}
            {isMoreMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-slate-950/30 sm:bg-transparent"
                  onClick={() => setIsMoreMenuOpen(false)}
                  aria-hidden="true"
                />

                {/* Popover on desktop / tablet (sm+), Bottom Sheet on phone (<sm) */}
                <div
                  ref={moreMenuRef}
                  tabIndex={-1}
                  className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:top-full sm:mt-1.5 w-full sm:w-64 rounded-t-2xl sm:rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--background)] p-4 sm:p-2 shadow-2xl z-50 text-sm space-y-2 sm:space-y-1 focus:outline-none"
                  role="menu"
                  aria-label="More options menu"
                >
                  {/* Phone bottom sheet drag handle */}
                  <div className="sm:hidden w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-2" />

                  {/* Zoom controls inside More menu for screens < 1024px */}
                  <div className="lg:hidden p-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Zoom & Fit</p>
                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={handleZoomOut}
                        disabled={zoomScale <= 0.5}
                        className="min-h-11 min-w-11 p-2 rounded-lg border border-slate-300 dark:border-slate-600 flex items-center justify-center disabled:opacity-40 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        aria-label="Zoom out"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={toggleFitMode}
                        className="min-h-11 flex-1 px-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      >
                        {zoomScale !== 1.0 ? `${Math.round(zoomScale * 100)}%` : fitMode === "fit-page" ? "Fit page" : "Fit width"}
                      </button>
                      <button
                        type="button"
                        onClick={handleZoomIn}
                        disabled={zoomScale >= 3.0}
                        className="min-h-11 min-w-11 p-2 rounded-lg border border-slate-300 dark:border-slate-600 flex items-center justify-center disabled:opacity-40 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        aria-label="Zoom in"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      void markReadTillHere();
                    }}
                    disabled={isMarkingReadTill}
                    className="w-full min-h-11 px-3 py-2.5 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  >
                    <span>{isMarkingReadTill ? "Marking…" : "Mark read till here"}</span>
                    <span className="text-xs text-slate-400 font-mono">m</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      changePage(readTill);
                    }}
                    disabled={readTill < 1}
                    className="w-full min-h-11 px-3 py-2.5 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between font-medium disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  >
                    <span>Jump to read-till</span>
                    <span className="text-xs text-slate-400 font-mono">{readTill > 0 ? `p.${readTill}` : "—"}</span>
                  </button>

                  {canFullscreen && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        void toggleFullscreen();
                      }}
                      className="w-full min-h-11 px-3 py-2.5 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between font-medium sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      <span>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                      </svg>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Error alert banner */}
      {requestError && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs sm:text-sm text-red-600 dark:text-red-400 flex items-center justify-between z-20 shrink-0">
          <p role="alert">{requestError}</p>
          <button
            type="button"
            onClick={() => setRequestError(null)}
            className="min-h-11 px-2 font-medium hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* =========================================================================
          VIEWPORT: flex-1, overflow auto, centered
          Page canvas + text layer + highlight overlay, sized by fit mode
          ========================================================================= */}
      <main
        ref={viewportRef}
        className="relative flex-1 min-h-0 w-full overflow-auto bg-slate-200/80 dark:bg-slate-950 flex touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="m-auto p-2 sm:p-4 w-fit h-fit flex items-center justify-center">
          {documentError ? (
            <div className="p-8 text-center bg-[var(--background)] rounded-xl shadow border border-red-200 dark:border-red-900">
              <p className="text-red-600 dark:text-red-400 font-medium" role="alert">
                Could not render this PDF: {documentError}
              </p>
            </div>
          ) : (
            <Document
              file={currentSignedUrl}
              loading={<div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading PDF…</div>}
              onLoadError={(loadError) => setDocumentError(errorMessage(loadError))}
              onLoadSuccess={({ numPages: loadedPageCount }) => {
                setNumPages(loadedPageCount);
                const clampedPage = clampPage(currentPageRef.current, loadedPageCount);
                currentPageRef.current = clampedPage;
                setCurrentPage(clampedPage);
                setPageInput(String(clampedPage));
                setReadTill((page) => Math.min(page, loadedPageCount));
              }}
            >
              {pageWidth ? (
                <div
                  ref={pageWrapperRef}
                  className="relative select-text shadow-xl bg-white transition-[width] motion-reduce:transition-none duration-75 ease-out"
                  style={{ width: `${pageWidth}px` }}
                >
                  <Page
                    pageNumber={currentPage}
                    width={pageWidth}
                    renderAnnotationLayer
                    renderTextLayer
                    className="overflow-hidden"
                    loading={<div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading PDF…</div>}
                    onLoadSuccess={(page) => {
                      const vp = page.getViewport({ scale: 1 });
                      if (vp.height > 0 && vp.width > 0) {
                        setPageAspect(vp.width / vp.height);
                      }
                    }}
                  />

                  {/* Highlights overlay - percentages match page bounding box exactly */}
                  {pageHighlights.map((highlight) =>
                    highlight.rects.map((rect, index) => (
                      <div
                        key={`${highlight.id}-${index}`}
                        aria-hidden="true"
                        style={{
                          backgroundColor: highlight.color,
                          height: `${rect.height * 100}%`,
                          left: `${rect.left * 100}%`,
                          mixBlendMode: "multiply",
                          opacity: 0.4,
                          pointerEvents: "none",
                          position: "absolute",
                          top: `${rect.top * 100}%`,
                          width: `${rect.width * 100}%`,
                        }}
                      />
                    ))
                  )}
                </div>
              ) : null}

              {/* Prefetch adjacent pages to make page turning instantaneous with zero layout jump */}
              <div
                aria-hidden="true"
                className="sr-only fixed pointer-events-none opacity-0 h-0 w-0 overflow-hidden"
              >
                {currentPage > 1 && pageWidth ? (
                  <Page
                    pageNumber={currentPage - 1}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                ) : null}
                {currentPage < numPages && pageWidth ? (
                  <Page
                    pageNumber={currentPage + 1}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                ) : null}
              </div>
            </Document>
          )}
        </div>

        {/* Phase 3: Floating mini-popover near the selection */}
        {popoverPosition && selectionRange && (
          <div
            className="fixed z-40 bg-[var(--background)] border border-slate-200 dark:border-slate-700 shadow-xl rounded-xl p-1.5 flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: `${popoverPosition.left}px`,
              top: `${popoverPosition.top}px`,
            }}
            onPointerDown={(e) => e.preventDefault()}
          >
            {/* Color Swatch Options */}
            <div className="flex items-center gap-1 pr-1 border-r border-slate-200 dark:border-slate-700">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setSelectedHighlightColor(c.value);
                    void addHighlight(c.value);
                  }}
                  onPointerDown={(e) => e.preventDefault()}
                  className={`w-6 h-6 rounded-full ${c.bgClass} flex items-center justify-center transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    selectedHighlightColor === c.value ? "ring-2 ring-slate-900 dark:ring-white scale-105" : ""
                  }`}
                  aria-label={`Highlight in ${c.label}`}
                  title={c.label}
                />
              ))}
            </div>

            {/* Main Highlight Button */}
            <button
              type="button"
              onClick={() => void addHighlight(selectedHighlightColor)}
              onPointerDown={(e) => e.preventDefault()}
              disabled={isHighlighting}
              className="min-h-9 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium text-xs inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                />
              </svg>
              <span>Highlight</span>
            </button>
          </div>
        )}
      </main>

      {/* =========================================================================
          BOTTOM BAR: 56px + safe-area-bottom
          ‹ Prev | progress slider | [page input] / total | Next ›
          ========================================================================= */}
      <footer
        className={`h-[calc(56px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] flex items-center justify-between gap-2 sm:gap-4 border-t border-slate-200 dark:border-slate-800 bg-[var(--background)] z-30 shrink-0 transition-transform motion-reduce:transition-none duration-150 ease-out ${
          isFullscreen ? "absolute bottom-0 inset-x-0" : ""
        } ${isChromeHidden ? "translate-y-full pointer-events-none" : "translate-y-0"}`}
        aria-label="Page navigation"
      >
        {/* Prev Page Button */}
        <button
          type="button"
          onClick={() => changePage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="min-h-11 min-w-11 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 inline-flex items-center gap-1 text-slate-700 dark:text-slate-200"
          aria-label="Previous page"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          <span className="hidden sm:inline">Prev</span>
        </button>

        {/* Progress Slider Container */}
        <div className="relative flex-1 min-w-[120px] max-w-xl mx-1 sm:mx-2 flex items-center h-11">
          {/* Floating Dragging Tooltip */}
          {isDraggingSlider && (
            <div
              className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-slate-900 text-white text-[11px] font-medium shadow pointer-events-none z-20 whitespace-nowrap"
              style={{ left: `${draggingPercent}%` }}
            >
              Page {sliderDragPage}
            </div>
          )}

          {/* Slider track background */}
          <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full relative overflow-visible">
            {/* Filled track to current page */}
            <div
              className="h-full bg-sky-600 rounded-full"
              style={{ width: `${isDraggingSlider ? draggingPercent : sliderPercent}%` }}
            />

            {/* Read-till ribbon / tick mark */}
            {readTillPercent !== null && (
              <span
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-3.5 bg-emerald-500 rounded-sm shadow-sm z-10 pointer-events-none"
                style={{ left: `${readTillPercent}%` }}
                title={`Read till page ${readTill}`}
              />
            )}

            {/* Bookmarks ticks */}
            {numPages > 1 &&
              bookmarks.map((b) => {
                const tickPercent = ((b.page - 1) / (numPages - 1)) * 100;
                return (
                  <span
                    key={b.id}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-2 bg-amber-400 rounded-full shadow-sm z-10 pointer-events-none"
                    style={{ left: `${tickPercent}%` }}
                    title={`Bookmark: ${b.label || `Page ${b.page}`}`}
                  />
                );
              })}
          </div>

          {/* Real Range Input */}
          <input
            type="range"
            min={1}
            max={Math.max(numPages, 1)}
            value={isDraggingSlider ? sliderDragPage : currentPage}
            onInput={(e) => {
              setIsDraggingSlider(true);
              setSliderDragPage(Number((e.target as HTMLInputElement).value));
            }}
            onChange={(e) => {
              const val = Number(e.target.value);
              setSliderDragPage(val);
              changePage(val);
            }}
            onPointerUp={() => {
              if (isDraggingSlider) {
                setIsDraggingSlider(false);
                changePage(sliderDragPage);
              }
            }}
            onTouchEnd={() => {
              if (isDraggingSlider) {
                setIsDraggingSlider(false);
                changePage(sliderDragPage);
              }
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            aria-label="Reading progress"
          />
        </div>

        {/* [page input] / total */}
        <div className="flex items-center gap-1.5 text-xs sm:text-sm shrink-0">
          <input
            ref={pageInputRef}
            id="reader-page-input"
            type="number"
            min={1}
            max={numPages}
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={handlePageInputKeyDown}
            onFocus={(e) => {
              e.target.select();
              setIsPageInputFocused(true);
            }}
            onBlur={() => {
              commitPageInput();
              setIsPageInputFocused(false);
            }}
            className="w-12 sm:w-14 h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent text-center font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            aria-label={`Current page, page ${currentPage} of ${numPages}`}
          />
          <span className="text-slate-500 dark:text-slate-400">/ {numPages}</span>
        </div>

        {/* Next Page Button */}
        <button
          type="button"
          onClick={() => changePage(currentPage + 1)}
          disabled={currentPage >= numPages}
          className="min-h-11 min-w-11 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 inline-flex items-center gap-1 text-slate-700 dark:text-slate-200"
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </footer>

      {/* Phase 4: Pseudo-fullscreen hint for iOS Safari / Unsupported Fullscreen API */}
      {showPwaHint && (
        <div
          role="status"
          className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 text-xs font-medium px-4 py-2 rounded-xl shadow-2xl border border-slate-700 dark:border-slate-300 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <span>Add to Home Screen for true fullscreen</span>
          <button
            type="button"
            onClick={dismissPwaHint}
            className="text-xs font-semibold px-1.5 py-0.5 rounded hover:bg-slate-800 dark:hover:bg-slate-200"
            aria-label="Dismiss hint"
          >
            ✕
          </button>
        </div>
      )}

      {/* =========================================================================
          PHASE 3: TOAST NOTIFICATIONS STACK
          Floating feedback with optional action button (e.g. Undo)
          ========================================================================= */}
      <div
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none max-w-sm w-full px-4"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 text-xs sm:text-sm font-medium px-3.5 py-2 rounded-xl shadow-xl border border-slate-700 dark:border-slate-300 flex items-center justify-between gap-3 w-fit max-w-full animate-in fade-in slide-in-from-bottom-2 duration-150"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  setToasts((curr) => curr.filter((t) => t.id !== toast.id));
                }}
                className="underline font-semibold text-sky-400 dark:text-sky-600 hover:opacity-80 px-1 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* =========================================================================
          ANNOTATIONS OVERLAY DRAWER
          width: min(360px, 90vw), tabs "Bookmarks | Highlights"
          Does NOT resize page; slides over page
          ========================================================================= */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 motion-reduce:transition-none transition-opacity duration-150"
          onClick={() => setIsDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        ref={drawerRef}
        aria-label="Annotations drawer"
        aria-hidden={!isDrawerOpen}
        tabIndex={-1}
        className={`fixed top-0 right-0 bottom-0 z-50 w-[min(360px,90vw)] bg-[var(--background)] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col transform transition-transform motion-reduce:transition-none duration-150 ease-out focus:outline-none ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full pointer-events-none invisible"
        }`}
      >
        {/* Drawer Header */}
        <div className="h-[calc(48px+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
          <h2 className="font-semibold text-base">Annotations</h2>
          <button
            type="button"
            onClick={() => setIsDrawerOpen(false)}
            className="min-h-11 min-w-11 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            aria-label="Close annotations drawer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Drawer Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 shrink-0 px-2 pt-2">
          <button
            type="button"
            onClick={() => setDrawerTab("bookmarks")}
            className={`flex-1 min-h-11 pb-2 font-medium text-sm border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              drawerTab === "bookmarks"
                ? "border-sky-600 text-sky-600 dark:text-sky-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            Bookmarks ({bookmarks.length})
          </button>
          <button
            type="button"
            onClick={() => setDrawerTab("highlights")}
            className={`flex-1 min-h-11 pb-2 font-medium text-sm border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              drawerTab === "highlights"
                ? "border-sky-600 text-sky-600 dark:text-sky-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            Highlights ({highlights.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {drawerTab === "bookmarks" ? (
            bookmarks.length === 0 ? (
              <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm">
                <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                </svg>
                No bookmarks yet. Tap the bookmark icon to mark this page.
              </div>
            ) : (
              <ul className="space-y-2">
                {bookmarks.map((bookmark) => (
                  <li
                    key={bookmark.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        changePage(bookmark.page);
                        if (window.innerWidth < 1024) setIsDrawerOpen(false);
                      }}
                      className="min-h-11 flex-1 text-left text-sm font-medium text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      <span className="font-semibold text-slate-400 text-xs">p.{bookmark.page}</span>
                      <span>{bookmark.label || `Page ${bookmark.page}`}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          const prev = bookmarks;
                          setBookmarks((curr) => curr.filter((b) => b.id !== bookmark.id));
                          const { error } = await supabase.from("bookmarks").delete().eq("id", bookmark.id);
                          if (error) {
                            setBookmarks(prev);
                            setRequestError(`Could not delete bookmark: ${error.message}`);
                          } else {
                            showToast(`Deleted bookmark p.${bookmark.page}`);
                          }
                        })();
                      }}
                      className="min-h-11 min-w-11 p-2 text-slate-400 hover:text-red-600 transition-colors inline-flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      aria-label={`Delete bookmark on page ${bookmark.page}`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : highlights.length === 0 ? (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
              </svg>
              No highlights yet. Select text on any page and tap Highlight.
            </div>
          ) : (
            <ul className="space-y-3">
              {highlights.map((highlight) => (
                <li
                  key={highlight.id}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2 hover:bg-slate-50 dark:hover:bg-slate-850"
                >
                  <button
                    type="button"
                    onClick={() => {
                      changePage(highlight.page);
                      if (window.innerWidth < 1024) setIsDrawerOpen(false);
                    }}
                    className="w-full text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: highlight.color }}
                      />
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Page {highlight.page}
                      </span>
                    </div>
                    <p className="text-sm line-clamp-3 text-slate-800 dark:text-slate-200 mt-1">
                      {highlight.text}
                    </p>
                  </button>
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      disabled={deletingHighlightId === highlight.id}
                      onClick={() => void deleteHighlight(highlight)}
                      className="min-h-11 px-3 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      {deletingHighlightId === highlight.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
