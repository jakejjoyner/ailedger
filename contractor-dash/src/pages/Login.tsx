import { useState } from "react";
import { KeyRound, Mail, Loader2 } from "lucide-react";
import { registerPasskey, loginPasskey } from "../lib/passkey";
import { config } from "../config";

interface Props {
  onLogin: () => void;
}

export default function Login({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"register" | "login" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleRegister() {
    setErr(null);
    setBusy("register");
    const r = await registerPasskey(email.trim(), config.displayName);
    setBusy(null);
    if (!r.ok) {
      setErr(errorText(r.reason));
      return;
    }
    onLogin();
  }

  async function handleLogin() {
    setErr(null);
    setBusy("login");
    const r = await loginPasskey(email.trim() || undefined);
    setBusy(null);
    if (!r.ok) {
      setErr(errorText(r.reason));
      return;
    }
    onLogin();
  }

  return (
    <div className="flex h-full items-center justify-center p-6 bg-paper">
      <div className="w-full max-w-md bg-surface border border-line rounded-xl shadow-2xl p-8">
        <h1
          className="text-prose mb-1"
          style={{ fontFamily: "var(--font-serif)", fontSize: 30, fontWeight: 400, lineHeight: 1.3, letterSpacing: "-0.01em" }}
        >
          Sign in
        </h1>
        <p className="text-muted mb-6" style={{ fontSize: 14, fontWeight: 400 }}>
          {config.displayName} · <span className="text-subtle">{config.dashOrigin.replace(/^https?:\/\//, "")}</span>
        </p>

        <label className="block text-muted mb-2" htmlFor="email" style={{ fontSize: 13, fontWeight: 500 }}>
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full px-3 py-2.5 bg-paper border border-line rounded-md text-prose placeholder:text-subtle focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
          style={{ fontSize: 14, fontWeight: 500 }}
        />

        <button
          type="button"
          onClick={handleLogin}
          disabled={busy !== null}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-md disabled:opacity-50 transition-colors"
          style={{ fontSize: 14, fontWeight: 500 }}
        >
          {busy === "login" ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          Sign in with passkey
        </button>

        <button
          type="button"
          onClick={handleRegister}
          disabled={busy !== null || email.trim().length === 0}
          className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-transparent border border-line hover:border-muted text-prose rounded-md disabled:opacity-50 transition-colors"
          style={{ fontSize: 14, fontWeight: 500 }}
        >
          {busy === "register" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          Register a passkey
        </button>

        {err && (
          <p className="mt-4 text-rose-400" role="alert" style={{ fontSize: 14, fontWeight: 400 }}>
            {err}
          </p>
        )}

        <p className="mt-6 text-subtle" style={{ fontSize: 13, fontWeight: 400, lineHeight: 1.6 }}>
          Passkeys replace passwords. Your device (Touch ID / Face ID / Windows Hello) stores a
          cryptographic key scoped to {config.rpId}; it never leaves your device.
        </p>
      </div>
    </div>
  );
}

function errorText(reason: string): string {
  if (reason === "email_not_allowed") return "This email is not authorized for this contractor portal.";
  if (reason === "email_required") return "Please enter your email.";
  if (reason === "browser_cancel") return "Passkey action canceled.";
  if (reason === "verification_failed") return "Passkey verification failed.";
  if (reason === "unknown_credential") return "This passkey is not registered for this contractor.";
  if (reason === "account_locked") return "Account locked after repeated failures. Contact your principal.";
  if (reason.startsWith("http_")) return `Sign-in failed (${reason.slice(5)}).`;
  return reason;
}
