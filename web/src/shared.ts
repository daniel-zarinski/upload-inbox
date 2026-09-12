import { useEffect } from 'react'
import Uppy, { type UppyFile, type Meta, type Body } from '@uppy/core'
import Tus from '@uppy/tus'
import GoldenRetriever from '@uppy/golden-retriever'
import { useMotionValue, useSpring } from 'motion/react'

export const MB = 1024 * 1024
export const MAX = 500 * MB
export type F = UppyFile<Meta, Body>
export type Phase = 'idle' | 'ready' | 'sending' | 'done'

export const spring = { type: 'spring', stiffness: 420, damping: 30 } as const
export const bouncy = { type: 'spring', stiffness: 420, damping: 16 } as const
export const zoom = { type: 'spring', bounce: 0, duration: 0.45 } as const // no overshoot on the preview zoom
export const pop = { scale: 0.6, opacity: 0 }
export const STAGGER = 0.05

export function makeUppy() {
  const uppy = new Uppy({
    restrictions: { allowedFileTypes: ['image/*', 'video/*'], maxFileSize: MAX },
  }).use(Tus, {
    endpoint: '/files/',
    chunkSize: 40 * MB, // under Cloudflare's 100 MB body cap; also caps progress lost when a phone suspends the tab mid-chunk
    limit: 3,
    retryDelays: [0, 1000, 3000, 5000],
    allowedMetaFields: ['name', 'type'], // @uppy/tus maps name→filename, type→filetype
  }).use(GoldenRetriever, { serviceWorker: false }) // reload/tab eviction restores the list; tus uploadUrl is persisted so parts resume
  // Files >40 MB get 4 parallel partial uploads (tus concat), one per cloudflared HA connection; a single stream is the choke point.
  // Photos stay 1 POST + 1 PATCH.
  uppy.on('file-added', (f) => {
    if ((f.size ?? 0) > 40 * MB) uppy.setFileState(f.id, { tus: { parallelUploads: 4 } })
  })
  return uppy
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

// Spring-smoothed 0..1 fraction; tus reports progress in chunks, this makes fills move continuously.
export function useSmooth(n: number) {
  const v = useSpring(useMotionValue(0), spring)
  useEffect(() => { v.set(n) }, [v, n])
  return v
}
