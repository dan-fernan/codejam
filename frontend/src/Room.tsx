import { useState, useEffect, useRef } from 'react'  
import { useParams } from 'react-router-dom'

const LANGUAGES = ['python', 'javascript']

function Room() {
  const { roomId } = useParams()
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('python')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    async function fetchRoom() {
      try {
        const res = await fetch(`http://localhost:8080/rooms/${roomId}`)
        if (!res.ok) return
        const room = await res.json()
        console.log(room.code)
        console.log(room.language)
        setCode(room.code)
        setLanguage(room.language)
      } catch (err) {
        // network failure
      }
    }
    fetchRoom() 
  }, [roomId])

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8080/ws/rooms/${roomId}`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'code') setCode(msg.value)
      else if (msg.type === 'language') setLanguage(msg.value)
    }

    return () => ws.close()
  }, [roomId])

  async function handleRun() {
    setRunning(true)
    setOutput('')
    try {
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

  function handleCodeChange(newCode: string) {
    setCode(newCode)
    wsRef.current?.send(JSON.stringify({ type: 'code', value: newCode}))
  }

  function handleLanguageChange(newLanguage: string) {
    setLanguage(newLanguage)
    wsRef.current?.send(JSON.stringify({ type: 'language', value: newLanguage}))
  }

  return (
    <>
      <select value={language} onChange={(e) => handleLanguageChange(e.target.value)}>
        {LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>{lang}</option>
        ))}
      </select>
      <textarea
        value={code}
        onChange={(e) => handleCodeChange(e.target.value)}
        rows={10}
        cols={60}
      />
      <button onClick={handleRun} disabled={running}>
        {running? 'Running...' : 'Run'}
      </button>
      <pre>{output}</pre>
    </>
  )
}

export default Room
