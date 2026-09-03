import React, { useEffect, useRef, useState, type CSSProperties } from 'react'
import { C, KEYFRAMES, FONT_UI } from './theme'

/**
 * Codejam mascot — flat style. Self-contained: no dependencies, no CSS files.
 *
 * <CodejamJarFlat mood="happy" size={160} />
 *
 * props
 *   mood      "happy" | "wink" | "thinking" | "sleepy"   default "happy"
 *   size      rendered height in px (design is 184x214)  default 214
 *   animate   idle bounce + blink + slosh                default true
 *   gaze      pupils follow the cursor                   default true
 *   labelText text on the nose label                     default "</>"
 *   hopSignal bump this number to trigger a hop externally, without a click
 *   onClick   called after the hop starts
 */

const W = 184
const H = 214

export type Mood = 'happy' | 'wink' | 'thinking' | 'sleepy'

export interface CodejamJarFlatProps {
  mood?: Mood
  size?: number
  animate?: boolean
  gaze?: boolean
  labelText?: string
  hopSignal?: number
  onClick?: React.MouseEventHandler<HTMLDivElement>
  style?: CSSProperties
  [key: string]: unknown
}

let styleInjected = false
function useKeyframes() {
  useEffect(() => {
    if (styleInjected || typeof document === 'undefined') return
    const el = document.createElement('style')
    el.setAttribute('data-codejam-mascot', '')
    el.textContent = KEYFRAMES
    document.head.appendChild(el)
    styleInjected = true
  }, [])
}

const abs = (o: CSSProperties): CSSProperties => ({ position: 'absolute', ...o })
const circle = (o: CSSProperties): CSSProperties => abs({ borderRadius: '50%', ...o })

interface Seed {
  left?: number
  right?: number
  top: number
  width: number
  height: number
}

const seeds: Seed[] = [
  { left: 16, top: 56, width: 7, height: 9 },
  { left: 38, top: 118, width: 6, height: 8 },
  { right: 18, top: 74, width: 7, height: 9 },
  { right: 42, top: 126, width: 6, height: 8 },
  { left: 70, top: 132, width: 6, height: 8 },
]

function Eye({ gaze }: { side: 'left' | 'right'; gaze: string }) {
  const pupil: CSSProperties = { transition: 'transform 110ms ease-out', transform: gaze }
  return (
    <>
      <div style={circle({ left: 9, top: 10, width: 28, height: 28, background: C.pupil, ...pupil })} />
      <div style={circle({ left: 16, top: 14, width: 9, height: 9, background: C.white, ...pupil })} />
    </>
  )
}

function ClosedLid({ side }: { side: 'left' | 'right' }) {
  return (
    <div
      style={abs({
        [side]: 14,
        top: 56,
        width: 46,
        height: 12,
        borderTop: `7px solid ${C.white}`,
        borderLeft: '7px solid transparent',
        borderRight: '7px solid transparent',
        borderRadius: '22px 22px 0 0',
        boxSizing: 'border-box',
      })}
    />
  )
}

