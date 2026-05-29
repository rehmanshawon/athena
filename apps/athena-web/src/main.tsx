import React from "react";
import ReactDOM from "react-dom/client";
import { Clipboard, RefreshCw } from "lucide-react";
import "./styles.css";

type SessionStatus = "processing" | "completed" | "failed";

interface SolverSession {
  id: string;
  createdAt: string;
  status: SessionStatus;
  codingStack: string;
  taskType: string;
  confidence: string;
  finalAnswer: string;
  explanation: string;
  copyReadyOutput: string;
  rawModelOutput: string;
  error: string | null;
}

const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");
const basePath = normalizeBasePath(import.meta.env.BASE_URL);

function App() {
  const route = stripBasePath(window.location.pathname, basePath);
  const match = route.match(/^\/session\/([^/]+)$/);
  const mode = match ? "session" : "latest";
  const sessionId = match?.[1] || null;
  const [session, setSession] = React.useState<SolverSession | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const endpoint = mode === "latest" ? "/api/sessions/latest" : `/api/sessions/${sessionId}`;
      const response = await fetch(`${apiUrl}${endpoint}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed: ${response.status}`);
      }
      const data = (await response.json()) as SolverSession;
      setSession(data);
      if (mode === "latest") {
        window.history.replaceState(null, "", withBasePath("/latest", basePath));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load session");
    }
  }, [mode, sessionId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (session?.status !== "processing") {
      return;
    }

    const id = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(id);
  }, [load, session?.status]);

  async function copyOutput() {
    const text = session?.copyReadyOutput || session?.finalAnswer || "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-5 sm:px-6">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Athena</h1>
            <p className="mt-1 text-sm text-stone-600">Latest visual task result</p>
          </div>
          <button className="iconButton" onClick={() => void load()} aria-label="Refresh latest">
            <RefreshCw size={19} />
          </button>
        </header>

        {error ? <Notice tone="error" text={error} /> : null}
        {!session && !error ? <Notice tone="neutral" text="Loading result..." /> : null}
        {session ? (
          <article className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge label={session.status} status={session.status} />
              <Badge label={session.taskType} />
              <Badge label={`${session.confidence} confidence`} />
              {session.taskType === "CODING" ? <Badge label={session.codingStack} /> : null}
            </div>

            <Panel title="Final Answer" body={session.error || session.finalAnswer || "Waiting for the result..."} prominent />
            <Panel title="Explanation" body={session.explanation || "No explanation yet."} />
            <section className="rounded-md border border-stone-300 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
                <h2 className="text-sm font-semibold">Copy-ready Output</h2>
                <button className="textButton" onClick={() => void copyOutput()}>
                  <Clipboard size={16} />
                  {copied ? "Copied" : "Copy Output"}
                </button>
              </div>
              <pre className="min-h-28 whitespace-pre-wrap break-words px-4 py-3 text-sm leading-6">
                {session.copyReadyOutput || session.finalAnswer || "Output will appear here."}
              </pre>
            </section>

            <footer className="pb-8 text-xs text-stone-500">
              Session {session.id} · {new Date(session.createdAt).toLocaleString()}
            </footer>
          </article>
        ) : null}
      </section>
    </main>
  );
}

function normalizeBasePath(value: string) {
  if (!value || value === "/") {
    return "";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function stripBasePath(pathname: string, base: string) {
  if (!base || !pathname.startsWith(base)) {
    return pathname;
  }

  return pathname.slice(base.length) || "/";
}

function withBasePath(pathname: string, base: string) {
  return `${base}${pathname}`;
}

function Badge({ label, status }: { label: string; status?: SessionStatus }) {
  const tone =
    status === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "failed"
        ? "border-red-200 bg-red-50 text-red-800"
        : status === "processing"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-stone-300 bg-white text-stone-700";
  return <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase ${tone}`}>{label}</span>;
}

function Notice({ text, tone }: { text: string; tone: "error" | "neutral" }) {
  const className = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-stone-300 bg-white text-stone-700";
  return <div className={`rounded-md border px-4 py-3 text-sm ${className}`}>{text}</div>;
}

function Panel({ title, body, prominent = false }: { title: string; body: string; prominent?: boolean }) {
  return (
    <section className="rounded-md border border-stone-300 bg-white px-4 py-3">
      <h2 className="mb-2 text-sm font-semibold text-stone-700">{title}</h2>
      <p className={`${prominent ? "text-lg" : "text-sm"} whitespace-pre-wrap break-words leading-7`}>{body}</p>
    </section>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
