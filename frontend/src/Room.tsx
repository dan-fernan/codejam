import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import { MonacoBinding } from 'y-monaco'
import Editor, { type OnMount } from '@monaco-editor/react'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { WebsocketProvider } from 'y-websocket'
import CodejamJarFlat, { type Mood } from './CodejamJarFlat'
import { C, FONT_UI, FONT_MONO, flavorForClientId } from './theme'
import { useNavigate } from 'react-router-dom'

const LANGUAGES = ['python', 'javascript']
const FILE_EXT: Record<string, string> = { python: 'py', javascript: 'js' }
const IDLE_MS = 6000
const WINK_MS = 1500
// stable object identity: a new literal on every render makes Monaco re-apply options
const EDITOR_OPTIONS = { padding: { top: 16 } }

// same-origin: Vite's proxy locally, nginx in production (both strip /ws before forwarding to Node)
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

type MonacoEditor = Parameters<OnMount>[0]

// One row in the "In this room" panel, derived from awareness
interface Participant {
  clientId: number
  name: string
  color: string
  line: number | null // the line their cursor is on; null until their editor reports a cursor
  isYou: boolean
}

// Console header: what the last run did. Spring's ExecutionResult already returns exitCode + timedOut.
type ExitStatus = 'idle' | 'running' | 'failed' | { code: number; timedOut: boolean }

