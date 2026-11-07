export default function ReaderLoading() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-6 aspect-[3/4] animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
    </main>
  );
}
