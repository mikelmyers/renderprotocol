import { useEffect, useState } from "react";
import { ConversationPanel } from "./components/conversation/ConversationPanel";
import { AgentPicker } from "./components/conversation/AgentPicker";
import { RenderField } from "./components/render-field/RenderField";
import { XRayDrawer } from "./components/audit/XRayDrawer";
import { startSurfaceBus } from "./lib/surface-bus";
import { startConfig } from "./lib/config";
import { startNotifications } from "./lib/notifications";

export default function App() {
  const [xrayOpen, setXrayOpen] = useState(false);

  useEffect(() => {
    void startSurfaceBus();
    void startConfig();
    void startNotifications();
  }, []);

  // Cmd/Ctrl + . opens / closes the X-ray drawer. Discoverable via the
  // header button; keyboard shortcut is for the Mikel-class operator
  // who'll use it constantly.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setXrayOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell">
      <section className="pane pane--conversation">
        <header className="pane__header">
          <span>Conversation</span>
          <AgentPicker />
        </header>
        <ConversationPanel />
      </section>
      <section className="pane pane--render">
        <header className="pane__header">
          <span>Render field</span>
          <button
            className="xray-toggle"
            onClick={() => setXrayOpen((v) => !v)}
            title="X-ray (Cmd/Ctrl + .)"
            aria-label="Open X-ray drawer"
          >
            x-ray
          </button>
        </header>
        <RenderField />
      </section>
      <XRayDrawer open={xrayOpen} onClose={() => setXrayOpen(false)} />
    </div>
  );
}
