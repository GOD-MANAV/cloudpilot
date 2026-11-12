import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { useApi, usePoll } from "../api";

export function Terminal() {
  const { client } = useApi();
  const vm = usePoll(() => client!.vmStatus(), 15_000);
  const running = vm.data?.power === "running" && vm.data.agentHealthy;
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");
  const [gen, setGen] = useState(0);

  useEffect(() => {
    if (!running || !host.current || !client) return;
    const term = new XTerm({
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#05070f", foreground: "#E8EAF4", cursor: "#A99DFF", selectionBackground: "#344070" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    let ws: WebSocket | null = null;
    setState("connecting");
    void client.agentLink("/terminal", true).then((url) => {
      ws = new WebSocket(url);
      ws.onopen = () => {
        setState("open");
        ws!.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
        term.focus();
      };
      ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : "");
      ws.onclose = () => {
        setState("closed");
        term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
      };
    });
    const sub = term.onData((d) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "i", d })));
    const onResize = () => {
      fit.fit();
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      sub.dispose();
      ws?.close();
      term.dispose();
    };
  }, [running, client, gen]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Terminal</h1>
          <span className="sub">A bash shell on your machine. Keeps the machine awake while open.</span>
        </div>
        {state === "closed" && (
          <button className="btn btn-secondary" onClick={() => setGen((g) => g + 1)}>
            Reconnect
          </button>
        )}
      </header>
      {running ? <div className="term" ref={host} /> : <div className="empty">Start the machine to open a terminal.</div>}
    </>
  );
}
