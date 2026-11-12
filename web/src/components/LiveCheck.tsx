import { useState } from "react";

export function LiveCheck({ label, cmd, run, expect }: { label: string; cmd: string; run: () => Promise<string>; expect?: string }) {
  const [state, setState] = useState<"idle" | "run" | "ok" | "bad" | "err">("idle");
  const [out, setOut] = useState("");
  const go = async () => {
    setState("run");
    setOut("");
    try {
      const r = await run();
      setOut(r);
      setState(expect === undefined || r.includes(expect) ? "ok" : "bad");
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
      setState("err");
    }
  };
  return (
    <div className={`live live-${state}`}>
      <div className="live-head">
        <span className="mono live-label">{label}</span>
        <button className="btn btn-sm" onClick={go} disabled={state === "run"}>
          <span>{state === "run" ? "Asking the chain…" : state === "idle" ? "Run in browser" : "Run again"}</span>
        </button>
      </div>
      <pre className="live-cmd mono">{cmd}</pre>
      <div className="live-out mono" aria-live="polite">
        {state === "idle" && <span className="dim">Calls testnet RPC directly from this page. No keys needed.</span>}
        {state === "run" && <span className="dim">…</span>}
        {out && <><b className={`pill pill-${state}`}>{state === "ok" ? "as expected" : state === "bad" ? "unexpected" : "error"}</b><code>{out}</code></>}
      </div>
    </div>
  );
}
