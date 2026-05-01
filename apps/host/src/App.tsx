import { useEffect } from "react";
import { ConversationPanel } from "./components/conversation/ConversationPanel";
import { RenderField } from "./components/render-field/RenderField";
import { startSurfaceBus } from "./lib/surface-bus";

export default function App() {
  useEffect(() => {
    void startSurfaceBus();
  }, []);

  return (
    <div className="shell">
      <section className="pane pane--conversation">
        <header className="pane__header">
          <span>Conversation</span>
          <span>primordia-ops</span>
        </header>
        <ConversationPanel />
      </section>
      <section className="pane pane--render">
        <header className="pane__header">
          <span>Render field</span>
          <span>v0</span>
        </header>
        <RenderField />
      </section>
    </div>
  );
}
