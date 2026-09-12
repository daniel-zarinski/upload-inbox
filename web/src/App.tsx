import { useEffect, useMemo, useRef, useState } from 'react'
import Uppy, { type UppyFile, type Meta, type Body } from '@uppy/core'
import Tus from '@uppy/tus'
import { UppyContextProvider, useDropzone, useFileInput, useUppyState } from '@uppy/react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowClockwise, ArrowUp, Check, ImageBroken, Pause, Play, Plus, Warning, X } from '@phosphor-icons/react'

const MB = 1024 * 1024
const MAX = 500 * MB
type F = UppyFile<Meta, Body>
const spring = { type: 'spring', stiffness: 420, damping: 30 } as const
const zoom = { type: 'spring', bounce: 0, duration: 0.45 } as const // no overshoot on the preview zoom
const RING = 2 * Math.PI * 46
const TILE_R = 20, TILE_C = 2 * Math.PI * TILE_R

function makeUppy() {
  return new Uppy({
    restrictions: { allowedFileTypes: ['image/*', 'video/*'], maxFileSize: MAX },
  }).use(Tus, {
    endpoint: '/files/',
    chunkSize: 25 * MB, // Cloudflare free tier caps a request at 100 MB
    limit: 3,
    retryDelays: [0, 1000, 3000, 5000],
    allowedMetaFields: ['name', 'type'], // @uppy/tus maps name→filename, type→filetype
  })
}

