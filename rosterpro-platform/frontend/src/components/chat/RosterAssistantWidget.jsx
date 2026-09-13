import { useState, useRef, useEffect } from "react";
import { useStation } from "../../store/StationContext.jsx";
import * as chatApi from "../../api/chat.js";

// Floating "Ask the Roster Assistant" button + expandable panel, mounted
// once in AppLayout so it's reachable from every page. Every answer is
// grounded in real tool calls (see chatToolsService.js on the backend) —
// this component's only job is showing the conversation and, on request,
// exactly which tool(s) produced an answer, so nothing here is ever
// presented as more certain than the real data actually was.
export default function RosterAssistantWidget() {
  const { stationId, currentStation } = useStation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role: "user"|"assistant", text, toolCalls?, outcome?}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  async function send() {
    const question = input.trim();
    if (!question || busy) return;
    if (!stationId) { setError("Select a station first."); return; }

    setMessages(m => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const result = await chatApi.askAssistant(stationId, question);
      setMessages(m => [...m, { role: "assistant", text: result.answer, toolCalls: result.toolCalls || [], outcome: result.outcome }]);
    } catch (err) {
      setMessages(m => [...m, { role: "assistant", text: err.message || "Something went wrong answering that.", toolCalls: [], outcome: "error" }]);
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <>
      <button
        className="chat-fab" onClick={() => setOpen(o => !o)}
        title="Ask the Roster Assistant" aria-label="Ask the Roster Assistant"
      >
        {open ? "✕" : "🤖"}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <div>
              <div className="chat-panel-title">🤖 Roster Assistant</div>
              <div className="chat-panel-sub">{currentStation ? `${currentStation.name} (${currentStation.iataCode})` : "No station selected"}</div>
            </div>
            <button className="chat-panel-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="chat-panel-body" ref={listRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                Ask me things like "Do I have enough NCS Tuesday night?" or "Which departures tomorrow still need a releaser?" — every answer comes from real roster data via a real backend lookup, never guessed.
              </div>
            )}
            {messages.map((m, i) => <ChatMessage key={i} message={m} />)}
            {busy && <div className="chat-bubble chat-bubble-assistant chat-thinking">Thinking…</div>}
          </div>

          {error && <div className="chat-panel-error">{error}</div>}

          <div className="chat-panel-input">
            <textarea
              className="chat-input" placeholder="Ask about coverage, departures, staff, task master…"
              value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={busy} rows={1}
            />
            <button className="chat-send-btn" onClick={send} disabled={busy || !input.trim()}>➤</button>
          </div>
        </div>
      )}
    </>
  );
}

function ChatMessage({ message }) {
  const [showTools, setShowTools] = useState(false);

  if (message.role === "user") {
    return <div className="chat-bubble chat-bubble-user">{message.text}</div>;
  }

  // Three visually distinct assistant states, per the spec: a normal
  // grounded answer, an access-denied decline, and "no tool was used"
  // (either a genuine no-matching-tool decline, or a plain reply that
  // simply didn't need one) — never rendered as a generic error bubble.
  const isDenied = message.outcome === "access_denied";
  const isError = message.outcome === "error";
  const hasTools = message.toolCalls && message.toolCalls.length > 0;

  return (
    <div className={`chat-bubble chat-bubble-assistant${isDenied ? " chat-bubble-denied" : ""}${isError ? " chat-bubble-error" : ""}`}>
      {isDenied && <div className="chat-status-tag chat-status-denied">🚫 Access denied — different station</div>}
      {isError && <div className="chat-status-tag chat-status-error">⚠ Couldn't answer</div>}
      {!isDenied && !isError && !hasTools && <div className="chat-status-tag chat-status-notool">ℹ No tool used for this reply</div>}
      <div>{message.text}</div>
      {hasTools && (
        <div className="chat-tools">
          <button className="chat-tools-toggle" onClick={() => setShowTools(s => !s)}>
            {showTools ? "▼" : "▶"} 🔧 {message.toolCalls.length} tool call{message.toolCalls.length > 1 ? "s" : ""} used
          </button>
          {showTools && (
            <div className="chat-tools-detail">
              {message.toolCalls.map((t, i) => (
                <div key={i} className="chat-tool-call">
                  <div className="chat-tool-name">{t.name}({Object.entries(t.args || {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})</div>
                  <pre className="chat-tool-result">{JSON.stringify(t.result, null, 1)}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
