import { useState, useEffect, useRef } from 'react'  
import { useParams } from 'react-router-dom'
import { MonacoBinding } from 'y-monaco'
import Editor, { type OnMount } from '@monaco-editor/react'
import * as Y from 'yjs'

const LANGUAGES = ['python', 'javascript']

// necessary as response from 'GET' returns a JSON array of base64 strings, as Jackson has to text-encode the raw bytes[]
// to get them to fit into JSON
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) // decode base64 string back to bytes, store in a Uint8Array (js equivalent of Java's byte[])
}
// Uint8Array type is necessary as input for yjs operations



function Room() {
  const { roomId } = useParams()
  const [language, setLanguage] = useState('python')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [ready, setReady] = useState(false)

  const docRef = useRef<Y.Doc | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const bindingRef = useRef<MonacoBinding | null>(null)

  useEffect(() => {
    let cancelled = false

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

      const ymap = doc.getMap('metadata')
      setLanguage((ymap.get('language') as string) || 'python')
      ymap.observe(() => setLanguage((ymap.get('language') as string) || 'python'))

      const ws = new WebSocket(`ws://localhost:8080/ws/rooms/${roomId}`)
      ws.binaryType = 'arraybuffer' 
      // allows incoming messages to be represented as an arraybuffer rather than an opaque blob.
      // otherwise, would need to process the blob into something that can be applied as a yjs update directly
      wsRef.current = ws

      ws.onmessage = (event) => {
        Y.applyUpdate(doc, new Uint8Array(event.data), 'remote')
      }

      doc.on('update', (update, origin) => {
        if (origin == 'remote') return
        if (ws.readyState === WebSocket.OPEN) ws.send(update as Uint8Array<ArrayBuffer>)
      })

      setReady(true)
    }
    connect()
    
    return () => {
      cancelled = true
      wsRef.current?.close()
      bindingRef.current?.destroy()
      docRef.current?.destroy()
      setReady(false)
    }
  }, [roomId])

  const handleEditorMount: OnMount = (editor) => {
    if (!docRef.current) return
    const ytext = docRef.current.getText('code')
    bindingRef.current = new MonacoBinding(ytext, editor.getModel()!, new Set([editor]))
  }

  async function handleRun() {
    setRunning(true)
    setOutput('')
    try {
      const code = docRef.current?.getText('code').toString() ?? ''
      const res = await fetch('http://localhost:8080/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify({ code, language }),
      })

      const result = await res.json()
      setOutput(result.stdout + (result.stderr ? '\n' + result.stderr : ''))
    } catch (err) {
      setOutput('Request failed' + err)
    } finally {
      setRunning(false)
    }
  }

  function handleLanguageChange(newLanguage: string) {
    docRef.current?.getMap('metadata').set('language', newLanguage)
  }

  return (
    <>
      <select value={language} onChange={(e) => handleLanguageChange(e.target.value)}>
        {LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>{lang}</option>
        ))}
      </select>
      {ready && (
        <Editor height="400px" language={language} onMount={handleEditorMount} />
      )}
      <button onClick={handleRun} disabled={running}>
        {running? 'Running...' : 'Run'}
      </button>
      <pre>{output}</pre>
    </>
  )
}

export default Room
