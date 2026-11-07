"use client";

import dynamic from "next/dynamic";

import type { ReaderProps } from "./reader.types";

const Reader = dynamic(() => import("./reader").then((module) => module.Reader), {
  loading: () => <p className="p-6 text-slate-600 dark:text-slate-300">Loading reader…</p>,
  ssr: false,
});

export function ReaderLoader(props: ReaderProps) {
  return <Reader {...props} />;
}
