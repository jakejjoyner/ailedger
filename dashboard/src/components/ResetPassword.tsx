import { useState } from 'react'
import { supabase } from '../supabase'

interface Props {
  onDone: () => void
}

export default function ResetPassword({ onDone }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) { setError(error.message); return }
    setDone(true)
    setTimeout(() => {
      history.replaceState(null, '', '/logs')
      onDone()
    }, 1800)
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4" style={{ background: '#0f1117' }}>
      <div className="w-full max-w-sm p-8 bg-[#1a1d27] rounded-xl border border-slate-800">
        <div className="mb-8 text-center">
          <h1 className="text-white" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.3px' }}>AILedger</h1>
          <p className="text-slate-400" style={{ fontSize: 13, marginTop: 4 }}>
            {done ? 'Password updated' : 'Set a new password'}
          </p>
        </div>

        {done ? (
          <div className="text-center">
            <div className="text-emerald-400 text-sm mb-2">All set. Signing you in...</div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 6 }}>
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                placeholder="At least 8 characters"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'rgba(30,34,48,0.8)',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  color: '#e2e8f0',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'rgba(30,34,48,0.8)',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  color: '#e2e8f0',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>

            {error && (
              <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                cursor: loading ? 'default' : 'pointer',
                width: '100%',
                padding: '9px 16px',
                background: loading ? '#1e293b' : '#4f46e5',
                color: loading ? '#64748b' : '#ffffff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                transition: 'background 0.15s',
              }}
            >
              {loading ? 'Updating...' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
