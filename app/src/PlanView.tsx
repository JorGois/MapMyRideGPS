import { fileKey, type InstallPlan } from './lib/ops'
import type { DeviceFile, Folder } from './lib/device'
import { country, t, type Key } from './i18n'

const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`

/** Router files end in E/N/R/S/W; each holds one part of the navigation graph. */
const routerPart = (stem: string) => stem.slice(-1) as 'E' | 'N' | 'R' | 'S' | 'W'

const ICON: Record<string, string> = { base: '🗺', layer: '📍', region: '🧩', contour: '⛰', router: '🧭', unknown: '📄' }

function describe(kind: string, stem: string): { label: string; what: string } {
  const label = t(`kind_${kind}` as Key)
  if (kind === 'router') return { label: `${label} (${routerPart(stem)})`, what: t('whatRouter') }
  return { label, what: t(`what_${kind}` as Key) }
}

type Action = 'new' | 'replace' | 'overwrite'
export type FileState = 'writing' | 'done'

/** Install / restore plan: files grouped by GPS folder, with what happens to each, what it is for, and live progress. */
export default function PlanView({ plan, mode, state }: { plan: InstallPlan; mode: 'install' | 'restore'; state?: Map<string, FileState> }) {
  const rows = plan.incoming.map(i => {
    const same = plan.replaced.find(r => r.folder === i.folder && r.name === i.name)
    const older = plan.replaced.find(r => r.folder === i.folder && r.slot === i.slot && r.name !== i.name)
    const action: Action = same ? 'overwrite' : older ? 'replace' : 'new'
    return { i, old: same ?? older, action, st: state?.get(fileKey(i)), ...describe(i.kind, i.stem) }
  })
  const writeTotal = plan.incoming.reduce((s, f) => s + f.size, 0)
  const doneN = rows.filter(r => r.st === 'done').length
  const removed: DeviceFile[] = plan.replaced.filter(r => !plan.incoming.some(i => i.folder === r.folder && i.name === r.name))
  const folders = (['Maps', 'Router'] as Folder[]).filter(f => rows.some(r => r.i.folder === f))
  // Router files come in sets of 5 with the same description: show it once per group instead of on every row.
  const routerWhatShown = new Set<string>()

  return (
    <div className="plan">
      <div className="row">
        <h3>{t(mode === 'restore' ? 'planRestoreTitle' : 'readyToInstall')}</h3>
        <span className="muted small">
          {doneN > 0 && <span className="pill ok">{t('planDoneCount', { n: doneN, total: rows.length })}</span>}{' '}
          {t('planSummary', { n: rows.length, size: fmtBytes(writeTotal), r: plan.replaced.length })}
        </span>
      </div>
      <p className="muted small legendline" dangerouslySetInnerHTML={{ __html: t('planLegend') }} />

      {folders.map(folder => (
        <div key={folder} className="filegroup">
          <h4>{t(folder === 'Maps' ? 'planGroupMaps' : 'planGroupRouter')}</h4>
          <ul className="files">
            {rows.filter(r => r.i.folder === folder).map(({ i, old, action, label, what, st }) => {
              const showWhat = i.kind !== 'router' || !routerWhatShown.has(i.country) && !!routerWhatShown.add(i.country)
              return (
                <li key={fileKey(i)} className={`file ${st ?? ''}`}>
                  <span className="ficon" aria-hidden>{st === 'done' ? '✓' : ICON[i.kind] ?? ICON.unknown}</span>
                  <div className="fmain">
                    <div className="ftitle">
                      <b>{label}</b> <span className="muted">· {country(i.country)}</span>
                      {st === 'done' ? <span className="pill ok">{t('fileDone')}</span>
                        : st === 'writing' ? <span className="pill writing">{t('fileWriting')}</span>
                        : <span className={`pill ${action === 'new' ? 'ok' : 'hot'}`}>{t(`action_${action}` as Key)}</span>}
                    </div>
                    {showWhat && <div className="small fwhat">{what}</div>}
                    <div className="muted small">
                      <code>{i.name}</code>
                      {old && old.name !== i.name && <> · {t('planReplaces', { name: old.name, date: old.date ?? '—' })}</>}
                    </div>
                  </div>
                  <div className="fmeta small">
                    <div>{fmtBytes(i.size)}</div>
                    {i.date && <div className="muted">{i.date}</div>}
                    {old?.date && i.date && old.date !== i.date && <div className="muted">{t('planWas', { date: old.date })}</div>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {removed.length > 0 && <p className="muted small">{t('planRemoved', { files: removed.map(r => r.name).join(', ') })}</p>}
      <p className="muted small">{t('planManifests')}</p>
      {plan.warnings.map(w => <p key={w} className="warn small">{w}</p>)}
    </div>
  )
}
