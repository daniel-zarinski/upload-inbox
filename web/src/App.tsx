import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Uppy, { type UppyFile, type Meta, type Body } from '@uppy/core'
import Tus from '@uppy/tus'
import { UppyContextProvider, useDropzone, useFileInput, useUppyState } from '@uppy/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowClockwise, Check, PaperPlaneTilt, Pause, Play, Plus, Prohibit, VideoCamera, X } from '@phosphor-icons/react'

const MB = 1024 * 1024
type F = UppyFile<Meta, Body>
const spring = { type: 'spring', stiffness: 420, damping: 30 } as const

// Uppy locale packs, loaded on demand. ?lang=fr wins, then browser languages.
const localeModules = import.meta.glob<{ default: unknown }>('../node_modules/@uppy/locales/lib/*_*.js')
const localeNames = Object.keys(localeModules).map((p) => p.split('/').pop()!.replace('.js', ''))

export function pickLocale(wanted: readonly string[], names: readonly string[] = localeNames): string | undefined {
  for (const tag of wanted) {
    const [lang, region] = tag.toLowerCase().split(/[-_]/)
    if (!lang || lang === 'en') return undefined // en_US is Uppy's default
    const exact = names.find((n) => n.toLowerCase() === `${lang}_${region ?? ''}`)
    if (exact) return exact
    const prefix = names.find((n) => n.toLowerCase().startsWith(`${lang}_`))
    if (prefix) return prefix
  }
  return undefined
}

function makeUppy() {
  return new Uppy({
    // English defaults for the two strings this UI shows; locale packs override them.
    locale: { strings: { uploadXFiles: { 0: 'Send %{smart_count} file', 1: 'Send %{smart_count} files' } }, pluralize: (n: number) => (n === 1 ? 0 : 1) },
    restrictions: { allowedFileTypes: ['image/*', 'video/*'], maxFileSize: 500 * MB },
  }).use(Tus, {
    endpoint: '/files/',
    chunkSize: 25 * MB, // Cloudflare free tier caps a request at 100 MB
    limit: 3,
    retryDelays: [0, 1000, 3000, 5000],
    allowedMetaFields: ['name', 'type'], // @uppy/tus maps name→filename, type→filetype
  })
}

export default function App() {
  const [uppy] = useState(makeUppy)
  useEffect(() => {
    const forced = new URLSearchParams(location.search).get('lang')
    const name = pickLocale(forced ? [forced] : navigator.languages)
    if (!name) return
    localeModules[`../node_modules/@uppy/locales/lib/${name}.js`]?.().then((m) => {
      uppy.setOptions({ locale: m.default as never })
    })
  }, [uppy])
  return (
    <UppyContextProvider uppy={uppy}>
      <Inbox uppy={uppy} />
    </UppyContextProvider>
  )
}

type Phase = 'idle' | 'ready' | 'uploading' | 'paused' | 'done' | 'failed'

