import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connect, groupRegions, isOnDevice, openDevice, removeLeftovers, isSupported, KNOWN_CAPACITY, listFiles, scanUsage, type Device, type DeviceFile, type Region, type Usage } from './lib/device'
import { rankToIso } from './lib/filenames'
import { country, getLang, LANGS, setLang, t, tHtml, type Key, type Lang } from './i18n'
import { detectModel, fetchCatalog, isCompatible, loadSources, saveSources, sourcesForModel, type CatalogEntry, type CatalogSource } from './lib/catalog'
import { backup, checkHealth, fileKey, install, planInstall, removeFiles, repairHealth, type HealthIssue, type InstallPlan } from './lib/ops'
import { canAutoDownload, clearDownloads, downloadPackage, getProxy, probeProxy, setProxy, type Downloaded } from './lib/download'
import MapView, { type RegionStatus } from './MapView'
import PlanView, { type FileState } from './PlanView'
import InstallConfirm from './InstallConfirm'
import RestoreTab from './RestoreTab'
import { play, setSoundEnabled, soundEnabled } from './sound'
import { clearAll, loadBool, loadHandle, permissionOf, saveBool, saveHandle, storageUsed } from './lib/settings'
import './App.css'

/** No progress for this long while working = the GPS has probably stopped responding. */
const STALL_S = 60
const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`
const kindLabel = (k: string) => t(`kind_${k}` as Key)
type Status = 'missing' | 'outdated' | 'current'
const STATUS_KEY: Record<Status, Key> = { missing: 'statusMissing', outdated: 'statusOutdated', current: 'statusCurrent' }
const pillClass = (st: Status) => `pill ${st === 'outdated' ? 'hot' : st === 'current' ? 'ok' : ''}`

export default function App() {
  const [lang, setLangState] = useState<Lang>(getLang)
  const changeLang = (l: Lang) => { setLang(l); setLangState(l) }
  const [device, setDevice] = useState<Device>()
  const [files, setFiles] = useState<DeviceFile[]>([])
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [catalogErr, setCatalogErr] = useState<Record<string, string>>({})
  const [sources, setSources] = useState<CatalogSource[]>(loadSources)
  const [proxyOk, setProxyOk] = useState<boolean>()
  const [proxyInput, setProxyInput] = useState(getProxy())
  const [showMap, setShowMapState] = useState(() => loadBool('showMap', true))
  const setShowMap = (f: (v: boolean) => boolean) => setShowMapState(v => { const n = f(v); saveBool('showMap', n); return n })
  const [savedDevice, setSavedDevice] = useState<FileSystemDirectoryHandle>()
  const [savedBackup, setSavedBackup] = useState<FileSystemDirectoryHandle>()
  const [browserUsage, setBrowserUsage] = useState(0)
  const [error, setError] = useState<string>()
  const [tab, setTab] = useState<'maps' | 'restore'>('maps')
  const [planMode, setPlanMode] = useState<'install' | 'restore'>('install')
  const [confirming, setConfirming] = useState(false)
  const [sound, setSound] = useState(soundEnabled)
  const [folderPrompt, setFolderPrompt] = useState<{ kind: 'device' | 'backup'; need?: number; resolve: (ok: boolean) => void }>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [onlyMine, setOnlyMine] = useState(() => localStorage.getItem('onlyMine') !== 'false')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [plan, setPlan] = useState<InstallPlan>()
  const [backupDir, setBackupDir] = useState<FileSystemDirectoryHandle>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number }>()
  const [log, setLog] = useState<string[]>([])
  const [issues, setIssues] = useState<HealthIssue[]>()
  const [guideFor, setGuideFor] = useState<CatalogEntry>()
  const [usage, setUsage] = useState<Usage>()
  const [download, setDownload] = useState<Downloaded & { entry: CatalogEntry }>()
  const [capacity, setCapacity] = useState<number>()
  /** Per-file progress of the running install, shown as "Writing…" / "Done" in the plan. */
  const [fileState, setFileState] = useState<Map<string, FileState>>(new Map())
  const [phase, setPhase] = useState<'backup' | 'install'>()
  const [sideOpen, setSideOpenState] = useState(() => loadBool('sideOpen', true))
  const setSideOpen = (v: boolean) => { saveBool('sideOpen', v); setSideOpenState(v) }

  const addLog = useCallback((m: string) => setLog(l => [...l.slice(-300), `${new Date().toLocaleTimeString()}  ${m}`]), [])
  const lastProgressAt = useRef(Date.now())
  const onProgress = useCallback((label: string, done: number, total: number) => {
    lastProgressAt.current = Date.now()
    setProgress({ label, done, total })
  }, [])
  /** Seconds without progress while busy; > STALL_S means the GPS probably stopped responding. */
  const [stalledFor, setStalledFor] = useState(0)

  const regions = useMemo(() => groupRegions(files), [files])
  const detected = useMemo(() => device
    ? detectModel(device.model, files.flatMap(f => f.header ? [f.header] : []))
    : { how: 'unknown' as const, model: undefined }, [device, files])
  // Show only the catalogs made for the connected device family.
  useEffect(() => { if (detected.model) setSources(s => sourcesForModel(s, detected.model)) }, [detected.model])
  const installedDate = useMemo(() => new Map(regions.map(r => [r.country, r.date])), [regions])

  const refresh = useCallback(async (d = device) => {
    if (!d) return
    for (const dir of [d.dirs.Maps, d.dirs.Router]) {
      const junk = await removeLeftovers(dir).catch(() => [] as string[])
      if (junk.length) addLog(t('logLeftovers', { n: junk.length }))
    }
    setFiles(await listFiles(d))
    setIssues(await checkHealth(d))
    // Full-drive scan can be slow over USB: run it in the background so the UI stays usable.
    setUsage(undefined)
    scanUsage(d).then(setUsage).catch(() => {})
  }, [device])

  useEffect(() => {
    saveSources(sources)
    let cancelled = false
    const enabled = sources.filter(s => s.enabled)
    setCatalogErr({})
    Promise.all(enabled.map(s => fetchCatalog(s).catch(e => {
      if (!cancelled) setCatalogErr(m => ({ ...m, [s.label]: String(e.message ?? e) }))
      return [] as CatalogEntry[]
    }))).then(all => { if (!cancelled) setCatalog(all.flat().sort((a, b) => b.rank - a.rank)) })
    return () => { cancelled = true }
  }, [sources])

  useEffect(() => { probeProxy().then(setProxyOk) }, [])

  const regionStatus = useCallback((r: Region): RegionStatus => {
    const newest = catalog.filter(c => c.country === r.country).sort((a, b) => b.rank - a.rank)[0]
    if (!newest) return 'unknown'
    const iso = rankToIso(newest.rank)
    return iso && r.date && iso > r.date ? 'outdated' : 'current'
  }, [catalog])
  const toggleRegion = useCallback((c: string) => setSelected(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n }), [])

  // Watchdog: the BiNavi (USB 1.1) sometimes stops responding mid-transfer. Detect it instead of a frozen bar.
  useEffect(() => {
    if (!busy) { setStalledFor(0); return }
    lastProgressAt.current = Date.now()
    const id = setInterval(() => setStalledFor(Math.floor((Date.now() - lastProgressAt.current) / 1000)), 5000)
    return () => clearInterval(id)
  }, [busy])

  // Closing or reloading the tab mid-copy would leave the GPS half-updated: ask the browser to warn first.
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try { await fn() } catch (e: any) {
      if (e?.name !== 'AbortError') { const m = String(e?.message ?? e); addLog(t('logError', { msg: m })); setError(m); play('error') }
    }
    finally { setBusy(false); setProgress(undefined); setPhase(undefined) }
  }

  const useDevice = async (d: Device) => {
    setDevice(d)
    setSavedDevice(undefined)
    void saveHandle('device', d.root)
    const saved = Number(localStorage.getItem(`capacity:${d.model ?? d.root.name}`))
    setCapacity(saved || (d.model ? KNOWN_CAPACITY[d.model] : undefined))
    addLog(d.model ? t('logConnectedModel', { name: d.root.name, model: d.model, fw: d.firmware ?? '?' }) : t('logConnected', { name: d.root.name }))
    await refresh(d)
  }
  /** Explains which folder to pick before the browser's folder dialog opens. Resolves false if the user cancels. */
  const askFolder = (kind: 'device' | 'backup', need?: number) =>
    new Promise<boolean>(resolve => setFolderPrompt({ kind, need, resolve: ok => { setFolderPrompt(undefined); resolve(ok) } }))

  const doConnect = () => run(async () => {
    if (!await askFolder('device')) return
    await useDevice(await connect())
  })
  const reconnectSaved = () => savedDevice && run(async () => useDevice(await openDevice(savedDevice)))

  // Restore remembered folders. Already-granted access reconnects silently; otherwise a one-click button is shown.
  useEffect(() => {
    void (async () => {
      const [d, b] = await Promise.all([loadHandle('device'), loadHandle('backup')])
      if (b) (await permissionOf(b)) === 'granted' ? setBackupDir(b) : setSavedBackup(b)
      if (d) {
        if ((await permissionOf(d)) === 'granted') {
          try { await useDevice(await openDevice(d)); addLog(t('logRemembered')) } catch { setSavedDevice(d) }
        } else setSavedDevice(d)
      }
      setBrowserUsage(await storageUsed())
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearSaved = () => run(async () => {
    if (!confirm(t('clearConfirm'))) return
    await clearAll()
    location.reload()
  })

  const checkBackupTarget = async (h: FileSystemDirectoryHandle) => {
    if (device && await isOnDevice(device, h)) {
      throw new Error(t('backupOnDevice', { name: h.name }))
    }
  }

  const pickBackup = () => run(async () => {
    // The explanation is only needed the first time; with a folder already chosen, go straight to the picker.
    if (!backupDir && !savedBackup && !await askFolder('backup')) return
    const h = await window.showDirectoryPicker({ id: 'backup', mode: 'readwrite', startIn: backupDir ?? savedBackup ?? 'documents' })
    await checkBackupTarget(h)
    setBackupDir(h)
    setSavedBackup(undefined)
    void saveHandle('backup', h)
    addLog(t('logBackupTo', { name: h.name }))
  })

  useEffect(() => { void clearDownloads() }, [])

  const discardPending = async () => {
    plan?.close()
    setPlan(undefined)
    setFileState(new Map())
    if (download) { await download.discard(); setDownload(undefined) }
  }

  const choosePackages = async (list: FileList | File[] | null) => {
    if (!device || !list?.length) return
    run(async () => {
      await discardPending()
      setPlan(await planInstall(device, [...list]))
      setPlanMode('install')
    })
  }

  /** One click: download through the proxy, unzip, and show the install plan. */
  const downloadAndPlan = (entry: CatalogEntry) => device && run(async () => {
    await discardPending()
    addLog(t('logDownloading', { name: entry.name, size: fmtBytes(entry.size) }))
    const dl = await downloadPackage(entry.url, entry.mapVersionId, (done, total) => onProgress(t('progressDownloading', { name: entry.name }), done, total))
    setDownload({ ...dl, entry })
    addLog(t('logDownloaded', { file: dl.file.name }))
    setPlan(await planInstall(device, [dl.file]))
    setPlanMode('install')
    document.getElementById('install')?.scrollIntoView({ behavior: 'smooth' })
  })

  /** Opens the confirmation popup; the actual work starts from there. */
  const doInstall = () => { if (plan && device) setConfirming(true) }

  /** "Change folder…" in the confirmation popup: the popup itself already explains what to pick. */
  const changeBackupFolder = () => run(async () => {
    const h = await window.showDirectoryPicker({ id: 'backup', mode: 'readwrite', startIn: backupDir ?? 'documents' })
    await checkBackupTarget(h)
    setBackupDir(h); setSavedBackup(undefined)
    void saveHandle('backup', h)
    addLog(t('logBackupTo', { name: h.name }))
  })

  const startInstall = (skipBackup: boolean) => plan && device && run(async () => {
    setConfirming(false)
    if (skipBackup) addLog(t('logBackupSkipped'))
    else {
      let dir = backupDir
      if (!dir && savedBackup && (await savedBackup.requestPermission({ mode: 'readwrite' })) === 'granted') {
        dir = savedBackup; setBackupDir(savedBackup); setSavedBackup(undefined)
      }
      if (!dir) throw new Error(t('icBackupNoneErr'))
      await checkBackupTarget(dir)
      play('start')
      setPhase('backup')
      await backup(device, plan.replaced, dir, addLog, onProgress)
    }
    if (skipBackup) play('start')
    setPhase('install')
    setFileState(new Map())
    await install(device, plan, addLog, onProgress, (inc, st) => setFileState(m => new Map(m).set(fileKey(inc), st)))
    play('done')
    setPlan(undefined)
    setFileState(new Map())
    if (download) { await download.discard(); setDownload(undefined) }
    await refresh()
  })

  const planRestore = async (backupSetFiles: File[]) => {
    if (!device) return
    await discardPending()
    setPlan(await planInstall(device, backupSetFiles, { restore: true }))
    setPlanMode('restore')
  }

  const selectedFiles = files.filter(f => selected.has(f.country))
  const doRemove = () => device && run(async () => {
    const names = [...selected].map(country).join(', ')
    const all = selected.size === regions.length
    const msg = [all ? t('confirmAll') + '\n' : '', t('confirmDelete', { names }), t('confirmFreed', { size: fmtBytes(selectedFiles.reduce((s, f) => s + f.size, 0)) }),
      backupDir ? '' : '\n' + t('confirmNoBackup')].filter(Boolean).join('\n')
    if (!confirm(msg)) return
    if (backupDir) await backup(device, selectedFiles, backupDir, addLog, onProgress)
    await removeFiles(device, selectedFiles, addLog)
    setSelected(new Set())
    await refresh()
  })

  const doRepair = () => device && issues && run(async () => {
    await repairHealth(device, issues, addLog, onProgress)
    await refresh()
  })

  /** Something in the sources needs the user: nothing enabled, or a catalog failed to load. */
  const sourcesAlert = !sources.some(s => s.enabled) || Object.keys(catalogErr).length > 0

  const shownCatalog = catalog.filter(c => {
    const q = filter.trim().toLowerCase()
    if (q && !`${c.path.join(' ')} ${c.code ?? ''} ${c.country ? country(c.country) : ''}`.toLowerCase().includes(q)) return false
    if (onlyMine && device && !(c.country && installedDate.has(c.country))) return false
    return true
  })

  const statusOf = (c: CatalogEntry): Status => {
    const mine = c.country ? installedDate.get(c.country) : undefined
    const onlineIso = rankToIso(c.rank)
    return !c.country || !installedDate.has(c.country) ? 'missing'
      : mine && onlineIso && onlineIso > mine ? 'outdated' : 'current'
  }

  /** Catalog grouped by country (continent › country), countries sorted by their newest map. */
  const catalogGroups = (() => {
    const by = new Map<string, { key: string; name: string; items: CatalogEntry[] }>()
    for (const c of shownCatalog) {
      const key = `${c.source}|${c.path.slice(0, 2).join('/')}`
      const g = by.get(key) ?? { key, name: c.path[1] ?? c.name, items: [] }
      g.items.push(c)
      by.set(key, g)
    }
    const groups = [...by.values()]
    for (const g of groups) g.items.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))
    return groups.sort((a, b) => b.items[0].rank - a.items[0].rank || a.name.localeCompare(b.name))
  })()

  const groupName = (g: { name: string; items: CatalogEntry[] }) => {
    const code = g.items.find(i => i.country)?.country
    return code && g.items.every(i => i.country === code) ? country(code) : g.name
  }

  const CatalogRow = ({ c, nested }: { c: CatalogEntry; nested: boolean }) => {
    const status = statusOf(c)
    return (
      <tr className={nested ? 'nested' : undefined}>
        <td>{nested ? c.path.slice(2).join(' › ') || c.name : c.path.slice(1).join(' › ')} {c.code && <code className="muted">{c.code}</code>}</td>
        <td className="small"><span title={c.url}>{c.sourceLabel}</span><br /><a className="muted" href={c.url} target="_blank" rel="noreferrer">{new URL(c.url).host.split('.')[0]}…/{c.url.split('/').pop()}</a></td>
        <td>{rankToIso(c.rank) ?? c.version}</td>
        <td>{fmtBytes(c.size)}</td>
        <td><span className={pillClass(status)}>{t(STATUS_KEY[status])}</span></td>
        <td className="actions">
          {device && proxyOk && canAutoDownload(c.url, c.mapVersionId) && <button className="small" disabled={busy} onClick={() => downloadAndPlan(c)}>{t(status === 'outdated' ? 'btnUpdate' : status === 'current' ? 'btnReinstall' : 'btnInstall')}</button>}
          <a className="btn small ghostlink" href={c.url} download onClick={() => setGuideFor(c)} title={t('zipManual')}>ZIP</a>
        </td>
      </tr>
    )
  }

  if (!isSupported()) {
    return <main className="wrap"><h1>MapMyRideGPS</h1><p className="warn">{t('unsupported')}</p></main>
  }

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>MapMyRideGPS</h1>
          <p className="sub">{t('appSubtitle')}</p>
        </div>
        <div className="actions">
          <select className="lang" aria-label={t('language')} value={lang} onChange={e => changeLang(e.target.value as Lang)}>
            {LANGS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          {savedDevice && !device && <button onClick={reconnectSaved}>{t('reconnectSaved', { name: savedDevice.name })}</button>}
          <button className={savedDevice && !device ? 'ghost' : undefined} onClick={doConnect}>{device ? t('reconnect') : t('connect')}</button>
          <button className="ghost"
            onClick={savedBackup && !backupDir
              ? () => run(async () => { if ((await savedBackup.requestPermission({ mode: 'readwrite' })) === 'granted') { setBackupDir(savedBackup); setSavedBackup(undefined) } })
              : pickBackup}>
            {backupDir ? t('backupLabel', { name: backupDir.name }) : savedBackup ? t('savedBackup', { name: savedBackup.name }) : t('setBackup')}
          </button>
        </div>
      </header>

      {!device && (
        <section className="card intro">
          <ol>
            <li>{t('intro1')}</li>
            <li>{t('intro2')}</li>
            <li>{t('intro3')}</li>
          </ol>
        </section>
      )}

      {error && (
        <div className="warn errorbar" role="alert">
          <b>{t('stopped')}</b> {error}
          <button className="ghost small" onClick={() => setError(undefined)}>{t('dismiss')}</button>
        </div>
      )}

      {busy && progress && stalledFor >= STALL_S && (
        <div className="alert stall" role="alert">
          <div className="alert-head">
            <span className="alert-icon" aria-hidden>⏳</span>
            <div>
              <b>{t('stallTitle', { s: stalledFor })}</b>
              <div className="small">{t('stallSub')}</div>
            </div>
          </div>
          <ol className="steps">
            {(['1', '2', '3'] as const).map(n => (
              <li key={n}>
                <b>{t(`stall${n}h` as Key)}</b>
                <span dangerouslySetInnerHTML={{ __html: t(`stall${n}` as Key) }} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {progress && (
        <div className="progress">
          <div className="row tight">
            <span>
              {phase && <b>{t(phase === 'backup' ? 'busyTitleBackup' : 'busyTitleInstall')} · </b>}
              {progress.label} {fmtBytes(progress.done)}{progress.total ? ` / ${fmtBytes(progress.total)}` : ''}
              {progress.total > 0 && <b> · {Math.floor((progress.done / progress.total) * 100)} %</b>}
            </span>
            <button className="ghost small" onClick={() => document.getElementById('activity')?.scrollIntoView({ behavior: 'smooth' })}>{t('busySeeActivity')}</button>
          </div>
          {progress.total > 0 && <progress value={progress.done} max={progress.total} />}
          {phase && <span className="small hot">⚠ {t('busyKeep')}</span>}
        </div>
      )}

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'maps'} className={tab === 'maps' ? 'tab on' : 'tab'} onClick={() => setTab('maps')}>{t('tabMaps')}</button>
        <button role="tab" aria-selected={tab === 'restore'} className={tab === 'restore' ? 'tab on' : 'tab'} onClick={() => setTab('restore')}>{t('tabRestore')}</button>
      </nav>

      {tab === 'maps' && <div className={`layout ${sideOpen ? 'side-open' : 'side-closed'}`}>
      <aside className="side" aria-label={t('sidebar')}>
        {sideOpen ? <>
          <div className="row tight">
            <h2>{t('sidebar')}</h2>
            <button className="ghost small" onClick={() => setSideOpen(false)} aria-label={t('sidebarHide')}>« {t('sidebarHide')}</button>
          </div>
          <SourcesPanel sources={sources} onChange={setSources} model={detected.model} how={detected.how} alert={sourcesAlert} />
          <ProxyPanel ok={proxyOk} value={proxyInput} onInput={setProxyInput}
            onSave={async () => { setProxy(proxyInput); setProxyInput(getProxy()); setProxyOk(undefined); setProxyOk(await probeProxy()) }} />
        </> : (
          <button className="ghost rail" onClick={() => setSideOpen(true)} title={t('sidebarShow')} aria-label={t('sidebarShow')}>
            <span aria-hidden>⚙</span>
            {(sourcesAlert || proxyOk === false) && <span className="badge" title={t('sidebarAlert')}>!</span>}
            <span className="rail-label">{t('sidebar')}</span>
          </button>
        )}
      </aside>
      <div className="maincol">
      {device && (
        <section className="card">
          <div className="row">
            <h2>{t('installedOn', { name: device.model ?? device.root.name })}</h2>
            <span className="muted">{t('regionsCount', { n: regions.length })} · {fmtBytes(files.reduce((s, f) => s + f.size, 0))}</span>
          </div>
          <StorageBar usage={usage} capacity={capacity}
            pending={plan ? plan.incoming.reduce((s, f) => s + f.size, 0) - plan.replaced.reduce((s, f) => s + f.size, 0) : 0}
            freeing={selectedFiles.reduce((s, f) => s + f.size, 0)}
            onCapacity={gb => { const b = Math.round(gb * 1e9); setCapacity(b); localStorage.setItem(`capacity:${device.model ?? device.root.name}`, String(b)) }} />
          <div className="row">
            <h3>{t('worldMap')}</h3>
            <button className="ghost small" onClick={() => setShowMap(v => !v)}>{showMap ? t('hideMap') : t('showMap')}</button>
          </div>
          {showMap && <MapView lang={lang} regions={regions} status={regionStatus} selected={selected} onToggle={toggleRegion} />}
          {issues && issues.length > 0 && (
            <div className="warn">
              {t('manifestIssues', { n: issues.length, file: `${issues[0].folder}/${issues[0].stem}`, detail: issues[0].detail })}{' '}
              <button className="small" onClick={doRepair} disabled={busy}>{t('repairManifests')}</button>
            </div>
          )}
          <table>
            <thead><tr><th>
              <input type="checkbox" title={t('selectAll')} aria-label={t('selectAllRegions')}
                checked={regions.length > 0 && selected.size === regions.length}
                ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < regions.length }}
                onChange={e => setSelected(e.target.checked ? new Set(regions.map(r => r.country)) : new Set())} />
            </th><th>{t('colRegion')}</th><th>{t('colMapDate')}</th><th>{t('colSource')}</th><th>{t('colFiles')}</th><th>{t('colSize')}</th><th>{t('colNewest')}</th></tr></thead>
            <tbody>
              {regions.map(r => <RegionRow key={r.country} r={r} catalog={catalog} checked={selected.has(r.country)}
                onToggle={() => toggleRegion(r.country)} />)}
            </tbody>
          </table>
          <div className="row">
            <span className="muted">{selected.size ? t('selectedInfo', { n: selected.size, size: fmtBytes(selectedFiles.reduce((s, f) => s + f.size, 0)) }) : t('tickToFree')}</span>
            <div className="actions">
              <button className="ghost small" disabled={busy || !regions.length} onClick={() => setSelected(new Set(regions.map(r => r.country)))}>{t('selectAll')}</button>
              <button className="ghost small" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>{t('clear')}</button>
              <button className="danger" disabled={busy || !selected.size} onClick={doRemove}>{t('removeSelected')}</button>
            </div>
          </div>
        </section>
      )}

      {device && (
        <section className="card">
          <h2 id="install">{t('installTitle')}</h2>
          <label className="drop"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); choosePackages(e.dataTransfer.files) }}>
            <input type="file" multiple accept=".zip,.map,.rtd" onChange={e => { choosePackages(e.target.files); e.target.value = '' }} />
            {t('dropHint')}
          </label>
          {plan && planMode === 'install' && (
            <>
              <PlanView plan={plan} mode="install" state={fileState} />
              <div className="row">
                <button className="ghost" onClick={() => run(discardPending)} disabled={busy}>{t('cancel')}</button>
                <button onClick={doInstall} disabled={busy || !plan.incoming.length}>{t('installToGps')}</button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card">
        <div className="row">
          <h2>{t('availableOnline')}</h2>
          <span className="muted">{t('sortedNewest')}</span>
        </div>
        <div className="row filters">
          <input placeholder={t('filterPlaceholder')} value={filter} onChange={e => setFilter(e.target.value)} />
          <label><input type="checkbox" checked={onlyMine} onChange={e => { setOnlyMine(e.target.checked); localStorage.setItem('onlyMine', String(e.target.checked)) }} /> {t('onlyMine')}</label>
        </div>
        {Object.entries(catalogErr).map(([k, v]) => <p key={k} className="warn">{t('couldNotLoad', { name: k, error: v })}</p>)}
        {!sources.some(s => s.enabled) && <p className="muted">{t('noSource')}</p>}
        {!catalog.length && sources.some(s => s.enabled) && !Object.keys(catalogErr).length && <p className="muted">{t('loadingCatalog')}</p>}
        <table>
          <thead><tr><th>{t('colMap')}</th><th>{t('colSource')}</th><th>{t('colVersion')}</th><th>{t('colSize')}</th><th>{t('colStatus')}</th><th></th></tr></thead>
          <tbody>
            {catalogGroups.map(g => {
              const single = g.items.length === 1
              const open = expanded.has(g.key) || !!filter.trim()
              const rows = g.items.map(c => <CatalogRow key={c.id} c={c} nested={!single} />)
              if (single) return rows
              const statuses = g.items.map(statusOf)
              const st: Status = statuses.includes('outdated') ? 'outdated' : statuses.includes('current') ? 'current' : 'missing'
              const newest = g.items[0]
              return [
                <tr key={g.key} className="group" onClick={() => setExpanded(e => { const n = new Set(e); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}>
                  <td><span className="caret">{open ? '▾' : '▸'}</span> <b>{groupName(g)}</b> <span className="muted small">{t('regionsCount', { n: g.items.length })}</span></td>
                  <td className="small muted">{[...new Set(g.items.map(i => i.sourceLabel))].join(', ')}</td>
                  <td>{rankToIso(newest.rank) ?? newest.version}</td>
                  <td>{fmtBytes(g.items.reduce((t, i) => t + i.size, 0))}</td>
                  <td><span className={pillClass(st)}>{t(STATUS_KEY[st])}</span></td>
                  <td className="muted small">{open ? t('hideRegions') : t('showRegions')}</td>
                </tr>,
                ...(open ? rows : []),
              ]
            })}
          </tbody>
        </table>
      </section>
      </div>
      </div>}

      {tab === 'restore' && <>
        <RestoreTab connected={!!device} busy={busy} backupDir={backupDir ?? savedBackup} run={run} onPlan={files => planRestore(files)} />
        {plan && planMode === 'restore' && (
          <section className="card">
            <PlanView plan={plan} mode="restore" state={fileState} />
            <div className="row">
              <button className="ghost" onClick={() => run(discardPending)} disabled={busy}>{t('cancel')}</button>
              <button onClick={doInstall} disabled={busy || !plan.incoming.length}>{t('restoreToGps')}</button>
            </div>
          </section>
        )}
      </>}

      {confirming && plan && (
        <InstallConfirm mode={planMode}
          backupName={(backupDir ?? savedBackup)?.name}
          backupBytes={plan.replaced.reduce((a, f) => a + f.size, 0)}
          writeBytes={plan.incoming.reduce((a, f) => a + f.size, 0)}
          onChangeFolder={changeBackupFolder}
          onStart={startInstall}
          onCancel={() => setConfirming(false)} />
      )}

      {folderPrompt && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fp-title">
          <div className="card">
            <h2 id="fp-title">{t(folderPrompt.kind === 'device' ? 'fpDeviceTitle' : 'fpBackupTitle')}</h2>
            <ol>
              {(folderPrompt.kind === 'device'
                ? ['fpDevice1', 'fpDevice2', 'fpDevice3', 'fpDevice4']
                : ['fpBackup1', 'fpBackup2', 'fpBackup3', 'fpBackup4'] as Key[]
              ).map(k => <li key={k} dangerouslySetInnerHTML={{ __html: tHtml(k as Key, { size: fmtBytes(folderPrompt.need ?? 0) }) }} />)}
            </ol>
            {folderPrompt.kind === 'backup' && !!folderPrompt.need && <p className="muted small">{t('fpBackupNeed', { size: fmtBytes(folderPrompt.need) })}</p>}
            <div className="row">
              <button className="ghost" onClick={() => folderPrompt.resolve(false)}>{t('cancel')}</button>
              <button autoFocus onClick={() => folderPrompt.resolve(true)}>{t(folderPrompt.kind === 'device' ? 'fpDeviceGo' : 'fpBackupGo')}</button>
            </div>
          </div>
        </div>
      )}

      {guideFor && (
        <div className="modal" onClick={() => setGuideFor(undefined)}>
          <div className="card" onClick={e => e.stopPropagation()}>
            <h2>{t('guideTitle', { name: guideFor.name })}</h2>
            <ol>
              <li>{t('guide1', { file: guideFor.url.split('/').pop() ?? '', size: fmtBytes(guideFor.size) })} <a href={guideFor.url}>{t('guide1b')}</a></li>
              <li>{t('guide2')}</li>
              <li>{t('guide3')}</li>
              <li>{t('guide4')}</li>
            </ol>
            <p className="warn small">{t('guideWarn')}</p>
            <div className="row"><span /><button onClick={() => setGuideFor(undefined)}>{t('gotIt')}</button></div>
          </div>
        </div>
      )}

      {log.length > 0 && (
        <section className="card">
          <h2 id="activity">{t('activity')}</h2>
          <pre className="log">{log.join('\n')}</pre>
        </section>
      )}

      <section className="card">
        <h2>{t('settings')}</h2>
        <p className="muted small">{t('settingsInfo', { size: fmtBytes(browserUsage) })}</p>
        <label className="small"><input type="checkbox" checked={sound} onChange={e => { setSound(e.target.checked); setSoundEnabled(e.target.checked); if (e.target.checked) play('done') }} /> {t('soundToggle')}</label>
        <div className="actions"><button className="danger small" onClick={clearSaved}>{t('clearData')}</button></div>
      </section>

      <footer className="muted small">{t('footer')}</footer>
    </main>
  )
}

function RegionRow({ r, catalog, checked, onToggle }: { r: Region; catalog: CatalogEntry[]; checked: boolean; onToggle: () => void }) {
  const newest = catalog.filter(c => c.country === r.country).sort((a, b) => b.rank - a.rank)[0]
  const newestIso = newest && rankToIso(newest.rank)
  const kinds = [...new Set(r.files.map(f => kindLabel(f.kind)))].join(', ')
  const outdated = newestIso && r.date && newestIso > r.date
  return (
    <tr>
      <td><input type="checkbox" checked={checked} onChange={onToggle} /></td>
      <td><b>{country(r.country)}</b> <code className="muted">{r.country}</code></td>
      <td>{r.date ?? '—'}</td>
      <td className="small"><SourceCell r={r} /></td>
      <td className="muted small" title={r.files.map(f => `${f.folder}/${f.name}`).join('\n')}>{r.files.length} · {kinds}</td>
      <td>{fmtBytes(r.size)}</td>
      <td>{newest ? <span className={`pill ${outdated ? 'hot' : 'ok'}`}>{newestIso ?? newest.version}</span> : <span className="muted">—</span>}</td>
    </tr>
  )
}


function StorageBar({ usage, capacity, pending, freeing, onCapacity }: {
  usage?: Usage; capacity?: number; pending: number; freeing: number; onCapacity: (gb: number) => void
}) {
  if (!usage) return <p className="muted small">{t('measuring')}</p>
  const cap = capacity ?? 0
  const free = cap ? Math.max(0, cap - usage.used) : 0
  const pct = (n: number) => cap ? `${Math.min(100, (n / cap) * 100)}%` : '0%'
  const after = free - pending + freeing
  return (
    <div className="storage">
      {cap > 0 && (
        <div className="bar" role="img" aria-label={t('storageAria', { used: fmtBytes(usage.used), cap: fmtBytes(cap) })}>
          <span className="seg maps" style={{ width: pct(Math.max(0, usage.maps - freeing)) }} />
          {freeing > 0 && <span className="seg freeing" style={{ width: pct(Math.min(freeing, usage.maps)) }} />}
          <span className="seg router" style={{ width: pct(usage.router) }} />
          <span className="seg other" style={{ width: pct(usage.other) }} />
          {pending > 0 && <span className="seg pending" style={{ width: pct(pending) }} />}
        </div>
      )}
      <div className="legend small">
        <span><i className="dot maps" />{t('maps')} {fmtBytes(usage.maps)}</span>
        <span><i className="dot router" />{t('routing')} {fmtBytes(usage.router)}</span>
        <span><i className="dot other" />{t('other')} {fmtBytes(usage.other)}</span>
        {cap > 0 && <span><i className="dot free" />{t('free', { size: fmtBytes(free) })}</span>}
        <span className="muted">
          {t('capacity')}{' '}
          <input className="cap" type="number" min={1} step={0.1} value={cap ? +(cap / 1e9).toFixed(1) : ''} placeholder="?"
            onChange={e => { const v = Number(e.target.value); if (v > 0) onCapacity(v) }} /> GB
        </span>
      </div>
      {cap > 0 && (pending !== 0 || freeing > 0) && (
        <p className={`small ${after < 0 ? 'warn' : 'muted'}`}>
          {after < 0 ? t('notEnough', { size: fmtBytes(-after) }) : t('afterChange', { size: fmtBytes(after) })}
        </p>
      )}
    </div>
  )
}

function SourceCell({ r }: { r: Region }) {
  const h = r.files.find(f => f.header && f.kind !== 'contour')?.header
  if (!h) return <span className="muted">—</span>
  const tip = [t('tipGenerator', { v: h.createdBy ?? t('unknown') }), t('tipFormat', { v: h.version }) + (h.vendorFlag ? t('tipVendor') : ''),
    t('tipBuilt', { v: h.mapDate }), t('tipArea', { v: `${h.bbox.minLat.toFixed(2)},${h.bbox.minLon.toFixed(2)} → ${h.bbox.maxLat.toFixed(2)},${h.bbox.maxLon.toFixed(2)}` }),
    h.comment && t('tipComment', { v: h.comment }), h.tags && t('tipTags', { poi: h.tags.poi, way: h.tags.way })].filter(Boolean).join('\n')
  return <span title={tip}>{h.vendorFlag ? t('srcPreloaded') : 'Mapsforge'} <span className="muted">· OSM {h.mapDate}</span></span>
}

function SourcesPanel({ sources, onChange, model, how, alert }: {
  sources: CatalogSource[]; onChange: (s: CatalogSource[]) => void; model?: string; how: 'device' | 'maps' | 'unknown'; alert?: boolean
}) {
  const [label, setLabel] = useState('')
  const [id, setId] = useState('')
  const [showAll, setShowAll] = useState(false)
  const valid = /^[0-9a-f-]{36}$/i.test(id.trim())
  const shown = sources.filter(s => showAll || isCompatible(s, model))
  const hidden = sources.length - shown.length
  const v1 = sources.find(x => x.id === 'igpsport-v1')
  return (
    <details className="sources" open={!model || alert}>
      <summary>{alert && <span className="badge" title={t('sidebarAlert')}>!</span>} <b>{t('sources')}</b> <span className="muted small">{t('sourcesSelected', { n: sources.filter(s => s.enabled).length, total: sources.length })}</span>{' '}
        {model && <span className="pill ok">{t(how === 'maps' ? 'detectedFromMaps' : 'detectedDevice', { model })}</span>}
      </summary>
      {!model && <p className="muted small">{t('connectToFilter')}</p>}
      <div className="about small">
        <b>{t('aboutSources')}</b>
        {(['aboutV3', 'aboutV1', 'aboutOam', 'aboutCustom'] as Key[])
          .filter(k => k !== 'aboutV1' || showAll || !v1 || isCompatible(v1, model))
          .map(k => <p key={k} dangerouslySetInnerHTML={{ __html: t(k) }} />)}
      </div>
      <ul>
        {shown.map(s => (
          <li key={s.id}>
            <label>
              <input type="checkbox" checked={s.enabled} onChange={e => onChange(sources.map(x => x.id === s.id ? { ...x, enabled: e.target.checked } : x))} />{' '}
              <b>{s.label}</b> <code className="muted small">{s.mapVersionId}</code>
            </label>
            {!s.builtin && <button className="ghost small" onClick={() => onChange(sources.filter(x => x.id !== s.id))}>{t('remove')}</button>}
            {(s.builtin ? t(`note_${s.id.replace(/-/g, '_')}` as Key) : s.note) && <p className="muted small">{s.builtin ? t(`note_${s.id.replace(/-/g, '_')}` as Key) : s.note}</p>}
          </li>
        ))}
      </ul>
      {model && (hidden > 0 || showAll) && (
        <label className="muted small"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> {t('showOtherCatalogs', { n: hidden })}</label>
      )}
      <div className="row filters">
        <input placeholder={t('sourceName')} value={label} onChange={e => setLabel(e.target.value)} />
        <input placeholder={t('sourceId')} value={id} onChange={e => setId(e.target.value)} />
        <button className="small" disabled={!valid} onClick={() => {
          onChange([...sources, { id: `custom:${id.trim()}`, label: label.trim() || t('customSource', { id: id.trim().slice(0, 8) }), mapVersionId: id.trim(), enabled: true }])
          setLabel(''); setId('')
        }}>{t('addSource')}</button>
      </div>
    </details>
  )
}

function ProxyPanel({ ok, value, onInput, onSave }: { ok?: boolean; value: string; onInput: (v: string) => void; onSave: () => void }) {
  return (
    <details className="sources" open={ok === false}>
      <summary>{ok === false && <span className="badge" title={t('sidebarAlert')}>!</span>} <b>{t('proxy')}</b>{' '}
        <span className={`pill ${ok ? 'ok' : ok === false ? 'hot' : ''}`}>{ok ? t('proxyOk') : ok === false ? t('proxyDown') : t('checking')}</span>
      </summary>
      <p className="muted small">{t('proxyHelp')}</p>
      <div className="row filters">
        <input placeholder={t('proxyPlaceholder')} value={value} onChange={e => onInput(e.target.value)} />
        <button className="small" onClick={onSave}>{t('saveTest')}</button>
      </div>
    </details>
  )
}
