import { useMemo, useReducer, useState } from "react";
import { createApiClient } from "./api/client.ts";
import { Composer } from "./chat/Composer.tsx";
import { toDisplayError } from "./chat/errors.ts";
import { MessageList } from "./chat/MessageList.tsx";
import { DEFAULT_API_URL } from "./api/url.ts";
import { loadApiUrl, resetApiUrl, saveApiUrl, type ApiUrlSetting } from "./settings/api-url-store.ts";
import { SettingsDialog } from "./settings/SettingsDialog.tsx";
import { TraceDrawer } from "./trace/TraceDrawer.tsx";
import { canSend, conversationReducer, initialConversation } from "./state/conversation.ts";

interface Props {
  /** Injected by the tests; the app itself uses the browser's. */
  fetch?: typeof fetch;
  storage?: Storage | null;
  newId?: () => string;
  now?: () => Date;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function App(props: Props) {
  const doFetch = props.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const newId = props.newId ?? (() => crypto.randomUUID());
  const now = props.now ?? (() => new Date());
  const [storage] = useState(() => (props.storage !== undefined ? props.storage : browserStorage()));
  const [apiUrl, setApiUrl] = useState<ApiUrlSetting>(() => loadApiUrl(storage));
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [state, dispatch] = useReducer(conversationReducer, initialConversation);
  const [traceItemId, setTraceItemId] = useState<string | null>(null);
  const client = useMemo(() => createApiClient({ baseUrl: apiUrl.url, fetch: doFetch }), [apiUrl.url, doFetch]);

  async function send(text: string) {
    if (!canSend(state)) return;
    dispatch({ type: "send", id: newId(), text, at: now().toISOString() });
    const outcome = await client.sendChat({
      message: text,
      ...(state.conversationId !== null ? { conversationId: state.conversationId } : {}),
    });
    const at = now().toISOString();
    if (outcome.kind === "answered") {
      dispatch({ type: "answered", id: newId(), result: outcome.result, at });
    } else if (outcome.kind === "pending" || outcome.kind === "denied") {
      // US3 handles a 202 (a card); until then it is not something this screen can show.
      dispatch({ type: "failed", id: newId(), error: toDisplayError({ kind: "malformed", status: 202 }), retryText: text, at });
    } else {
      dispatch({ type: "failed", id: newId(), error: toDisplayError(outcome), retryText: text, at });
    }
  }

  function saveUrl(url: string) {
    setApiUrl({ url, source: "saved", persistent: saveApiUrl(storage, url) });
    setSettingsOpen(false);
  }

  function restoreDefaultUrl() {
    setApiUrl({ url: DEFAULT_API_URL, source: "default", persistent: resetApiUrl(storage) });
    setSettingsOpen(false);
  }

  function reset() {
    setTraceItemId(null);
    dispatch({ type: "reset" });
  }

  const traced = state.items.find((item) => item.id === traceItemId);

  const last = state.items.at(-1);
  const retryItemId = last?.kind === "error" && !state.inFlight ? last.id : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>OpsPilot · War Room</h1>
        <span className="api-url" title={apiUrl.url}>
          {apiUrl.url}
          {apiUrl.source === "default" ? " (padrão)" : ""}
        </span>
        <button type="button" className="btn" onClick={() => reset()}>
          Nova conversa
        </button>
        <button
          type="button"
          className="btn btn-icon"
          aria-label="Configurações"
          title="Configurações"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </header>
      <MessageList
        items={state.items}
        retryItemId={retryItemId}
        onRetry={(text) => void send(text)}
        onNewConversation={reset}
        onShowTrace={setTraceItemId}
      />
      {traced?.kind === "answer" && <TraceDrawer result={traced.result} onClose={() => setTraceItemId(null)} />}
      {settingsOpen && (
        <SettingsDialog
          setting={apiUrl}
          onSave={saveUrl}
          onReset={restoreDefaultUrl}
          onCancel={() => setSettingsOpen(false)}
        />
      )}
      <Composer disabled={!canSend(state)} inFlight={state.inFlight} onSend={(text) => void send(text)} />
    </div>
  );
}
