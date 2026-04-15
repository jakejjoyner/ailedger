interface Props {
  onClose: () => void
  onUpgrade: () => void
  feature: 'report' | 'keys' | 'usage'
}

const CONTENT = {
  report: {
    title: 'Export compliance reports',
    description: 'Generate a formatted EU AI Act Article 12 PDF audit report - ready to hand to regulators.',
    features: [
      'Full inference log with SHA-256 hashes',
      'Anomaly and failure summary',
      'Data governance section',
      'One click, regulator-ready',
    ],
  },
  keys: {
    title: 'More API keys',
    description: 'Free plan is limited to 1 API key. Upgrade to create up to 5 keys and link them to AI systems.',
    features: [
      'Up to 5 API keys on Pro',
      'Unlimited keys on Scale',
      'Link keys to specific AI systems',
      'Per-key usage tracking',
    ],
  },
  usage: {
    title: 'Higher inference limits',
    description: "You've reached the free plan limit of 10,000 inferences this month. Upgrade to keep logging.",
    features: [
      '500,000 inferences/month on Pro',
      'Unlimited on Scale',
      'No logging interruptions',
      'Usage resets monthly',
    ],
  },
}

export default function UpgradeModal({ onClose, onUpgrade, feature }: Props) {
  const content = CONTENT[feature]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-[#1a1d27] border border-slate-700 rounded-2xl p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Pro feature</span>
            <h2 className="text-lg font-semibold text-white mt-1">{content.title}</h2>
          </div>
          <button
            onClick={onClose}
            style={{ cursor: 'pointer' }}
            className="text-slate-500 hover:text-white transition-colors text-xl leading-none mt-0.5"
          >
            ×
          </button>
        </div>

        <p className="text-slate-400 text-sm mb-5 leading-relaxed">{content.description}</p>

        {/* Feature list */}
        <ul className="mb-6 space-y-2">
          {content.features.map((f) => (
            <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
              <span className="w-4 h-4 rounded-full bg-indigo-600/30 flex items-center justify-center shrink-0">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1.5 4l1.5 1.5 3.5-3.5" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              {f}
            </li>
          ))}
        </ul>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onUpgrade}
            style={{ cursor: 'pointer' }}
            className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Upgrade to Pro
          </button>
          <button
            onClick={onClose}
            style={{ cursor: 'pointer' }}
            className="px-4 py-2.5 text-slate-400 hover:text-white text-sm font-medium transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
