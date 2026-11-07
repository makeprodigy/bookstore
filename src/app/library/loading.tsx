export default function LibraryLoading() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6" aria-busy="true">
      <div className="h-9 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-8 h-36 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
    </main>
  );
}
