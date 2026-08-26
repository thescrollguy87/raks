import { createContext, useContext, useState, useEffect, useMemo } from "react";

// The prototype's CSS requires .topbar to be a fixed-height flex sibling of
// .content (not nested inside it) — .main is a flex column with .topbar
// (flex-shrink:0) above .content (flex:1, overflow-y:auto). If a page
// rendered its own topbar inside .content, it would scroll away with the
// page instead of staying fixed, breaking the original layout. This
// context lets each page *describe* its header (title/subtitle/actions)
// via usePageHeader(), while AppLayout renders the actual <TopBar> in the
// correct DOM position.
const PageHeaderContext = createContext(null);

export function PageHeaderProvider({ children }) {
  const [header, setHeader] = useState({ title: "", subtitle: "", actions: null });
  const value = useMemo(() => ({ header, setHeader }), [header]);
  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

export function usePageHeader({ title, subtitle, actions = null }) {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeader must be used within a PageHeaderProvider");
  const { setHeader } = ctx;
  useEffect(() => {
    setHeader({ title, subtitle, actions });
    // No cleanup resetting to blank on unmount — the next page's own
    // usePageHeader call will overwrite it before the old title is ever
    // visible, avoiding a one-frame flash of an empty header.
  }, [title, subtitle, actions, setHeader]);
}

export function useHeaderState() {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("useHeaderState must be used within a PageHeaderProvider");
  return ctx.header;
}
