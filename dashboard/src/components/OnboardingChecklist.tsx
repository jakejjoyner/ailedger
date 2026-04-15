import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

interface Props {
  customerId: string
  onGoToKeys: () => void
}

interface Steps {
  key: boolean
  request: boolean
  log: boolean
}

export default function OnboardingChecklist({ customerId, onGoToKeys }: Props) {
  const [steps, setSteps] = useState<Steps | null>(null)
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(`ailedger_onboarding_dismissed_${customerId}`) === '1'
  )
  const [animatingOut, setAnimatingOut] = useState(false)
  const [hidden, setHidden] = useState(false)
  const initialStepsRef = useRef<Steps | null>(null)
  const completingRef = useRef(false)

  useEffect(() => {
    async function check() {
      const [{ data: keys }, { data: logs }] = await Promise.all([
        supabase.from('api_keys').select('id').eq('customer_id', customerId).limit(1),
        supabase.from('inference_logs').select('id').eq('customer_id', customerId).limit(1),
      ])
      const hasKey = (keys?.length ?? 0) > 0
      const hasLog = (logs?.length ?? 0) > 0
      const s = { key: hasKey, request: hasLog, log: hasLog }
      initialStepsRef.current = s
      setSteps(s)
    }
    check()

    const logChannel = supabase
      .channel('onboarding_logs')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'ledger',
        table: 'inference_logs',
        filter: `customer_id=eq.${customerId}`,
      }, () => {
        setSteps((prev) => prev ? { ...prev, request: true, log: true } : prev)
      })
      .subscribe()

    const keyChannel = supabase
      .channel('onboarding_keys')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'api_keys',
        filter: `customer_id=eq.${customerId}`,
      }, () => {
        setSteps((prev) => prev ? { ...prev, key: true } : prev)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(logChannel)
      supabase.removeChannel(keyChannel)
    }
  }, [customerId])

  // Once all steps are done, animate then fade out - but only if something
  // completed during this session. If all were already done on load, hide immediately.
  useEffect(() => {
    if (!steps || completingRef.current) return
    if (steps.key && steps.request && steps.log) {
      completingRef.current = true
      const initial = initialStepsRef.current
      const anyNew = !initial?.key || !initial?.request || !initial?.log
      if (!anyNew) {
        setHidden(true)
        return
      }
      const t1 = setTimeout(() => setAnimatingOut(true), 1400)
      const t2 = setTimeout(() => setHidden(true), 2100)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
  }, [steps])

  function dismiss() {
    localStorage.setItem(`ailedger_onboarding_dismissed_${customerId}`, '1')
    setDismissed(true)
  }

  if (dismissed || hidden || !steps) return null

  const isNew = (key: keyof Steps) => steps[key] && !initialStepsRef.current?.[key]

  const items = [
    {
      done: steps.key,
      new: isNew('key'),
      label: 'Create an API key',
      sub: 'Go to the API Keys tab and create your first key.',
      action: !steps.key ? (
        <button
          onClick={onGoToKeys}
          style={{ cursor: 'pointer' }}
          className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Create key →
        </button>
      ) : null,
    },
    {
      done: steps.request,
      new: isNew('request'),
      label: 'Make your first request',
      sub: (
        <>
          Set{' '}
          <code className="text-slate-300 bg-slate-800 px-1 rounded text-xs">
            base_url=https://proxy.ailedger.dev/proxy/openai
          </code>{' '}
          and add your key in{' '}
          <code className="text-slate-300 bg-slate-800 px-1 rounded text-xs">x-ailedger-key</code>.
        </>
      ),
      action: null,
    },
    {
      done: steps.log,
      new: isNew('log'),
      label: 'See your first log',
      sub: 'Your inference will appear in this table within seconds.',
      action: null,
    },
  ]

  const completedCount = [steps.key, steps.request, steps.log].filter(Boolean).length

  return (
    <>
      <style>{`
        @keyframes checkPop {
          0%   { transform: scale(0);   opacity: 0; }
          55%  { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes circlePop {
          0%   { transform: scale(0.6); }
          55%  { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        .check-new { animation: checkPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .circle-new { animation: circlePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
      `}</style>
      <div
        className="mb-6 bg-[#1a1d27] border border-slate-800 rounded-xl p-4"
        style={{
          transition: 'opacity 0.6s ease, transform 0.6s ease',
          opacity: animatingOut ? 0 : 1,
          transform: animatingOut ? 'translateY(-8px)' : 'translateY(0)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white">Get started</span>
            <span className="text-xs text-slate-500">{completedCount} / 3 complete</span>
            <div className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                    i < completedCount ? 'bg-indigo-500' : 'bg-slate-700'
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={dismiss}
            style={{ cursor: 'pointer' }}
            className="text-slate-600 hover:text-slate-400 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors duration-300 ${
                  item.done ? `bg-indigo-600${item.new ? ' circle-new' : ''}` : 'border border-slate-600'
                }`}
              >
                {item.done && (
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                    className={item.new ? 'check-new' : ''}
                  >
                    <path d="M1.5 4l1.5 1.5 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium transition-colors duration-300 ${item.done ? 'text-slate-500 line-through' : 'text-white'}`}>
                  {item.label}
                </div>
                {!item.done && (
                  <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.sub}</div>
                )}
              </div>
              {!item.done && item.action && (
                <div className="shrink-0 mt-0.5">{item.action}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
