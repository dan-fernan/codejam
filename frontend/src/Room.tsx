import { useState, useEffect } from 'react'  
import { useParams } from 'react-router-dom'

const LANGUAGES = ['python', 'javascript']

function Room() {
  const { roomId } = useParams()
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('python')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    async function fetchRoom() {
      try {
        const res = await fetch(`http://localhost:8080/rooms/${roomId}`)
        if (!res.ok) return
        const room = await res.json()
        setCode(room.code)
        setLanguage(room.language)
      } catch (err) {
        // network failure
      }
    }
    fetchRoom()
    console.log('Ran the fetch')  
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

  return (
    <>
      <select value={language} onChange={(e) => setLanguage(e.target.value)}>
        {LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>{lang}</option>
        ))}
      </select>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
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
