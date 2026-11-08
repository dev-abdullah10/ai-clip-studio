import { Compass, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="flex min-h-[65vh] items-center justify-center">
      <div className="panel max-w-md p-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-accent-400/30 bg-accent-500/10 text-accent-300">
          <Compass size={22} />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">404</p>
        <h1 className="mt-1 text-xl font-bold text-white">This page does not exist</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          The link may be outdated. Head back to the dashboard or start by importing a video.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/" className="btn-secondary">
            Dashboard
          </Link>
          <Link to="/import" className="btn-primary">
            <UploadCloud size={16} />
            Import video
          </Link>
        </div>
      </div>
    </div>
  );
}