export default function CodejamJarFlat({
  mood = 'happy',
  size = H,
  animate = true,
  gaze = true,
  labelText = '</>',
  hopSignal,
  onClick,
  style,
  ...rest
}: CodejamJarFlatProps) {
  useKeyframes()
  const rootRef = useRef<HTMLDivElement>(null)
  const [hopping, setHopping] = useState(false)
  const [look, setLook] = useState({ x: 0, y: 0 })
  const prevHopSignal = useRef(hopSignal)

  useEffect(() => {
    if (!gaze) return
    const onMove = (e: MouseEvent) => {
      const el = rootRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const clamp = (v: number) => Math.max(-1, Math.min(1, v))
      const x = Math.round(clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 1.2)) * 6)
      const y = Math.round(clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 1.2)) * 5)
      setLook((p) => (p.x === x && p.y === y ? p : { x, y }))
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [gaze])

  useEffect(() => {
    if (!hopping) return
    const t = setTimeout(() => setHopping(false), 760)
    return () => clearTimeout(t)
  }, [hopping])

  // lets a parent trigger the hop animation (e.g. on a successful room join)
  // without simulating a click on the mascot itself
  useEffect(() => {
    if (hopSignal === undefined || hopSignal === prevHopSignal.current) return
    prevHopSignal.current = hopSignal
    setHopping(true)
  }, [hopSignal])

  const scale = size / H
  const gazeT = `translate(${look.x}px,${look.y}px)`
  const eyesOpen = mood === 'happy' || mood === 'thinking'
  const blink = animate ? 'cjf-blink 5.4s ease-in-out infinite' : 'none'

  return (
    <div
      ref={rootRef}
      onClick={(e) => {
        if (!hopping) setHopping(true)
        if (onClick) onClick(e)
      }}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: Math.round(W * scale),
        height: Math.round(H * scale),
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: FONT_UI,
        lineHeight: 1,
        userSelect: 'none',
        ...style,
      }}
      {...rest}
    >
      <div style={abs({ left: 0, top: 0, width: W, height: H, transformOrigin: '0 0', transform: `scale(${scale})` })}>
        <div
          style={abs({
            inset: 0,
            transformOrigin: '50% 100%',
            animation: animate ? 'cjf-idle 2.6s ease-in-out infinite' : 'none',
          })}
        >
          <div
            style={abs({
              inset: 0,
              transformOrigin: '50% 100%',
              animation: hopping ? 'cjf-hop 740ms cubic-bezier(.3,1.4,.5,1)' : 'none',
            })}
          >
            <div style={circle({ left: '50%', bottom: 0, width: 112, height: 12, marginLeft: -56, background: 'rgba(30,22,26,.13)' })} />

            <div style={abs({ left: '50%', top: 12, width: 120, height: 30, marginLeft: -60, borderRadius: 10, background: C.lid })} />
            <div style={abs({ left: '50%', top: 12, width: 120, height: 20, marginLeft: -60, borderRadius: '10px 10px 4px 4px', background: C.lidMid })} />
            <div style={abs({ left: '50%', top: 4, width: 96, height: 16, marginLeft: -48, borderRadius: 8, background: C.lidTop })} />
            <div style={abs({ left: '50%', top: 40, width: 104, height: 14, marginLeft: -52, background: C.glassNeck })} />

            <div
              style={abs({
                left: '50%',
                top: 50,
                width: 152,
                height: 158,
                marginLeft: -76,
                borderRadius: '30px 30px 34px 34px',
                overflow: 'hidden',
                background: C.glass,
              })}
            >
              <div style={abs({ left: 0, right: 0, bottom: 0, height: 118, background: C.jam })} />
              <div style={abs({ left: 0, right: 0, bottom: 0, height: 22, background: C.jamDeep })} />

              <div
                style={abs({
                  left: -14,
                  right: -14,
                  bottom: 110,
                  height: 22,
                  animation: animate ? 'cjf-slosh 4.4s ease-in-out infinite' : 'none',
                })}
              >
                <div style={circle({ left: 0, top: 6, width: 64, height: 22, background: C.jam })} />
                <div style={circle({ left: 40, top: 0, width: 70, height: 24, background: C.jam })} />
                <div style={circle({ right: 0, top: 5, width: 86, height: 22, background: C.jam })} />
                <div style={abs({ left: 0, right: 0, bottom: 0, height: 12, background: C.jam })} />
              </div>

              {seeds.map((s, i) => (
                <div key={i} style={circle({ ...s, background: C.seed })} />
              ))}

              <div style={abs({ left: 14, top: 10, width: 14, height: 26, borderRadius: 8, background: C.white, opacity: 0.8 })} />

              {eyesOpen && (
                <>
                  <div style={circle({ left: 14, top: 40, width: 46, height: 46, background: C.white, overflow: 'hidden', transformOrigin: '50% 50%', animation: blink })}>
                    <Eye side="left" gaze={gazeT} />
                  </div>
                  <div style={circle({ right: 14, top: 40, width: 46, height: 46, background: C.white, overflow: 'hidden', transformOrigin: '50% 50%', animation: blink })}>
                    <Eye side="right" gaze={gazeT} />
                  </div>
                </>
              )}
              {mood === 'sleepy' && (
                <>
                  <ClosedLid side="left" />
                  <ClosedLid side="right" />
                </>
              )}
              {mood === 'wink' && (
                <>
                  <div style={circle({ left: 14, top: 40, width: 46, height: 46, background: C.white, overflow: 'hidden' })}>
                    <Eye side="left" gaze={gazeT} />
                  </div>
                  <ClosedLid side="right" />
                </>
              )}

              <div
                style={abs({
                  left: '50%',
                  top: 86,
                  marginLeft: -24,
                  width: 48,
                  height: 28,
                  borderRadius: 8,
                  background: C.paper,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 700, color: C.ink, letterSpacing: -1 }}>
                  {labelText}
                </span>
              </div>

              {(mood === 'happy' || mood === 'wink') && (
                <div
                  style={abs({
                    left: '50%',
                    top: 118,
                    marginLeft: -23,
                    width: 46,
                    height: 24,
                    borderRadius: '6px 6px 24px 24px',
                    background: C.mouth,
                    overflow: 'hidden',
                  })}
                >
                  <div style={circle({ left: '50%', bottom: -8, marginLeft: -13, width: 26, height: 16, background: C.tongue })} />
                </div>
              )}
              {mood === 'thinking' && (
                <div style={circle({ left: '50%', top: 120, marginLeft: -11, width: 22, height: 22, background: C.mouth })} />
              )}
              {mood === 'sleepy' && (
                <div style={abs({ left: '50%', top: 126, marginLeft: -14, width: 28, height: 7, borderRadius: 4, background: C.mouth })} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
