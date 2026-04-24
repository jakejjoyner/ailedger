// Friendly error text for surfaces shown to non-technical users.
//
// Input is either a backend error code (e.g. "TIMEOUT", "SPAWN", "EXIT_139")
// or one of our transport-layer codes ("jo_send_500", "jo_stream_404",
// "jo_create_503", "session_expired") — or a raw thrown message.
//
// Output is a short, plain-English sentence. No stack traces, no jargon.
// Something a salesperson can read and decide what to do.

export function friendlyJoError(codeOrMessage: string): string {
  const c = (codeOrMessage || "").trim();

  // Backend turn codes
  if (/^TIMEOUT$/i.test(c)) return "Jo took too long to answer. Try asking again.";
  if (/^SPAWN$/i.test(c)) return "Couldn't start Jo just now. Give it a moment and try again.";
  if (/^EXIT_\d+$/i.test(c)) return "Jo stopped unexpectedly. Try asking again.";
  if (/^CANCELLED$/i.test(c)) return "Stopped. Ask Jo something else when you're ready.";

  // Transport codes from lib/jo.ts
  if (c === "session_expired") return "Signed out. Please sign in again.";
  if (c === "jo_send_404" || c === "jo_stream_404") {
    return "Jo's session ended. Starting a fresh one now…";
  }
  if (/^jo_send_5\d\d$/.test(c)) return "Couldn't send that — try again?";
  if (/^jo_stream_5\d\d$/.test(c)) return "Lost the connection to Jo. Try again?";
  if (/^jo_create_/.test(c)) return "Couldn't start a new chat. Try again?";
  if (/^jo_list_/.test(c)) return "Couldn't load your chats. Check your connection.";
  if (/^jo_ping_/.test(c)) return "Couldn't send that. Try again?";

  // Generic HTTP status suffixes ("_401", "_403", "_500")
  if (/_401$/.test(c)) return "Signed out. Please sign in again.";
  if (/_403$/.test(c)) return "You don't have access to that.";
  if (/_5\d\d$/.test(c)) return "Something went wrong on our side. Try again in a moment.";

  // Browser / network
  if (/NetworkError|Failed to fetch|network/i.test(c)) {
    return "Couldn't reach Jo. Check your internet connection.";
  }

  // Default — preserve Capitalized sentence form if it looks human, else
  // fall back to a generic friendly line.
  if (/^[A-Z][a-z]/.test(c) && /[a-z]/.test(c) && c.length < 120) return c;
  return "Couldn't send that — try again?";
}
