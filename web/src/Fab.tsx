import { useEffect } from 'react'
import { AnimatePresence, motion, useAnimate, useTransform, type MotionValue } from 'motion/react'
import { ArrowClockwise, ArrowUp, Pause, Play, Plus } from '@phosphor-icons/react'
import { bouncy, spring, useSmooth, type Phase } from './shared'

type Props = { phase: Phase; paused: boolean; failed: boolean; sent: MotionValue<number>; failLevel: MotionValue<number>; hasFailed: boolean; disabled: boolean; onClick: () => void }

// A liquid that rises from the bottom of the button. `level` is 0..1; the crest rides just above the water line.
function Wave({ level, className, slow }: { level: MotionValue<number>; className: string; slow: boolean }) {
  const y = useTransform(level, (v) => `${(1 - v) * 116}%`)
  return (
    <motion.div className="wave" style={{ y }}>
      <motion.svg viewBox="0 0 288 110" preserveAspectRatio="none" animate={{ x: ['0%', '-33.333%'] }} transition={{ duration: slow ? 4 : 1.4, repeat: Infinity, ease: 'linear' }}>
        <path className={className} d="M0 8 Q24 0 48 8 T96 8 T144 8 T192 8 T240 8 T288 8 V110 H0 Z" />
      </motion.svg>
    </motion.div>
  )
}

// One button for the whole flow. Motion `layout` moves it between phases; the body squashes on every phase change (Jelly),
// progress fills it like a glass (Liquid), icons launch out the top and drop in from below.
export function Fab({ phase, paused, failed, sent, failLevel, hasFailed, disabled, onClick }: Props) {
  const icon = phase === 'idle' ? 'plus' : phase === 'ready' ? 'send' : phase === 'done' ? 'check' : failed ? 'retry' : paused ? 'play' : 'pause'
  const idleLevel = useSmooth(0.38)
  const [body, animate] = useAnimate()
  useEffect(() => { animate(body.current, { scaleX: [1.25, 1], scaleY: [0.78, 1] }, { type: 'spring', stiffness: 380, damping: 12 }) }, [animate, body, phase])
  return (
    <motion.button layout className={`fab ${phase}${paused ? ' paused' : ''}${failed ? ' failed' : ''}`} aria-label={phase} disabled={disabled} onClick={onClick}
      whileTap={{ scaleX: 1.12, scaleY: 0.88 }} transition={{ layout: spring }}>
      <motion.div ref={body} className="fab-body">
        {phase === 'idle' && <Wave level={idleLevel} className="bar" slow />}
        {(phase === 'sending' || phase === 'done') && (
          <>
            {hasFailed && <Wave level={failLevel} className="fail" slow={false} />}
            <Wave level={sent} className="bar" slow={paused} />
          </>
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={icon} className="fab-icon" initial={{ y: 60, rotate: -20 }} animate={{ y: 0, rotate: 0 }} exit={{ y: -60, rotate: 20, opacity: 0 }} transition={bouncy}>
            {icon === 'plus' && <Plus size={56} weight="bold" />}
            {icon === 'send' && <ArrowUp size={34} weight="bold" />}
            {icon === 'pause' && <Pause size={28} weight="fill" />}
            {icon === 'play' && <Play size={28} weight="fill" />}
            {icon === 'retry' && <ArrowClockwise size={30} weight="bold" />}
            {icon === 'check' && (
              <svg viewBox="0 0 24 24" width={40} height={40} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <motion.path d="M5 12.5 L10 17.5 L19 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, ease: 'easeOut', delay: 0.25 }} />
              </svg>
            )}
          </motion.span>
        </AnimatePresence>
      </motion.div>
    </motion.button>
  )
}