function Room() {
  const { roomId } = useParams()
  const [language, setLanguage] = useState('python')
  const [output, setOutput] = useState({ stdout: '', stderr: '' })
  const [running, setRunning] = useState(false)
  const [ready, setReady] = useState(false)
  const [mood, setMood] = useState<Mood>('sleepy')
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hopSignal, setHopSignal] = useState(0)
  const [exitStatus, setExitStatus] = useState<ExitStatus>('idle')
  const [participants, setParticipants] = useState<Participant[]>([])
  const navigate = useNavigate()

  const docRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const bindingRef = useRef<MonacoBinding | null>(null)
  const awarenessRef = useRef<Awareness | null>(null)
  const editorRef = useRef<MonacoEditor | null>(null)
  const cursorStyleRef = useRef<HTMLStyleElement | null>(null)
  // lets handleEditorMount recompute participants (line numbers need the editor's model)
  const refreshParticipantsRef = useRef<() => void>(() => {})
  // true while a run is in flight or its "wink" result is still showing - keeps
  // typing activity from stomping on that mood until it's done
  const moodLockRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(roomId!)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked (permission denied, or not a secure context): nothing to show
    }
  }

  const homeClickHandler = () => {
    navigate('/')
  }

  function markActive() {
    if (moodLockRef.current) return
    setMood('happy')
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => setMood('sleepy'), IDLE_MS)
  }

  useEffect(() => {
    let cancelled = false
    const labelTimers = new Map<number, ReturnType<typeof setTimeout>>()

    async function connect() {
      // Records this room in recent rooms (covers Home, recents, and direct links) and confirms it exists.
      // Content no longer comes from REST: the provider's handshake with Node delivers it.
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId!)}/join`, { method: 'POST' })
      if (cancelled) return
      if (!res.ok) { setNotFound(true); return } // unknown room: never open a socket

      const doc = new Y.Doc()
      docRef.current = doc
      // Connects to /ws/<roomId>; runs the sync handshake, reconnects with backoff, and relays awareness
      const provider = new WebsocketProvider(WS_URL, roomId!, doc)
      providerRef.current = provider

      const awareness = provider.awareness // created and wired to the socket by the provider
      awareness.setLocalStateField('user', {
        name: `Guest-${Math.floor(Math.random() * 1000)}`,
        color: flavorForClientId(doc.clientID),
      })
      awarenessRef.current = awareness

      const cursorStyleEl = document.createElement('style')
      document.head.appendChild(cursorStyleEl)
      cursorStyleRef.current = cursorStyleEl

      // y-monaco only applies classNames for remote cursors/selections (yRemoteSelection-<clientId>,
      // yRemoteSelectionHead-<clientId>) - it ships no CSS itself, so we generate it per client here,
      // reusing the same { name, color } we already put in awareness's local state field
      const activeLabels = new Set<number>()
      function updateCursorStyles() {
        const rules: string[] = []
        awareness.getStates().forEach((state, clientID) => {
          if (clientID === doc.clientID) return
          const user = state.user as { name?: string; color?: string } | undefined
          if (!user?.color) return
          // thin colored line always visible - the name flag only shows briefly after a move
          rules.push(`
            .yRemoteSelection-${clientID} { background-color: ${user.color}66; }
            .yRemoteSelectionHead-${clientID} { position: relative; border-left: 2px solid ${user.color}; }
          `)
          if (activeLabels.has(clientID)) {
            rules.push(`
              .yRemoteSelectionHead-${clientID}::after {
                content: '${user.name ?? ''}';
                position: absolute;
                top: -1.4em;
                left: -2px;
                font-family: ${FONT_UI};
                font-weight: 700;
                font-size: 11px;
                padding: 2px 6px;
                white-space: nowrap;
                color: ${C.white};
                background-color: ${user.color};
                border-radius: 5px;
                pointer-events: none;
              }
            `)
          }
        })
        cursorStyleEl.textContent = rules.join('\n')
      }

      // "In this room": everyone in awareness, with the line their cursor is on.
      // y-monaco stores each cursor as a Yjs relative position (state.selection.head); converting it
      // to a line is the same step y-monaco does to draw remote cursors: relative → absolute index →
      // Monaco line.
      function refreshParticipants() {
        if (cancelled) return
        const model = editorRef.current?.getModel() ?? null
        const list: Participant[] = []
        awareness.getStates().forEach((state, clientID) => {
          const user = state.user as { name?: string; color?: string } | undefined
          if (!user) return // e.g. a client mid-leave
          let line: number | null = null
          const head = (state.selection as { head?: unknown } | undefined)?.head
          if (model && head) {
            try {
              const abs = Y.createAbsolutePositionFromRelativePosition(head as Y.RelativePosition, doc)
              if (abs) line = model.getPositionAt(abs.index).lineNumber
            } catch {
              // position refers to content we haven't received yet - leave the line blank
            }
          }
          list.push({
            clientId: clientID,
            name: user.name ?? 'Guest',
            color: user.color ?? C.lidTop,
            line,
            isYou: clientID === doc.clientID,
          })
        })
        list.sort((a, b) => Number(b.isYou) - Number(a.isYou)) // you first
        // runs on every keystroke: only re-render when someone joined, left, or changed line
        setParticipants((prev) =>
          prev.length === list.length && prev.every((p, i) =>
            p.clientId === list[i].clientId && p.line === list[i].line &&
            p.name === list[i].name && p.color === list[i].color)
            ? prev
            : list)
      }
      refreshParticipantsRef.current = refreshParticipants

      // 'change' (not 'update') is deep-equality filtered by y-protocols, so a heartbeat
      // resend of unchanged state never reaches here and never re-triggers the label
      awareness.on('change', ({ added, updated }: { added: number[]; updated: number[]; removed: number[] }) => {
        added.concat(updated).forEach((clientID) => {
          if (clientID === doc.clientID) return
          activeLabels.add(clientID)
          clearTimeout(labelTimers.get(clientID))
          labelTimers.set(clientID, setTimeout(() => {
            activeLabels.delete(clientID)
            updateCursorStyles()
          }, 2000))
        })
        updateCursorStyles()
        refreshParticipants() // joins, leaves, and cursor moves
      })
      refreshParticipants()

      const ymap = doc.getMap('metadata')
      setLanguage((ymap.get('language') as string) || 'python')
      ymap.observe(() => setLanguage((ymap.get('language') as string) || 'python'))

      doc.on('update', () => {
        // both local edits and remote peers typing count as "someone's active"
        // (sending local edits is now the provider's job)
        markActive()
        // an insert above someone's cursor moves their line without changing their awareness
        refreshParticipants()
      })

      // Node closed with 4404: room was deleted between /join and connecting.
      // y-websocket already stops reconnecting on 44xx codes; we just show the error.
      provider.on('closed', ({ code }: { code: number; reason: string }) => {
        if (code === 4404) setNotFound(true)
      })

      // Show the editor once the handshake has delivered the room's content,
      // so Monaco never binds to an empty doc and then jumps
      provider.once('sync', (isSynced: boolean) => {
        if (isSynced && !cancelled) setReady(true)
      })
    }
    connect()

    return () => {
      cancelled = true
      clearTimeout(idleTimerRef.current)
      labelTimers.forEach(clearTimeout)
      labelTimers.clear()
      cursorStyleRef.current?.remove()
      bindingRef.current?.destroy()
      awarenessRef.current?.setLocalState(null) // tell peers we left while the socket is still open
      providerRef.current?.destroy()            // closes the socket and stops reconnecting
      docRef.current?.destroy()
      // reset so a Strict Mode remount never sees the destroyed objects
      bindingRef.current = null
      providerRef.current = null
      awarenessRef.current = null
      docRef.current = null
      editorRef.current = null
      refreshParticipantsRef.current = () => {}
      setReady(false)
      setParticipants([])
    }
  }, [roomId])

  const handleEditorMount: OnMount = (editor) => {
    if (!docRef.current || !awarenessRef.current) return
    editorRef.current = editor
    const ytext = docRef.current.getText('code')
    bindingRef.current = new MonacoBinding(ytext, editor.getModel()!, new Set([editor]), awarenessRef.current)
    refreshParticipantsRef.current() // line numbers can be computed now that the model exists
  }

  async function handleRun() {
    setRunning(true)
    setExitStatus('running')
    moodLockRef.current = true
    clearTimeout(idleTimerRef.current)
    setMood('thinking')
    setOutput({ stdout: '', stderr: '' })
    try {
      const code = docRef.current?.getText('code').toString() ?? ''
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify({ code, language }),
      })

      const result = await res.json()
      setOutput({ stdout: result.stdout ?? '', stderr: result.stderr ?? '' })
      setExitStatus({ code: result.exitCode ?? -1, timedOut: !!result.timedOut })
      if (result.stderr) {
        moodLockRef.current = false
        markActive()
      } else {
        setMood('wink') // clean run, no stderr
        setHopSignal((s) => s + 1) // celebratory hop
        setTimeout(() => {
          moodLockRef.current = false
          markActive()
        }, WINK_MS)
      }
    } catch (err) {
      setOutput({ stdout: '', stderr: 'Request failed: ' + err })
      setExitStatus('failed')
      moodLockRef.current = false
      markActive()
    } finally {
      setRunning(false)
    }
  }

  function handleLanguageChange(newLanguage: string) {
    docRef.current?.getMap('metadata').set('language', newLanguage)
  }

  // --- derived display values ---

  const othersPresent = participants.some((p) => !p.isYou)
  const [statusText, statusDot] = {
    sleepy: ['idle', C.lidTop],
    happy: [othersPresent ? 'editing together' : 'editing', C.ok],
    thinking: ['running', C.busy],
    wink: ['clean run', C.ok],
  }[mood]

  const exitLabel =
    exitStatus === 'idle' ? 'no runs yet'
    : exitStatus === 'running' ? 'running'
    : exitStatus === 'failed' ? 'request failed'
    : exitStatus.timedOut ? 'timed out'
    : `exit ${exitStatus.code}`
  const exitColor =
    typeof exitStatus === 'object' && !exitStatus.timedOut && exitStatus.code === 0 ? C.okDeep
    : typeof exitStatus === 'object' || exitStatus === 'failed' ? C.mouth
    : C.lidTop

  const stdoutText = exitStatus === 'idle' && !output.stdout
    ? 'Ready. Hit run when you want to see it go.'
    : output.stdout

  // --- styles shared by several elements ---

  const monoLabel: CSSProperties = {
    fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
  }
  const cardHeader: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '12px 16px', fontSize: 13, fontWeight: 800, letterSpacing: 0.3,
  }

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <CodejamJarFlat mood="thinking" size={88} gaze={false} />
        <p style={{ margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 18, color: C.ink }}>Room not found</p>
        <button
          onClick={homeClickHandler}
          style={{
            fontFamily: FONT_MONO, fontSize: 13, color: C.white, background: C.jam,
            border: 'none', borderRadius: 999, padding: '6px 14px', cursor: 'pointer',
          }}
        >
          Home
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: C.glass }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14,
          padding: '10px clamp(12px, 2vw, 20px)', background: C.lid,
        }}
      >
        {/* left: mascot tile, wordmark (links home), live status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
              width: 52, height: 52, background: C.ink, borderRadius: 16, overflow: 'hidden',
            }}
          >
            <CodejamJarFlat mood={mood} size={46} gaze={false} hopSignal={hopSignal} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <button
              onClick={homeClickHandler}
              title="Back to home"
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                fontFamily: FONT_UI, fontSize: 17, fontWeight: 800, letterSpacing: -0.4, color: C.white,
              }}
            >
              Code<span style={{ color: C.jam }}>Jam</span>
            </button>
            <span
              style={{
                ...monoLabel, display: 'flex', alignItems: 'center', gap: 6,
                letterSpacing: 0.8, textTransform: 'uppercase', color: C.lidMuted,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot }} />
              {statusText}
            </span>
          </div>
        </div>

        {/* right: room id + copy, language toggle, run */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
              background: C.ink, borderRadius: 999, padding: '5px 6px 5px 14px',
            }}
          >
            <span
              style={{
                fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: C.white,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {roomId}
            </span>
            <button
              onClick={copyRoomId}
              title="Copy room ID"
              style={{
                flex: '0 0 auto', border: 'none', borderRadius: 999, background: C.lidMid, color: C.white,
                fontFamily: FONT_UI, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase',
                padding: '6px 12px', cursor: 'pointer',
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.ink, borderRadius: 999, padding: 4 }}>
            {LANGUAGES.map((lang) => {
              const active = lang === language
              return (
                <button
                  key={lang}
                  onClick={() => handleLanguageChange(lang)}
                  aria-pressed={active}
                  style={{
                    border: 'none', borderRadius: 999, padding: '7px 14px', cursor: 'pointer',
                    fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                    background: active ? C.paper : 'transparent', color: active ? C.ink : C.lidMuted,
                  }}
                >
                  {lang}
                </button>
              )
            })}
          </div>

          <button
            onClick={handleRun}
            disabled={running}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, border: 'none', borderRadius: 14,
              background: C.jam, color: C.white, fontFamily: FONT_UI, fontSize: 14, fontWeight: 800,
              letterSpacing: 1, textTransform: 'uppercase', padding: '12px 22px',
              cursor: running ? 'default' : 'pointer', boxShadow: `0 4px 0 ${C.jamDeep}`,
            }}
          >
            {running ? 'Running' : 'Run'}
          </button>
        </div>
      </header>

      <main
        style={{
          flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'stretch',
          gap: 'clamp(12px, 1.4vw, 18px)', padding: 'clamp(12px, 1.6vw, 20px)',
        }}
      >
        {/* editor card */}
        <section
          style={{
            flex: '2.2 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column',
            background: C.white, border: `2px solid ${C.border}`, borderRadius: 20, overflow: 'hidden',
          }}
        >
          <div style={{ ...cardHeader, borderBottom: `2px solid ${C.divider}`, color: C.ink }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: C.jam }} />
              solution.{FILE_EXT[language] ?? 'txt'}
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 340 }}>
            {ready ? (
              <Editor options={EDITOR_OPTIONS} height="460px" language={language} onMount={handleEditorMount} />
            ) : (
              // until the first sync; if Node is down the provider keeps retrying in the background
              <p style={{ margin: 0, padding: 16, fontFamily: FONT_UI, fontSize: 13, color: C.lidTop }}>Connecting…</p>
            )}
          </div>
        </section>

        {/* right column: console + room panel */}
        <section style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', minHeight: 240,
              background: C.paper, border: `2px solid ${C.paperBorder}`, borderRadius: 20, overflow: 'hidden',
            }}
          >
            <div style={{ ...cardHeader, borderBottom: `2px solid ${C.paperBorder}`, color: C.ink }}>
              <span>Console</span>
              <span style={{ ...monoLabel, color: exitColor }}>{exitLabel}</span>
            </div>
            <div style={{ flex: 1, padding: '14px 16px', overflow: 'auto' }}>
              <pre style={{ margin: 0, fontFamily: FONT_MONO, fontSize: 13, lineHeight: '20px', color: C.ink, whiteSpace: 'pre-wrap' }}>
                {stdoutText}
              </pre>
              {output.stderr && (
                <pre style={{ margin: '10px 0 0', fontFamily: FONT_MONO, fontSize: 13, lineHeight: '20px', color: C.mouth, whiteSpace: 'pre-wrap' }}>
                  {output.stderr}
                </pre>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'flex', flexDirection: 'column', gap: 10,
              background: C.white, border: `2px solid ${C.border}`, borderRadius: 20, padding: '14px 16px',
            }}
          >
            <span style={{ ...monoLabel, letterSpacing: 1.2, textTransform: 'uppercase', color: C.lidTop }}>
              In this room
            </span>
            {participants.map((p) => (
              <div key={p.clientId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{p.isYou ? 'You' : p.name}</span>
                {p.line !== null && (
                  <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 12, color: C.lidTop }}>
                    line {p.line}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default Room
