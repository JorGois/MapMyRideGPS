import type { InstallPlan } from './lib/ops'
import type { DeviceFile } from './lib/device'
import { t, type Key } from './i18n'

const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`

/** Router files end in E/N/R/S/W; each holds one part of the navigation graph. */
const routerPart = (stem: string) => stem.slice(-1) as 'E' | 'N' | 'R' | 'S' | 'W'

function describe(kind: string, stem: string): { label: string; what: string } {
  const label = t(`kind_${kind}` as Key)
  if (kind === 'router') return { label: `${label} (${routerPart(stem)})`, what: t('whatRouter') }
  return { label, what: t(`what_${kind}` as Key) }
}

type Action = 'new' | 'replace' | 'overwrite'

/** Install / restore plan: one row per file with what happens to it and what the file is for. */
export default function PlanView({ plan, mode }: { plan: InstallPlan; mode: 'install' | 'restore' }) {
  const rows = plan.incoming.map(i => {
    const same = plan.replaced.find(r => r.folder === i.folder && r.name === i.name)
    const older = plan.replaced.find(r => r.folder === i.folder && r.slot === i.slot && r.name !== i.name)
    const action: Action = same ? 'overwrite' : older ? 'replace' : 'new'
    return { i, old: same ?? older, action, ...describe(i.kind, i.stem) }
  })
  const kinds = [...new Set(rows.map(r => r.i.kind))]
  const writeTotal = plan.incoming.reduce((s, f) => s + f.size, 0)
  const removed: DeviceFile[] = plan.replaced.filter(r => !plan.incoming.some(i => i.folder === r.folder && i.name === r.name))

  return (
    <div className="plan">
      <div className="row">
        <h3>{t(mode === 'restore' ? 'planRestoreTitle' : 'readyToInstall')}</h3>
        <span className="muted small">{t('planSummary', { n: rows.length, size: fmtBytes(writeTotal), r: plan.replaced.length })}</span>
      </div>
      <table className="plantable">
        <thead><tr><th>{t('planAction')}</th><th>{t('planFile')}</th><th>{t('planType')}</th><th>{t('planDate')}</th><th>{t('planSize')}</th></tr></thead>
        <tbody>
          {rows.map(({ i, old, action, label, what }) => (
            <tr key={i.folder + i.name}>
              <td><span className={`pill ${action === 'new' ? 'ok' : 'hot'}`}>{t(`action_${action}` as Key)}</span></td>
              <td>
                <code>{i.folder}/{i.name}</code>
                {old && old.name !== i.name && <div className="muted small">{t('planReplaces', { name: old.name, date: old.date ?? '—' })}</div>}
              </td>
              <td title={what}>{label}</td>
              <td>{i.date ?? (old?.date ? <span className="muted">—</span> : '—')}{old?.date && i.date && <div className="muted small">{t('planWas', { date: old.date })}</div>}</td>
              <td>{fmtBytes(i.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {removed.length > 0 && <p className="muted small">{t('planRemoved', { files: removed.map(r => r.name).join(', ') })}</p>}

      <details className="about small">
        <summary><b>{t('planWhatTitle')}</b></summary>
        <ul>{kinds.map(k => <li key={k}><b>{t(`kind_${k}` as Key)}:</b> {k === 'router' ? t('whatRouter') : t(`what_${k}` as Key)}</li>)}</ul>
        <p>{t('planManifests')}</p>
      </details>

      {plan.warnings.map(w => <p key={w} className="warn small">{w}</p>)}
    </div>
  )
}
