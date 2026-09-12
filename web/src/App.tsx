import { useEffect, useMemo, useRef, useState } from 'react'
import type Uppy from '@uppy/core'
import { UppyContextProvider, useDropzone, useFileInput, useUppyState } from '@uppy/react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Play, Plus } from '@phosphor-icons/react'
import { fmt, makeUppy, MAX, pop, spring, STAGGER, useSmooth, zoom, type F, type Phase } from './shared'
import { Fab } from './Fab'
import { RejectedTile, Tile, type Open } from './Tile'

export { fmt, fmtDur } from './shared'

export default function App() {
  const [uppy] = useState(makeUppy)
  return (
    <MotionConfig reducedMotion="user">
      <UppyContextProvider uppy={uppy}>
        <Inbox uppy={uppy} />
      </UppyContextProvider>
    </MotionConfig>
  )
}

type Rejected = { id: string; reason: 'size' | 'type' }

function Inbox({ uppy }: { uppy: Uppy }) {
  const files = useUppyState(uppy, (s) => s.files)
  const list = Object.values(files) as F[]
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const [rejected, setRejected] = useState<Rejected[]>([])
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState<Open | null>(null)

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

  // Tiles new in this render get a cascading enter delay, so a batch drop staggers instead of popping together.
  const seen = useRef(new Set<string>())
  const fresh = [...list.map((f) => f.id), ...rejected.map((r) => r.id)].filter((id) => !seen.current.has(id))
  useEffect(() => { fresh.forEach((id) => seen.current.add(id)) })
  const delayOf = (id: string) => Math.max(0, fresh.indexOf(id)) * STAGGER

  const total = list.reduce((n, f) => n + (f.size ?? 0), 0)
  const sent = list.reduce((n, f) => n + (f.progress.bytesUploaded || 0), 0)
  const failedLeft = list.filter((f) => f.error).reduce((n, f) => n + ((f.size ?? 0) - (f.progress.bytesUploaded || 0)), 0)
  const allDone = list.length > 0 && list.every((f) => f.progress.uploadComplete)
  const anyError = list.some((f) => f.error)
  const phase: Phase = list.length === 0 && rejected.length === 0 ? 'idle' : allDone ? 'done' : busy || anyError ? 'sending' : 'ready'
  const sentFrac = useSmooth(sent / (total || 1))
  const failFrac = useSmooth((sent + failedLeft) / (total || 1))

  const failed = phase === 'sending' && !busy && anyError
  const reset = () => { uppy.clear(); setRejected([]); setBusy(false); setPaused(false) }
  const fabClick = phase === 'idle' ? input.getButtonProps().onClick : phase === 'ready' ? () => uppy.upload() : phase === 'done' ? () => { reset(); input.getButtonProps().onClick() }
    : () => { if (failed) { uppy.retryAll(); return } paused ? uppy.resumeAll() : uppy.pauseAll(); setPaused(!paused) }

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
          <motion.div key="grid" className="stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="chip-row">
              <motion.span layout className="chip" transition={spring}>{phase === 'sending' ? `${fmt(sent)} / ${fmt(total)}` : `${list.length} · ${fmt(total)}`}</motion.span>
            </div>
            <div className="grid">
              <AnimatePresence>
                {list.map((f) => <Tile key={f.id} file={f} uppy={uppy} locked={phase !== 'ready'} hidden={open?.id === f.id} delay={delayOf(f.id)} onOpen={setOpen} />)}
                {rejected.map((r) => <RejectedTile key={r.id} reason={r.reason} delay={delayOf(r.id)} onDismiss={() => setRejected((x) => x.filter((y) => y.id !== r.id))} />)}
                {phase === 'ready' && (
                  <motion.button key="add" layout className="add" aria-label="Add more" {...input.getButtonProps()}
                    initial={pop} animate={{ scale: 1, opacity: 1, transition: { ...spring, delay: fresh.length * STAGGER } }} exit={pop} transition={spring} whileTap={{ scale: 0.94 }}>
                    <Plus size={34} weight="bold" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview: the tile's media and this one share a layoutId, so Motion animates it to full size and back. Drag down to dismiss. */}
      <AnimatePresence>
        {open && (
          <motion.div key="lightbox" className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)}>
            {open.video
              ? <motion.video layoutId={open.id} src={open.url} controls autoPlay playsInline transition={zoom} onClick={(e) => e.stopPropagation()}
                  drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.6} onDragEnd={(_, i) => { if (Math.abs(i.offset.y) > 100) setOpen(null) }} />
              : <motion.img layoutId={open.id} src={open.url} alt="" transition={zoom}
                  drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.6} onDragEnd={(_, i) => { if (Math.abs(i.offset.y) > 100) setOpen(null) }} />}
          </motion.div>
        )}
      </AnimatePresence>

      <Fab phase={phase} paused={paused} failed={failed} sent={sentFrac} failLevel={failFrac} hasFailed={failedLeft > 0} disabled={phase === 'ready' && list.length === 0} onClick={fabClick} />
    </div>
  )
}
