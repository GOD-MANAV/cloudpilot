import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApiProvider, useApi } from "./api";
import { Access } from "./pages/Access";
import { Live } from "./pages/Live";
import { Login } from "./pages/Login";
import { Meetings } from "./pages/Meetings";
import { Notes } from "./pages/Notes";
import { Overview } from "./pages/Overview";
import { Settings } from "./pages/Settings";
import "./styles.css";
import { Icon, Logo } from "./ui";

const Terminal = lazy(() => import("./pages/Terminal").then((m) => ({ default: m.Terminal })));

const ROUTES = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "meetings", label: "Meetings", icon: "calendar" },
  { id: "live", label: "Live meeting", icon: "video" },
  { id: "notes", label: "Meeting notes", icon: "image" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "access", label: "AI access", icon: "key" },
  { id: "settings", label: "Settings", icon: "settings" },
] as const;

function useHashRoute(): [string, (r: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, "") || "overview";
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return [r, (x) => (location.hash = `/${x}`)];
}

function App() {
  const { session } = useApi();
  const [route, go] = useHashRoute();
  if (!session) return <Login />;
  const page =
    route === "meetings" ? <Meetings go={go} /> :
    route === "live" ? <Live /> :
    route === "notes" ? <Notes /> :
    route === "terminal" ? <Terminal /> :
    route === "access" ? <Access /> :
    route === "settings" ? <Settings /> :
    <Overview go={go} />;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <Logo /> CloudPilot
        </div>
        {ROUTES.map((r) => (
          <a key={r.id} className="nav-link" href={`#/${r.id}`} aria-current={route === r.id ? "page" : undefined}>
            <Icon name={r.icon} /> {r.label}
          </a>
        ))}
      </nav>
      <main className="main">
        <Suspense fallback={<span className="sub">Loading…</span>}>{page}</Suspense>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApiProvider>
      <App />
    </ApiProvider>
  </StrictMode>,
);
