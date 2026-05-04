// SafeMarkdown — single shared markdown renderer used by every primitive
// that displays agent-authored prose. Centralising it means the safe
// defaults (no raw HTML, URI-allowlist, target=_blank w/ noopener) live
// in one place — security review here covers every primitive.
//
// react-markdown's defaults already disable raw HTML and apply a
// URI-allowlist via urlTransform (http/https/mailto/tel only — javascript:
// and data: blocked). The `<a>` override below ensures external links
// open in a new context with the standard rel attributes; in a Tauri
// webview that prevents in-window navigation that would replace the app.

import Markdown from "react-markdown";

interface Props {
  children: string;
}

const COMPONENTS = {
  a: ({
    href,
    children,
    ...rest
  }: {
    href?: string;
    children?: React.ReactNode;
  }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  ),
} as const;

export function SafeMarkdown({ children }: Props) {
  return <Markdown components={COMPONENTS}>{children}</Markdown>;
}
