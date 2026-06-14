export default function Home() {
  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-grid-paper bg-[size:40px_40px] opacity-20" />
      <div className="absolute left-[10%] top-20 -z-10 size-72 rounded-full bg-secondary/40 blur-3xl" />
      <div className="absolute bottom-0 right-[12%] -z-10 size-80 rounded-full bg-primary/10 blur-3xl" />

      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col gap-8 px-6 py-8 sm:px-10 lg:px-12">
        <div className="max-w-3xl border-b border-border/60 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            When Did I Last
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Keep a private running list of the things you forget to track.
          </h1>
          <p className="mt-4 text-base leading-7 text-foreground/72 sm:text-lg">
            The preset now behaves like your original app, but with encrypted sync, import and export, API-user provisioning, and shared mobile or web access.
          </p>
        </div>

      </section>
    </main>
  );
}