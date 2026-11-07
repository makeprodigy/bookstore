"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

const HINT_DISMISSED_KEY = "bookstore:pwa_hint_dismissed";

function checkIsBrowserTab(): boolean {
  if (typeof window === "undefined") return true;
  const isStandalone =
    (window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return !isStandalone;
}

function checkHasNativeFullscreen(): boolean {
  if (typeof window === "undefined") return false;
  const doc = document as unknown as {
    fullscreenEnabled?: boolean;
    webkitFullscreenEnabled?: boolean;
  };
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
}

export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [isBrowserTab] = useState(checkIsBrowserTab);
  const [hasNativeFullscreen] = useState(checkHasNativeFullscreen);
  const [showPwaHint, setShowPwaHint] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleFsChange = () => {
      const active = Boolean(
        document.fullscreenElement ??
        (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement
      );
      setIsFullscreen(active);
    };

    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
    };
  }, []);

  const enter = useCallback(async () => {
    const el = targetRef.current;
    if (!el) return;

    if (hasNativeFullscreen) {
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
          return;
        } else if (
          (el as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen
        ) {
          await (
            el as unknown as { webkitRequestFullscreen: () => Promise<void> }
          ).webkitRequestFullscreen();
          return;
        }
      } catch {
        // Fall back to pseudo-fullscreen on failure
      }
    }

    // Pseudo-fullscreen fallback (e.g. iPhone Safari or rejected fullscreen)
    setIsPseudoFullscreen(true);
    try {
      const dismissed = localStorage.getItem(HINT_DISMISSED_KEY);
      if (!dismissed) {
        setShowPwaHint(true);
      }
    } catch {}
  }, [hasNativeFullscreen, targetRef]);

  const exit = useCallback(async () => {
    if (isPseudoFullscreen) {
      setIsPseudoFullscreen(false);
      setShowPwaHint(false);
    }
    try {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (
          (document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen
        ) {
          await (
            document as unknown as { webkitExitFullscreen: () => Promise<void> }
          ).webkitExitFullscreen();
        }
      }
    } catch {}
  }, [isPseudoFullscreen]);

  const toggle = useCallback(async () => {
    if (isFullscreen || isPseudoFullscreen) {
      await exit();
    } else {
      await enter();
    }
  }, [isFullscreen, isPseudoFullscreen, enter, exit]);

  const dismissPwaHint = useCallback(() => {
    setShowPwaHint(false);
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, "1");
    } catch {}
  }, []);

  return {
    isFullscreen: isFullscreen || isPseudoFullscreen,
    isNativeFullscreen: isFullscreen,
    isPseudoFullscreen,
    isSupported: isBrowserTab, // Fullscreen button appears ONLY in browser tab
    showPwaHint,
    dismissPwaHint,
    toggle,
    enter,
    exit,
  };
}
