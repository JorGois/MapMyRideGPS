import { useState } from 'react'
import { findBackups, backupFiles, type BackupSet } from './lib/restore'
import { country, t } from './i18n'

const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`

interface Props {
  connected: boolean
  busy: boolean
  /** Remembered backup folder, offered as the first place to look. */
  backupDir?: FileSystemDirectoryHandle
  run: (fn: () => Promise<void>) => void
  /** Builds the restore plan from the chosen backup files (shown below by the parent). */
  onPlan: (files: File[], set: BackupSet) => Promise<void>
}

/** Restore tab: pick a backup folder, choose a backup (and optionally only some countries), then restore. */
export default function RestoreTab({ connected, busy, backupDir, run, onPlan }: Props) {
  const [root, setRoot] = useState<FileSystemDirectoryHandle>()
  const [sets, setSets] = useState<BackupSet[]>()
  const [chosen, setChosen] = useState<string>()
  const [countries, setCountries] = useState<Set<string>>(new Set())

  const scanDir = async (dir: FileSystemDirectoryHandle) => {
    if ((await dir.requestPermission({ mode: 'read' })) !== 'granted') return
    const found = await findBackups(dir)
    setRoot(dir); setSets(found)
    setChosen(found[0]?.name)
    setCountries(new Set(found[0]?.countries))
  }
  const scan = (dir: FileSystemDirectoryHandle) => run(() => scanDir(dir))
  const pick = () => run(async () => {
    await scanDir(await window.showDirectoryPicker({ id: 'backup', mode: 'read', startIn: backupDir ?? 'documents' }))
  })

  const set = sets?.find(s => s.name === chosen)
  const choose = (s: BackupSet) => { setChosen(s.name); setCountries(new Set(s.countries)) }
  const selectedSize = set ? set.files.filter(f => countries.has(f.country)).reduce((a, f) => a + f.size, 0) : 0

  return (
    <section className="card">
      <h2>{t('restoreTitle')}</h2>
      <p className="muted">{t('restoreIntro')}</p>
      {!connected && <p className="warn">{t('restoreConnectFirst')}</p>}

      <div className="actions">
        {backupDir && <button onClick={() => scan(backupDir)} disabled={busy}>{t('restoreLookIn', { name: backupDir.name })}</button>}
        <button className={backupDir ? 'ghost' : undefined} onClick={pick} disabled={busy}>{t('restorePick')}</button>
      </div>
      <p className="muted small">{t('restorePickHelp')}</p>

      {sets && !sets.length && <p className="warn">{t('restoreNone', { name: root?.name ?? '' })}</p>}

      {sets && sets.length > 0 && (
        <>
          <h3>{t('restoreFound', { n: sets.length, name: root?.name ?? '' })}</h3>
          <table>
            <thead><tr><th></th><th>{t('restoreColBackup')}</th><th>{t('restoreColCountries')}</th><th>{t('restoreColFiles')}</th><th>{t('planSize')}</th></tr></thead>
            <tbody>
              {sets.map(s => (
                <tr key={s.name} className={s.name === chosen ? 'chosen' : undefined} onClick={() => choose(s)}>
                  <td><input type="radio" name="backup" checked={s.name === chosen} onChange={() => choose(s)} /></td>
                  <td><b>{s.when ?? s.name}</b>{s.when && <div className="muted small">{s.name}</div>}</td>
                  <td>{s.countries.map(country).join(', ')}</td>
                  <td>{s.files.length}</td>
                  <td>{fmtBytes(s.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {set && (
        <div className="plan">
          <h3>{t('restoreWhat')}</h3>
          <div className="actions wrap">
            {set.countries.map(c => (
              <label key={c} className="chip">
                <input type="checkbox" checked={countries.has(c)}
                  onChange={e => setCountries(prev => { const n = new Set(prev); e.target.checked ? n.add(c) : n.delete(c); return n })} />
                {country(c)} <span className="muted small">({set.files.filter(f => f.country === c).length})</span>
              </label>
            ))}
          </div>
          <div className="row">
            <span className="muted small">{t('restoreSelected', { n: set.files.filter(f => countries.has(f.country)).length, size: fmtBytes(selectedSize) })}</span>
            <button disabled={busy || !connected || !countries.size}
              onClick={() => run(async () => onPlan(await backupFiles(set, f => countries.has(f.country)), set))}>
              {t('restoreReview')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
