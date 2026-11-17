import { RepoExplorer } from "@/components/RepoExplorer";
import { CompassIcon } from "@/components/icons";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-slate-900">
          <CompassIcon width={22} height={22} />
          <span className="text-[15px] font-semibold tracking-tight">Repo Compass</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pb-24 pt-14 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 text-balance sm:text-5xl">
            Find your way around any codebase
          </h1>
          <p className="mt-4 text-lg text-slate-600 text-pretty">
            Paste a public GitHub repository to see how it&apos;s organized — a clear starting point for reading
            unfamiliar code.
          </p>
        </div>

        <div className="mt-10 w-full">
          <RepoExplorer />
        </div>
      </main>

      <footer className="border-t border-slate-200/70 py-6 text-center text-xs text-slate-500">
        Repo Compass · Reads public repositories through the GitHub API
      </footer>
    </div>
  );
}
