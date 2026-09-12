import { useEffect, useRef, useState } from 'react'
import type Uppy from '@uppy/core'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowClockwise, Check, ImageBroken, Pause, Play, Warning, X } from '@phosphor-icons/react'
import { bouncy, fmtDur, pop, spring, STAGGER, useSmooth, zoom, type F } from './shared'

export type Open = { id: string; url: string; video: boolean }

function useObjectURL(file: F): string {
  const ref = useRef<string>('')
  if (!ref.current) ref.current = URL.createObjectURL(file.data as Blob)
  useEffect(() => () => URL.revokeObjectURL(ref.current), [])
  return ref.current
}

export function Tile({ file, uppy, locked, hidden, delay, onOpen }: { file: F; uppy: Uppy; locked: boolean; hidden: boolean; delay: number; onOpen: (o: Open) => void }) {
  const url = useObjectURL(file)
  const video = !!file.type?.startsWith('video/')
  const [dur, setDur] = useState<number | null>(null)
  const frac = useSmooth((file.progress.percentage ?? 0) / 100)
  const state = file.error ? 'error' : file.progress.uploadComplete ? 'done' : file.isPaused ? 'paused' : file.progress.uploadStarted ? 'uploading' : 'ready'
  const tilt = Math.round(delay / STAGGER) % 2 ? 8 : -8

  return (
    <motion.div layoutId={`${file.id}-tile`} className={`tile ${state}`} initial={{ y: 56, scale: 0.7, rotate: tilt, opacity: 0 }} animate={{ y: 0, scale: 1, rotate: 0, opacity: 1, transition: { ...bouncy, delay } }} exit={pop} transition={spring} whileTap={{ scale: 0.97 }}
      onClick={() => onOpen({ id: file.id, url, video })}>
      {!hidden && (video
        ? <motion.video layoutId={file.id} src={url} muted playsInline preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} transition={zoom} />
        : <motion.img layoutId={file.id} src={url} alt="" transition={zoom} />)}
      <div className="veil" />
      {video && state === 'ready' && <div className="center"><span className="play"><Play size={14} weight="fill" style={{ marginLeft: 2 }} /></span></div>}
      {video && dur != null && Number.isFinite(dur) && <span className="dur">{fmtDur(dur)}</span>}
      {state === 'ready' && !locked && <motion.button className="x" aria-label="Remove" whileTap={{ scale: 0.85 }} onClick={(e) => { e.stopPropagation(); uppy.removeFile(file.id) }}><X size={13} weight="bold" /></motion.button>}
      {state === 'uploading' && (
        <div className="center">
          <svg className="ring" viewBox="0 0 48 48">
            <circle className="track" cx="24" cy="24" r="20" />
            <motion.circle className="bar" cx="24" cy="24" r="20" style={{ pathLength: frac }} transform="rotate(-90 24 24)" />
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

export function RejectedTile({ reason, delay, onDismiss }: { reason: 'size' | 'type'; delay: number; onDismiss: () => void }) {
  return (
    <motion.div layout className="tile rejected" initial={pop} animate={{ scale: 1, opacity: 1, x: [0, -6, 6, -4, 4, 0], transition: { ...spring, delay } }} exit={pop} transition={spring}>
      <div className="center">
        {reason === 'size' ? <><Warning size={38} weight="fill" /><span className="reject-label">&gt; 500 MB</span></> : <ImageBroken size={38} weight="regular" />}
      </div>
      <motion.button className="x" aria-label="Dismiss" whileTap={{ scale: 0.85 }} onClick={onDismiss}><X size={13} weight="bold" /></motion.button>
    </motion.div>
  )
}
