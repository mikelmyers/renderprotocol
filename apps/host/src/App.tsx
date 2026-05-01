import { useEffect } from "react";
import { ConversationPanel } from "./components/conversation/ConversationPanel";
import { AgentPicker } from "./components/conversation/AgentPicker";
import { RenderField } from "./components/render-field/RenderField";
import { startSurfaceBus } from "./lib/surface-bus";
import { startConfig } from "./lib/config";

export default function App() {
  useEffect(() => {
    void startSurfaceBus();
    void startConfig();
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
          <span>v0</span>
        </header>
        <RenderField />
      </section>
    </div>
  );
}