function Inbox({ uppy }: { uppy: Uppy }) {
  const files = useUppyState(uppy, (s) => s.files)
  const progress = useUppyState(uppy, (s) => s.totalProgress)
  const list = Object.values(files) as F[]
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const onUpload = () => { setBusy(true); setPaused(false) }
    const onComplete = () => setBusy(false)
    const onReject = (_f: unknown, err: Error) => setToast(err.message)
    uppy.on('upload', onUpload)
    uppy.on('complete', onComplete)
    uppy.on('restriction-failed', onReject)
    return () => { uppy.off('upload', onUpload); uppy.off('complete', onComplete); uppy.off('restriction-failed', onReject) }
  }, [uppy])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const allDone = list.length > 0 && list.every((f) => f.progress.uploadComplete)
  const anyError = list.some((f) => f.error)
  const phase: Phase = list.length === 0 ? 'idle' : busy ? (paused ? 'paused' : 'uploading') : allDone ? 'done' : anyError ? 'failed' : 'ready'

  const input = useFileInput()
  const [dragging, setDragging] = useState(false)
  const onDragEnter = useCallback(() => setDragging(true), [])
  const onDragLeave = useCallback(() => setDragging(false), [])
  const onDrop = useCallback(() => setDragging(false), [])
  const drop = useDropzone(useMemo(() => ({ noClick: true, onDragEnter, onDragLeave, onDrop }), [onDragEnter, onDragLeave, onDrop]))

  const act = () => {
    if (phase === 'ready') uppy.upload()
    else if (phase === 'uploading') { uppy.pauseAll(); setPaused(true) }
    else if (phase === 'paused') { uppy.resumeAll(); setPaused(false) }
    else if (phase === 'failed') uppy.retryAll()
    else if (phase === 'done') uppy.clear()
  }

  return (
    <div {...drop.getRootProps()} className={`app${dragging ? ' dragging' : ''}`}>
      <input {...input.getInputProps()} />
      <AnimatePresence mode="wait">
        {phase === 'idle' ? (
          <motion.div key="idle" className="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
            <motion.button
              className="idle-btn"
              aria-label="Add photos and videos"
              {...input.getButtonProps()}
              animate={reduce ? undefined : { scale: [1, 1.05, 1] }}
              transition={reduce ? undefined : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              whileTap={{ scale: 0.92 }}
            >
              <Plus size={72} weight="bold" />
            </motion.button>
          </motion.div>
        ) : (
          <motion.div key="grid" className="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AnimatePresence>
              {list.map((f) => (
                <Tile key={f.id} file={f} uppy={uppy} locked={busy || allDone} />
              ))}
              {!busy && !allDone && (
                <motion.button key="add" layout className="add" aria-label="Add more" {...input.getButtonProps()}
                  initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring} whileTap={{ scale: 0.94 }}>
                  <Plus size={36} weight="bold" />
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase !== 'idle' && (
          <motion.div key="dock" className="dock" initial={{ y: 120 }} animate={{ y: 0 }} exit={{ y: 120 }} transition={spring}>
            <motion.button className={`cta ${phase}${phase === 'ready' ? ' send' : ''}`} onClick={act} whileTap={{ scale: 0.97 }} aria-label={phase}>
              {(phase === 'uploading' || phase === 'paused') && (
                <motion.span className="fill" initial={{ scaleX: 0 }} animate={{ scaleX: progress / 100 }} transition={{ ease: 'easeOut', duration: 0.35 }} />
              )}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={phase} className="label" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -24, opacity: 0 }} transition={spring}>
                  {phase === 'ready' && <><PaperPlaneTilt size={30} weight="fill" />{uppy.i18n('uploadXFiles', { smart_count: list.length })}</>}
                  {phase === 'uploading' && <><Pause size={30} weight="fill" />{Math.round(progress)}%</>}
                  {phase === 'paused' && <><Play size={30} weight="fill" />{Math.round(progress)}%</>}
                  {phase === 'failed' && <ArrowClockwise size={32} weight="bold" />}
                  {phase === 'done' && <Check size={34} weight="bold" />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div key="toast" className="toast" role="alert" initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -80, opacity: 0 }} transition={spring}>
            <Prohibit size={24} weight="bold" />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function useObjectURL(file: F): string {
  const ref = useRef<string>('')
  if (!ref.current) ref.current = URL.createObjectURL(file.data as Blob)
  useEffect(() => () => URL.revokeObjectURL(ref.current), [])
  return ref.current
}

function Tile({ file, uppy, locked }: { file: F; uppy: Uppy; locked: boolean }) {
  const url = useObjectURL(file)
  const video = file.type?.startsWith('video/')
  const done = !!file.progress.uploadComplete
  const pct = file.progress.percentage ?? 0
  const state = file.error ? 'error' : done ? 'done' : file.isPaused ? 'paused' : file.progress.uploadStarted ? 'uploading' : 'ready'
  const r = 24, c = 2 * Math.PI * r

  return (
    <motion.div layout className={`tile ${state}`} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring}>
      {video ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt="" />}
      {video && <VideoCamera className="tile-kind" size={20} weight="fill" />}

      {state === 'ready' && !locked && (
        <button className="tile-x" aria-label="Remove" onClick={() => uppy.removeFile(file.id)}><X size={18} weight="bold" /></button>
      )}
      {(state === 'uploading' || state === 'paused') && (
        <div className="tile-center">
          <svg className="ring" viewBox="0 0 56 56">
            <circle className="track" cx="28" cy="28" r={r} />
            <circle className="bar" cx="28" cy="28" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
          </svg>
          {state === 'paused' && <Pause size={22} weight="fill" />}
        </div>
      )}
      {state === 'error' && (
        <button className="tile-retry" aria-label="Retry" onClick={() => uppy.retryUpload(file.id)}>
          <span><ArrowClockwise size={28} weight="bold" /></span>
        </button>
      )}
      <AnimatePresence>
        {state === 'done' && (
          <motion.div key="ok" className="tile-badge" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring}>
            <Check size={18} weight="bold" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
