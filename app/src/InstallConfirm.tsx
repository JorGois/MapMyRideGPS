import { useState } from 'react'
import { t } from './i18n'

const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`
/** The BiNavi links at USB 1.1 Full Speed (12 Mb/s): ~0.8 MB/s in practice, reads and writes. */
const BYTES_PER_SEC = 0.8e6
const fmtMinutes = (bytes: number) => Math.max(1, Math.round(bytes / BYTES_PER_SEC / 60))

interface Props {
  mode: 'install' | 'restore'
  backupName?: string
  /** Bytes copied from the GPS into the backup. */
  backupBytes: number
  /** Bytes written to the GPS. */
  writeBytes: number
  onChangeFolder: () => void
  onStart: (skipBackup: boolean) => void
  onCancel: () => void
}

/** Confirmation before writing to the GPS: where the backup goes, skip option, time estimate and warnings. */
export default function InstallConfirm({ mode, backupName, backupBytes, writeBytes, onChangeFolder, onStart, onCancel }: Props) {
  const [skip, setSkip] = useState(false)
  const needsFolder = !skip && !backupName
  const minutes = fmtMinutes(writeBytes + (skip ? 0 : backupBytes))
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ic-title">
      <div className="card confirm">
        <h2 id="ic-title">{t(mode === 'restore' ? 'icTitleRestore' : 'icTitle')}</h2>

        <section className={`step ${skip ? 'off' : ''}`}>
          <h3>1 · {t('icBackupStep')}</h3>
          {!skip && (backupName
            ? <p dangerouslySetInnerHTML={{ __html: t('icBackupTo', { name: backupName, size: fmtBytes(backupBytes) }) }} />
            : <p dangerouslySetInnerHTML={{ __html: t('icBackupNone') }} />)}
          {!skip && <p className="muted small" dangerouslySetInnerHTML={{ __html: t('fpBackup2') + ' ' + t('fpBackup3') }} />}
          <div className="actions">
            {!skip && <button className={backupName ? 'ghost small' : 'small'} onClick={onChangeFolder}>{backupName ? t('icChangeFolder') : t('fpBackupGo')}</button>}
          </div>
          <label className="small skip">
            <input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} /> {t('icSkip')}
          </label>
          {skip && <p className="warn small">{t('icSkipWarn')}</p>}
        </section>

        <section className="step">
          <h3>2 · {t(mode === 'restore' ? 'icRestoreStep' : 'icInstallStep')}</h3>
          <p>{t('icWrite', { size: fmtBytes(writeBytes) })}</p>
        </section>

        <div className="warn">
          <b>⚠ {t('icTakesTime', { min: minutes })}</b>
          <ul>
            <li>{t('icNoDisconnect')}</li>
            <li>{t('icNoSleep')}</li>
            <li>{t('icWatchBar')}</li>
          </ul>
        </div>

        <div className="row">
          <button className="ghost" onClick={onCancel}>{t('cancel')}</button>
          <button autoFocus disabled={needsFolder} onClick={() => onStart(skip)}>
            {t(mode === 'restore' ? 'icStartRestore' : 'icStart')}
          </button>
        </div>
      </div>
    </div>
  )
}
