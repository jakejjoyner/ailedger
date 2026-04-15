import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useTheme } from './useTheme'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from './supabase'
import LogTable from './components/LogTable'
import Header from './components/Header'
import ReportGenerator from './components/ReportGenerator'
import ApiKeys from './components/ApiKeys'
import SystemSettings from './components/SystemSettings'
import Billing from './components/Billing'
import OnboardingChecklist from './components/OnboardingChecklist'
import ResetPassword from './components/ResetPassword'
import AdminLogs from './components/AdminLogs'
import './index.css'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [isRecovery, setIsRecovery] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  type Tab = 'logs' | 'keys' | 'settings' | 'billing' | 'admin'
  const allTabs: Tab[] = ['logs', 'keys', 'settings', 'billing', 'admin']
  const pathTab = window.location.pathname.replace('/', '') as Tab
  const [tab, setTab] = useState<Tab>(allTabs.includes(pathTab) ? pathTab : 'logs')
const [checkoutBanner, setCheckoutBanner] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('checkout') !== 'success') return null
    const plan = p.get('plan') ?? ''
    return plan.startsWith('scale') ? 'Scale' : 'Pro'
  })

  function switchTab(t: Tab) {
    setTab(t)
    history.pushState(null, '', `/${t}`)
  }

  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname.replace('/', '') as Tab
      setTab(allTabs.includes(p) ? p : 'logs')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const [loading, setLoading] = useState(true)
  const [theme, toggleTheme] = useTheme()

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') === 'success') {
      history.replaceState(null, '', '/billing')
      setTimeout(() => setCheckoutBanner(null), 6000)
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      setLoading(false)
      if (session && window.location.hash.includes('access_token')) {
        history.replaceState(null, '', '/logs')
        setTab('logs')
      }
      if (session) {
        const { data } = await supabase.from('admins').select('customer_id').eq('customer_id', session.user.id).maybeSingle()
        setIsAdmin(!!data)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
      } else if (event === 'SIGNED_IN') {
        setIsRecovery(false)
        history.replaceState(null, '', '/logs')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    )
  }

  if (isRecovery) {
    return <ResetPassword onDone={() => setIsRecovery(false)} />
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4" style={{ background: theme === 'light' ? '#f8fafc' : '#0f1117' }}>
        <div className="w-full max-w-sm p-8 rounded-xl border" style={{
          background: theme === 'light' ? '#ffffff' : '#1a1d27',
          borderColor: theme === 'light' ? '#e2e8f0' : '#1e293b',
        }}>
          <div className="mb-8 text-center">
            <h1 style={{ color: theme === 'light' ? '#0f172a' : '#ffffff', fontSize: 22, fontWeight: 600, letterSpacing: '-0.3px' }}>AILedger</h1>
            <p style={{ color: theme === 'light' ? '#475569' : '#94a3b8', fontSize: 13, marginTop: 4 }}>AI audit infrastructure</p>
          </div>
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            theme={theme}
            providers={['google', 'github']}
            redirectTo="https://dash.ailedger.dev/reset-password"
            view={new URLSearchParams(window.location.search).get('view') === 'sign-up' ? 'sign_up' : 'sign_in'}
          />
          <p style={{ color: '#64748b', fontSize: 11, marginTop: 16, textAlign: 'center', lineHeight: 1.5 }}>
            If you don't see a verification email, check your spam folder.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header session={session} theme={theme} onToggleTheme={toggleTheme} onLogoClick={() => switchTab('logs')} />
      {checkoutBanner && (
        <div className="bg-emerald-900/40 border-b border-emerald-700/50 px-6 py-3 flex items-center justify-between">
          <span className="text-emerald-400 text-sm font-medium">You're on {checkoutBanner}. Welcome aboard.</span>
          <button onClick={() => setCheckoutBanner(null)} style={{ cursor: 'pointer' }} className="text-emerald-600 hover:text-emerald-400 text-lg leading-none">×</button>
        </div>
      )}
      <main className="dashboard-main px-5 py-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-white">Dashboard</h1>
            <p className="text-slate-400 text-sm mt-0.5">EU AI Act - Article 12 compliance records</p>
          </div>
          {tab === 'logs' && (
            <ReportGenerator customerId={session.user.id} customerEmail={session.user.email ?? ''} onUpgrade={() => switchTab('billing')} />
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-6 border-b border-slate-800" style={{ marginLeft: -8 }}>
          {(['logs', 'keys', 'settings', 'billing', ...(isAdmin ? ['admin'] : [])] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              style={{ cursor: 'pointer' }}
              className={`relative px-2 py-2 text-sm font-medium transition-colors ${
                tab === t ? 'text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="hidden sm:inline">{t === 'logs' ? 'Inference Logs' : t === 'keys' ? 'API Keys' : t === 'settings' ? 'Settings' : t === 'billing' ? 'Billing' : 'Admin'}</span>
              <span className="sm:hidden">{t === 'logs' ? 'Logs' : t === 'keys' ? 'Keys' : t === 'settings' ? 'Settings' : t === 'billing' ? 'Billing' : 'Admin'}</span>
              {tab === t && (
                <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {tab === 'logs' && (
          <>
            <OnboardingChecklist customerId={session.user.id} onGoToKeys={() => switchTab('keys')} />
            <LogTable customerId={session.user.id} onUpgrade={() => switchTab('billing')} />
          </>
        )}
        {tab === 'keys' && <ApiKeys customerId={session.user.id} onUpgrade={() => switchTab('billing')} />}
        {tab === 'settings' && <SystemSettings customerId={session.user.id} />}
        {tab === 'billing' && <Billing />}
        {tab === 'admin' && isAdmin && <AdminLogs />}
      </main>
    </div>
  )
}
