import { useState, useEffect, useRef } from 'react'
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
const IDLE_MS = 6000
const WINK_MS = 1500
// stable object identity: a new literal on every render makes Monaco re-apply options
const EDITOR_OPTIONS = { padding: { top: 16 } }

// same-origin: Vite's proxy locally, nginx in production (both strip /ws before forwarding to Node)
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

function Room() {
  const { roomId } = useParams()
  const [language, setLanguage] = useState('python')
  const [output, setOutput] = useState({ stdout: '', stderr: '' })
  const [running, setRunning] = useState(false)
  const [ready, setReady] = useState(false)
  const [mood, setMood] = useState<Mood>('sleepy')
  const [notFound, setNotFound] = useState(false)
  const navigate = useNavigate()

  const docRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const bindingRef = useRef<MonacoBinding | null>(null)
  const awarenessRef = useRef<Awareness | null>(null)
  const cursorStyleRef = useRef<HTMLStyleElement | null>(null)
  // true while a run is in flight or its "wink" result is still showing - keeps
  // typing activity from stomping on that mood until it's done
  const moodLockRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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
      })

      const ymap = doc.getMap('metadata')
      setLanguage((ymap.get('language') as string) || 'python')
      ymap.observe(() => setLanguage((ymap.get('language') as string) || 'python'))

      // both local edits and remote peers typing count as "someone's active"
      // (sending local edits is now the provider's job)
      doc.on('update', () => markActive())

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
      setReady(false)
    }
  }, [roomId])

  const handleEditorMount: OnMount = (editor) => {
    if (!docRef.current || !awarenessRef.current) return
    const ytext = docRef.current.getText('code')
    bindingRef.current = new MonacoBinding(ytext, editor.getModel()!, new Set([editor]), awarenessRef.current)
  }

  async function handleRun() {
    setRunning(true)
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
      if (result.stderr) {
        moodLockRef.current = false
        markActive()
      } else {
        setMood('wink') // clean run, no stderr
        setTimeout(() => {
          moodLockRef.current = false
          markActive()
        }, WINK_MS)
      }
    } catch (err) {
      setOutput({ stdout: '', stderr: 'Request failed: ' + err })
      moodLockRef.current = false
      markActive()
    } finally {
      setRunning(false)
    }
  }

  function handleLanguageChange(newLanguage: string) {
    docRef.current?.getMap('metadata').set('language', newLanguage)
  }

  const pillStyle = {
    fontFamily: FONT_MONO,
    fontSize: 13,
    color: C.ink,
    background: C.paper,
    border: 'none',
    borderRadius: 999,
    padding: '6px 14px',
  }

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <CodejamJarFlat mood="thinking" size={88} gaze={false} />
        <p style={{ margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 18, color: C.ink }}>Room not found</p>
        <button onClick={homeClickHandler} style={{ ...pillStyle, color: C.white, background: C.jam, cursor: 'pointer' }}>
          Home
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: C.lid,
          color: C.white,
          padding: '8px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CodejamJarFlat mood={mood} size={44} gaze={false} />
          <span style={{ fontFamily: FONT_UI, fontWeight: 800, fontSize: 18 }}>
            Code<span style={{ color: C.jam }}>Jam</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={homeClickHandler}
            style = {{
              ...pillStyle,
              color: C.white,
              background: C.jam }}
          >
            Home
          </button>
          <span style={pillStyle}>{roomId}</span>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              style={{
                ...pillStyle,
                fontFamily: FONT_UI,
                fontWeight: 700,
                appearance: 'none',
                cursor: 'pointer',
                paddingRight: 28,
              }}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <svg
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            >
              <path d="M1 1L5 5L9 1" stroke={C.ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
        <div
          style={{
            background: C.white,
            borderRadius: 12,
            padding: 8,
            border: `1px solid ${C.glassNeck}`,
          }}
        >
          {ready ? (
            <Editor options={EDITOR_OPTIONS} height="420px" language={language} onMount={handleEditorMount} />
          ) : (
            // until the first sync; if Node is down the provider keeps retrying in the background
            <p style={{ margin: 0, padding: 16, fontFamily: FONT_UI, fontSize: 13, color: C.ink }}>Connecting…</p>
          )}
        </div>

        <div
          style={{
            background: C.paper,
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 13, color: C.ink }}>Console</span>
            <button
              onClick={handleRun}
              disabled={running}
              style={{
                fontFamily: FONT_UI,
                fontWeight: 700,
                fontSize: 14,
                color: C.white,
                background: C.jam,
                border: 'none',
                borderRadius: 999,
                padding: '8px 20px',
                cursor: running ? 'default' : 'pointer',
              }}
            >
              {running ? 'Running...' : 'Run'}
            </button>
          </div>
          <pre style={{ margin: 0, fontFamily: FONT_MONO, fontSize: 13, color: C.ink, whiteSpace: 'pre-wrap' }}>
            {output.stdout}
          </pre>
          {output.stderr && (
            <pre style={{ margin: 0, fontFamily: FONT_MONO, fontSize: 13, color: C.mouth, whiteSpace: 'pre-wrap' }}>
              {output.stderr}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

export default Room