// Numerals only: "1.2 GB", "348 MB"
export function fmt(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`
  return `${Math.round(bytes / MB)} MB`
}
export function fmtDur(s: number): string {
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

export default function App() {
  const [uppy] = useState(makeUppy)
  return (
    <UppyContextProvider uppy={uppy}>
      <Inbox uppy={uppy} />
    </UppyContextProvider>
  )
}

type Rejected = { id: string; reason: 'size' | 'type' }
type Phase = 'idle' | 'ready' | 'sending' | 'done'

function Inbox({ uppy }: { uppy: Uppy }) {
  const files = useUppyState(uppy, (s) => s.files)
  const list = Object.values(files) as F[]
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const [rejected, setRejected] = useState<Rejected[]>([])
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState<{ id: string; url: string; video: boolean } | null>(null)

  useEffect(() => {
    const onUpload = () => { setBusy(true); setPaused(false) }
    const onComplete = () => setBusy(false)
    const onReject = (f: { size?: number | null } | undefined) => {
      const reason: Rejected['reason'] = (f?.size ?? 0) > MAX ? 'size' : 'type'
      setRejected((r) => [...r, { id: `${Date.now()}-${r.length}`, reason }])
    }
    uppy.on('upload', onUpload); uppy.on('complete', onComplete); uppy.on('restriction-failed', onReject)
    return () => { uppy.off('upload', onUpload); uppy.off('complete', onComplete); uppy.off('restriction-failed', onReject) }
  }, [uppy])

  const drop = useDropzone(useMemo(() => ({ noClick: true, onDragEnter: () => setDragging(true), onDragLeave: () => setDragging(false), onDrop: () => setDragging(false) }), []))
  const input = useFileInput()

  const total = list.reduce((n, f) => n + (f.size ?? 0), 0)
  const sent = list.reduce((n, f) => n + (f.progress.bytesUploaded || 0), 0)
  const failedLeft = list.filter((f) => f.error).reduce((n, f) => n + ((f.size ?? 0) - (f.progress.bytesUploaded || 0)), 0)
  const allDone = list.length > 0 && list.every((f) => f.progress.uploadComplete)
  const anyError = list.some((f) => f.error)
  const phase: Phase = list.length === 0 && rejected.length === 0 ? 'idle' : allDone ? 'done' : busy || anyError ? 'sending' : 'ready'

  const failed = phase === 'sending' && !busy && anyError
  const fabIcon = phase === 'idle' || phase === 'done' ? 'plus' : phase === 'ready' ? 'send' : failed ? 'retry' : paused ? 'play' : 'pause'
  const reset = () => { uppy.clear(); setRejected([]); setBusy(false); setPaused(false) }

  return (
    <div {...drop.getRootProps()} className={`app${dragging ? ' dragging' : ''}`}>
      <input {...input.getInputProps()} />
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'idle' && (
          <motion.button key="idle" className="home" aria-label="Add photos and videos" {...input.getButtonProps()}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span className="stack"><i className="back" /><i className="front"><Play size={24} weight="fill" /></i><i className="dot" /></span>
            <span className="beacon"><span className="ripple" /></span>
          </motion.button>
        )}

        {phase !== 'idle' && (
          <motion.div key="grid" style={{ display: 'contents' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="chip-row"><span className="chip">{phase === 'sending' ? `${fmt(sent)} / ${fmt(total)}` : `${list.length} · ${fmt(total)}`}</span></div>
            <div className="grid">
              <AnimatePresence>
                {list.map((f) => <Tile key={f.id} file={f} uppy={uppy} locked={phase !== 'ready'} hidden={open?.id === f.id} onOpen={setOpen} />)}
                {rejected.map((r) => <RejectedTile key={r.id} reason={r.reason} onDismiss={() => setRejected((x) => x.filter((y) => y.id !== r.id))} />)}
                {phase === 'ready' && (
                  <motion.button key="add" layout className="add" aria-label="Add more" {...input.getButtonProps()}
                    initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring} whileTap={{ scale: 0.94 }}>
                    <Plus size={34} weight="bold" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {/* Preview: the tile's media and this one share a layoutId, so Motion animates it to full size and back. */}
      <AnimatePresence>
        {open && (
          <motion.div key="lightbox" className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)}>
            {open.video
              ? <motion.video layoutId={open.id} src={open.url} controls autoPlay playsInline transition={zoom} onClick={(e) => e.stopPropagation()} />
              : <motion.img layoutId={open.id} src={open.url} alt="" transition={zoom} />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* One button for the whole flow: Motion `layout` moves and resizes it between phases. */}
      <motion.button layout className={`fab ${phase}${paused ? ' paused' : ''}${failed ? ' failed' : ''}`}
        aria-label={phase} disabled={phase === 'ready' && list.length === 0} whileTap={{ scale: 0.94 }}
        animate={{ scale: phase === 'idle' || phase === 'done' ? [1, 1.05, 1] : 1 }}
        transition={{ layout: spring, scale: phase === 'idle' || phase === 'done' ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : spring }}
        onClick={phase === 'idle' ? input.getButtonProps().onClick : phase === 'ready' ? () => uppy.upload() : phase === 'done' ? () => { reset(); input.getButtonProps().onClick() }
          : () => { if (failed) { uppy.retryAll(); return } paused ? uppy.resumeAll() : uppy.pauseAll(); setPaused(!paused) }}>
        <AnimatePresence>
          {phase === 'sending' && (
            <motion.svg key="ring" className="fab-ring" viewBox="0 0 100 100" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
              <circle className="track" cx="50" cy="50" r="46" />
              {failedLeft > 0 && <circle className="fail" cx="50" cy="50" r="46" strokeDasharray={RING} strokeDashoffset={RING * (1 - (sent + failedLeft) / (total || 1))} transform="rotate(-90 50 50)" />}
              <circle className="bar" cx="50" cy="50" r="46" strokeDasharray={RING} strokeDashoffset={RING * (1 - sent / (total || 1))} transform="rotate(-90 50 50)" />
            </motion.svg>
          )}
        </AnimatePresence>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={fabIcon} className="fab-icon" initial={{ scale: 0.4, opacity: 0, rotate: -90 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.4, opacity: 0, rotate: 90 }} transition={spring}>
            {fabIcon === 'plus' && <Plus size={56} weight="bold" />}
            {fabIcon === 'send' && <ArrowUp size={34} weight="bold" />}
            {fabIcon === 'pause' && <Pause size={28} weight="fill" />}
            {fabIcon === 'play' && <Play size={28} weight="fill" />}
            {fabIcon === 'retry' && <ArrowClockwise size={30} weight="bold" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
  )
}

function useObjectURL(file: F): string {
  const ref = useRef<string>('')
  if (!ref.current) ref.current = URL.createObjectURL(file.data as Blob)
  useEffect(() => () => URL.revokeObjectURL(ref.current), [])
  return ref.current
}

function Tile({ file, uppy, locked, hidden, onOpen }: { file: F; uppy: Uppy; locked: boolean; hidden: boolean; onOpen: (o: { id: string; url: string; video: boolean }) => void }) {
  const url = useObjectURL(file)
  const video = !!file.type?.startsWith('video/')
  const [dur, setDur] = useState<number | null>(null)
  const pct = file.progress.percentage ?? 0
  const state = file.error ? 'error' : file.progress.uploadComplete ? 'done' : file.isPaused ? 'paused' : file.progress.uploadStarted ? 'uploading' : 'ready'

  return (
    <motion.div layout className={`tile ${state}`} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring}
      onClick={() => onOpen({ id: file.id, url, video })}>
      {!hidden && (video
        ? <motion.video layoutId={file.id} src={url} muted playsInline preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} transition={zoom} />
        : <motion.img layoutId={file.id} src={url} alt="" transition={zoom} />)}
      <div className="veil" />
      {video && state === 'ready' && <div className="center"><span className="play"><Play size={14} weight="fill" style={{ marginLeft: 2 }} /></span></div>}
      {video && dur != null && Number.isFinite(dur) && <span className="dur">{fmtDur(dur)}</span>}
      {state === 'ready' && !locked && <button className="x" aria-label="Remove" onClick={(e) => { e.stopPropagation(); uppy.removeFile(file.id) }}><X size={13} weight="bold" /></button>}
      {state === 'uploading' && (
        <div className="center">
          <svg className="ring" viewBox="0 0 48 48">
            <circle className="track" cx="24" cy="24" r={TILE_R} />
            <circle className="bar" cx="24" cy="24" r={TILE_R} strokeDasharray={TILE_C} strokeDashoffset={TILE_C * (1 - pct / 100)} transform="rotate(-90 24 24)" />
          </svg>
        </div>
      )}
      {state === 'paused' && <div className="center" style={{ color: 'var(--muted)' }}><Pause size={24} weight="bold" /><span className="dots"><i /><i /><i /></span></div>}
      {state === 'error' && (
        <button className="center" aria-label="Retry" onClick={(e) => { e.stopPropagation(); uppy.retryUpload(file.id) }}>
          <span className="bang">!</span><span className="retry"><ArrowClockwise size={22} weight="bold" /></span>
        </button>
      )}
      <AnimatePresence>
        {state === 'done' && (
          <motion.div key="ok" className="center" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring}>
            <span className="badge-done"><Check size={18} weight="bold" /></span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function RejectedTile({ reason, onDismiss }: { reason: 'size' | 'type'; onDismiss: () => void }) {
  return (
    <motion.div layout className="tile rejected" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1, x: [0, -6, 6, -4, 4, 0] }} exit={{ scale: 0.6, opacity: 0 }} transition={spring}>
      <div className="center">
        {reason === 'size' ? <><Warning size={38} weight="fill" /><span className="reject-label">&gt; 500 MB</span></> : <ImageBroken size={38} weight="regular" />}
      </div>
      <button className="x" aria-label="Dismiss" onClick={onDismiss}><X size={13} weight="bold" /></button>
    </motion.div>
  )
}
