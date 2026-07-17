// First-party page-view tracking → POST /api/track/.
// Fire-and-forget: tracking must never surface errors or slow the app.
//
// Identity model (mirrors backend api.models.PageView):
//  - anon_id    stable per browser (localStorage), whether or not logged in
//  - session_id one "visit"; rotates after 30 min of inactivity
// Engaged time comes from heartbeat pings sent only while the tab is visible.

const API_BASE_URL = import.meta.env.VITE_DJANGO_API_URL || "http://127.0.0.1:8000/api";
const AUTH_STORAGE_KEY = "orca_auth_token"; // keep in sync with AuthContext
const ANON_KEY = "orca_anon_id";
const SESSION_KEY = "orca_session_id";
const SESSION_LAST_KEY = "orca_session_last";
const SESSION_GAP_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;

const uuid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

const getAnonId = (): string => {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return "00000000-0000-0000-0000-000000000000"; // storage blocked — still count the view
  }
};

const getSessionId = (): string => {
  try {
    const now = Date.now();
    const last = Number(localStorage.getItem(SESSION_LAST_KEY) || 0);
    let id = localStorage.getItem(SESSION_KEY);
    if (!id || now - last > SESSION_GAP_MS) id = uuid();
    localStorage.setItem(SESSION_KEY, id);
    localStorage.setItem(SESSION_LAST_KEY, String(now));
    return id;
  } catch {
    return "00000000-0000-0000-0000-000000000000";
  }
};

const payload = (event: "view" | "ping", path: string) =>
  JSON.stringify({
    event,
    anon_id: getAnonId(),
    session_id: getSessionId(),
    path,
    ...(event === "view" && document.referrer ? { referrer: document.referrer } : {}),
  });

const send = (event: "view" | "ping", path: string) => {
  try {
    const token = localStorage.getItem(AUTH_STORAGE_KEY);
    fetch(`${API_BASE_URL}/track/`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Token ${token}` } : {}),
      },
      body: payload(event, path),
    }).catch(() => {});
  } catch {
    /* never break the app for analytics */
  }
};

let currentPath = "";
let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Log a one-off interaction (e.g. landing-demo steps) as a pseudo page view
 * without retargeting the heartbeat away from the real current page. */
export const trackDemoEvent = (pseudoPath: string) => {
  send("view", pseudoPath);
};

export const trackPageView = (path: string) => {
  currentPath = path;
  send("view", path);

  if (heartbeat === null) {
    heartbeat = setInterval(() => {
      if (document.visibilityState === "visible" && currentPath) send("ping", currentPath);
    }, HEARTBEAT_MS);

    // Final ping when the tab hides/closes. sendBeacon survives page unload
    // (a fetch would be cancelled); it can't carry headers, so the backend
    // parses it leniently and ties it to the session by anon/session id.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && currentPath) {
        try {
          navigator.sendBeacon(`${API_BASE_URL}/track/`, payload("ping", currentPath));
        } catch {
          /* ignore */
        }
      }
    });
  }
};
