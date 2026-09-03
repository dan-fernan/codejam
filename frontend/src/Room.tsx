import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { MonacoBinding } from 'y-monaco'
import Editor, { type OnMount } from '@monaco-editor/react'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import CodejamJarFlat, { type Mood } from './CodejamJarFlat'
import { C, FONT_UI, FONT_MONO, flavorForClientId } from './theme'

const LANGUAGES = ['python', 'javascript']
const DOC_UPDATE = 0
const AWARENESS_UPDATE = 1
const IDLE_MS = 6000
const WINK_MS = 1500

// necessary as response from 'GET' returns a JSON array of base64 strings, as Jackson has to text-encode the raw bytes[]
// to get them to fit into JSON
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) // decode base64 string back to bytes, store in a Uint8Array (js equivalent of Java's byte[])
}
// Uint8Array type is necessary as input for yjs operations

function Room() {
  const { roomId } = useParams()
  const [language, setLanguage] = useState('python')
  const [output, setOutput] = useState({ stdout: '', stderr: '' })
  const [running, setRunning] = useState(false)
  const [ready, setReady] = useState(false)
  const [mood, setMood] = useState<Mood>('sleepy')

  const docRef = useRef<Y.Doc | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const bindingRef = useRef<MonacoBinding | null>(null)
  const awarenessRef = useRef<Awareness | null>(null)
  const cursorStyleRef = useRef<HTMLStyleElement | null>(null)
  // true while a run is in flight or its "wink" result is still showing - keeps
  // typing activity from stomping on that mood until it's done
  const moodLockRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  function markActive() {
    if (moodLockRef.current) return
    setMood('happy')
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => setMood('sleepy'), IDLE_MS)
  }

  useEffect(() => {
    let cancelled = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const labelTimers = new Map<number, ReturnType<typeof setTimeout>>()

    async function connect() {
      const res = await fetch(`http://localhost:8080/rooms/${roomId}`)
      if (!res.ok) return
      const b64Updates: string[] = await res.json()
      const doc = new Y.Doc()
      if (b64Updates.length > 0) {
        const merged = Y.mergeUpdates(b64Updates.map(base64ToBytes))
        Y.applyUpdate(doc, merged)
      }
      if (cancelled) { doc.destroy(); return}
      docRef.current = doc

      const awareness = new Awareness(doc)
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

      const ws = new WebSocket(`ws://localhost:8080/ws/rooms/${roomId}`)
      ws.binaryType = 'arraybuffer'
      // allows incoming messages to be represented as an arraybuffer rather than an opaque blob.
      // otherwise, would need to process the blob into something that can be applied as a yjs update directly
      wsRef.current = ws

      function sendFramed(tag: number, payload: Uint8Array) {
        if (ws.readyState !== WebSocket.OPEN) return
        const framed = new Uint8Array(1 + payload.length)
        framed[0] = tag
        framed.set(payload, 1)
        ws.send(framed)
      }

      ws.onmessage = (event) => {
        const bytes = new Uint8Array(event.data)
        const tag = bytes[0]
        const payload = bytes.subarray(1)
        if (tag === DOC_UPDATE) {
          Y.applyUpdate(doc, payload, 'remote')
        } else {
          applyAwarenessUpdate(awareness, payload, 'remote')
        }
      }

      doc.on('update', (update, origin) => {
        markActive() // both local edits and remote peers typing count as "someone's active"
        if (origin == 'remote') return
        sendFramed(DOC_UPDATE, update)
      })

      awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin === 'remote') return
        const changed = added.concat(updated, removed)
        sendFramed(AWARENESS_UPDATE, encodeAwarenessUpdate(awareness, changed))
      })

      // resend full local state periodically so late joiners (who missed the
      // original change events) still pick up everyone's current cursor
      heartbeat = setInterval(() => {
        sendFramed(AWARENESS_UPDATE, encodeAwarenessUpdate(awareness, [doc.clientID]))
      }, 10000)

      setReady(true)
    }
    connect()

    return () => {
      cancelled = true
      if (heartbeat) clearInterval(heartbeat)
      clearTimeout(idleTimerRef.current)
      labelTimers.forEach(clearTimeout)
      labelTimers.clear()
      cursorStyleRef.current?.remove()
      awarenessRef.current?.destroy() // broadcasts a final "removed" state while the socket is still open
      wsRef.current?.close()
      bindingRef.current?.destroy()
      docRef.current?.destroy()
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
      const res = await fetch('http://localhost:8080/execute', {
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
          {ready && (
            <Editor options={{ padding: { top: 16 }}}height="420px" language={language} onMount={handleEditorMount} />
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
