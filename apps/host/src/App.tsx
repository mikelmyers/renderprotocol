import { useEffect } from "react";
import { ConversationPanel } from "./components/conversation/ConversationPanel";
import { RenderField } from "./components/render-field/RenderField";
import { startSurfaceBus } from "./lib/surface-bus";
import { useConfig } from "./lib/use-config";

export default function App() {
  useEffect(() => {
    void startSurfaceBus();
  }, []);

  const config = useConfig();
  const agentName = config.agent?.title ?? "your agent";

  return (
    <div className="shell">
      <section className="pane pane--conversation">
        <header className="pane__header">
          <span>Conversation</span>
          <span>{agentName}</span>
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
