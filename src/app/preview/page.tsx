"use client";

import dynamic from "next/dynamic";
import type { ReaderProps } from "@/app/read/[id]/reader.types";

const Reader = dynamic(() => import("@/app/read/[id]/reader").then((mod) => mod.Reader), {
  loading: () => <p className="p-6 text-slate-600 dark:text-slate-300">Loading reader…</p>,
  ssr: false,
});

export default function PreviewPage() {
  const sampleProps: ReaderProps = {
    bookId: "00000000-0000-0000-0000-000000000001",
    title: "Designing Data-Intensive Applications",
    signedUrl: "/sample.pdf",
    initialLastPage: 1,
    initialNumPages: 3,
    initialReadTill: 2,
    initialBookmarks: [
      {
        id: "b1",
        page: 1,
        label: "Chapter 1: Reliability",
        created_at: new Date().toISOString(),
      },
      {
        id: "b2",
        page: 3,
        label: "Chapter 3: Storage and Retrieval",
        created_at: new Date().toISOString(),
      },
    ],
    initialHighlights: [
      {
        id: "h1",
        page: 1,
        color: "#facc15",
        text: "Page 1: Architecture of Antigravity Reader",
        rects: [{ left: 0.11, top: 0.11, width: 0.65, height: 0.045 }],
        created_at: new Date().toISOString(),
      },
    ],
    initialDataError: null,
    userId: "00000000-0000-0000-0000-000000000002",
  };

  return <Reader {...sampleProps} />;
}
