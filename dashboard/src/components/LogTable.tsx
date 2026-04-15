import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import UpgradeModal from './UpgradeModal'

const PLAN_LIMITS: Record<string, number | null> = {
  free: 10_000,
  pro: 500_000,
  scale: null,
}

function getPlanTier(plan: string | null | undefined): 'free' | 'pro' | 'scale' {
  if (!plan) return 'free'
  if (plan.startsWith('pro')) return 'pro'
  if (plan.startsWith('scale')) return 'scale'
  return 'free'
}

interface LogEntry {
  id: number
  logged_at: string
  started_at: string | null
  completed_at: string | null
  provider: string
  model_name: string | null
  path: string
  input_hash: string | null
  output_hash: string | null
  status_code: number
  latency_ms: number
  system_id: string | null
}

interface AiSystem {
  id: string
  system_name: string
}

const STATUS_COLOR: Record<number, string> = {
  200: 'text-emerald-400',
  201: 'text-emerald-400',
}

function statusColor(code: number) {
  return STATUS_COLOR[code] ?? (code >= 400 ? 'text-red-400' : 'text-yellow-400')
}

function shortHash(hash: string | null) {
  return hash ? hash.slice(0, 8) + '...' : '-'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function LogTable({ customerId, onUpgrade }: { customerId: string; onUpgrade: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [systems, setSystems] = useState<AiSystem[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [monthlyCount, setMonthlyCount] = useState(0)
  const [planTier, setPlanTier] = useState<'free' | 'pro' | 'scale'>('free')
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const PAGE = 50

  useEffect(() => {
    supabase
      .from('account_settings')
      .select('id, system_name')
      .eq('customer_id', customerId)
      .then(({ data }) => setSystems(data ?? []))
  }, [customerId])

  useEffect(() => {
    async function fetchUsage() {
      const [subResult, countResult] = await Promise.all([
        supabase.from('subscriptions').select('status, plan').maybeSingle(),
        supabase
          .from('inference_logs')
          .select('*', { count: 'exact', head: true })
          .eq('customer_id', customerId)
          .gte('logged_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
      ])
      const activePlan = subResult.data?.status === 'active' ? subResult.data.plan : null
      setPlanTier(getPlanTier(activePlan))
      setMonthlyCount(countResult.count ?? 0)
    }
    fetchUsage()
  }, [customerId])

  useEffect(() => {
    async function fetchLogs() {
      setLoading(true)
      const { data, count, error } = await supabase
        .from('inference_logs')
        .select('*', { count: 'exact' })
        .eq('customer_id', customerId)
        .order('logged_at', { ascending: false })
        .limit(PAGE)

      if (!error && data) {
        setLogs(data)
        setTotal(count ?? 0)
      }
      setLoading(false)
    }

    fetchLogs()

    // Live updates - subscribe to new rows for this customer
    const channel = supabase
      .channel('inference_logs')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'ledger',
        table: 'inference_logs',
        filter: `customer_id=eq.${customerId}`,
      }, (payload) => {
        setLogs((prev) => [payload.new as LogEntry, ...prev.slice(0, PAGE - 1)])
        setTotal((t) => t + 1)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [customerId])

  const limit = PLAN_LIMITS[planTier]
  const pct = limit ? Math.min((monthlyCount / limit) * 100, 100) : 0
  const atLimit = limit !== null && monthlyCount >= limit
  const nearLimit = limit !== null && monthlyCount >= limit * 0.85

  return (
    <div>
      {showUpgradeModal && (
        <UpgradeModal
          feature="usage"
          onClose={() => setShowUpgradeModal(false)}
          onUpgrade={() => { setShowUpgradeModal(false); onUpgrade() }}
        />
      )}
      {/* Usage bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-400">Inferences this month</span>
          <span className={`text-xs font-medium ${atLimit ? 'text-red-400' : nearLimit ? 'text-yellow-400' : 'text-slate-500'}`}>
            {planTier === 'scale'
              ? `${monthlyCount.toLocaleString()} / unlimited`
              : `${monthlyCount.toLocaleString()} / ${limit?.toLocaleString()}`}
          </span>
        </div>
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${atLimit ? 'bg-red-500' : nearLimit ? 'bg-yellow-500' : planTier === 'scale' ? 'bg-indigo-500/40' : 'bg-indigo-500'}`}
            style={{ width: planTier === 'scale' ? '100%' : `${pct}%` }}
          />
        </div>
        {atLimit && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-red-400">Limit reached - new inferences are paused.</span>
            <button onClick={() => setShowUpgradeModal(true)} style={{ cursor: 'pointer' }} className="text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded-lg transition-colors">Upgrade</button>
          </div>
        )}
        {nearLimit && !atLimit && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-yellow-400">Approaching limit - upgrade to avoid interruption.</span>
            <button onClick={() => setShowUpgradeModal(true)} style={{ cursor: 'pointer' }} className="text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded-lg transition-colors">Upgrade</button>
          </div>
        )}
        {planTier === 'free' && !nearLimit && (
          <p className="mt-1 text-xs text-slate-600">Free plan · 10,000 inferences/mo · <button onClick={() => setShowUpgradeModal(true)} style={{ cursor: 'pointer' }} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">Upgrade for more</button></p>
        )}
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Inference Logs</h2>
          <p className="text-slate-400 text-sm mt-0.5">{total.toLocaleString()} total records</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-[7px] h-[7px] rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-[#1a1d27]">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Time</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">System</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Provider</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Model</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Latency</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Input hash</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Output hash</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    No logs yet. Point your AI calls through the proxy to start recording.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(log.logged_at)}</td>
                    <td className="px-4 py-3 text-slate-300 text-sm">
                      {log.system_id ? (systems.find((s) => s.id === log.system_id)?.system_name ?? '-') : '-'}
                    </td>
                    <td className="px-4 py-3 text-white capitalize">{log.provider}</td>
                    <td className="px-4 py-3 text-slate-300">{log.model_name ?? '-'}</td>
                    <td className={`px-4 py-3 font-mono font-medium ${statusColor(log.status_code)}`}>{log.status_code}</td>
                    <td className="px-4 py-3 text-slate-400">{log.latency_ms}ms</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{shortHash(log.input_hash)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{shortHash(log.output_hash)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
