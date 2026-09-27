import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CodejamJarFlat, { type Mood } from './CodejamJarFlat'
import { C, FONT_UI, FONT_MONO } from './theme'
import CookieConsent from './CookieConsent'

const HOP_MS = 740
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function Home() {
    const [creating, setCreating] = useState(false)
    const [joining, setJoining] = useState(false)
    const [alias, setAlias] = useState('')
    const [roomId, setRoomId] = useState('')
    const [joinError, setJoinError] = useState('')
    const [mood, setMood] = useState<Mood>('happy')
    const [hopSignal, setHopSignal] = useState(0)
    const [tilting, setTilting] = useState(false)
    const moodResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const navigate = useNavigate()

    function pressJar() {
        setTilting(true)
        setTimeout(() => setTilting(false), 420)
    }

    async function createRoom() {
        setCreating(true)
        pressJar()
        try {
            const res = await fetch('http://localhost:8080/rooms', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alias: alias.trim().replace(/^-+|-+$/g, '') }),
            })
            const room = await res.json()
            setHopSignal((s) => s + 1)
            await wait(HOP_MS)
            navigate(`/room/${room.id}`)
        } finally {
            setCreating(false)
        }
    }

    async function joinRoom() {
        const id = roomId.trim()
        if (!id) return
        setJoining(true)
        setJoinError('')
        try {
            const res = await fetch(`http://localhost:8080/rooms/${id}`)
            if (!res.ok) {
                clearTimeout(moodResetTimer.current)
                setMood('thinking')
                setJoinError('Room not found')
                moodResetTimer.current = setTimeout(() => setMood('happy'), 1400)
                return
            }
            setHopSignal((s) => s + 1)
            await wait(HOP_MS)
            navigate(`/room/${id}`)
        } finally {
            setJoining(false)
        }
    }

    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 20,
                padding: '32px 16px',
            }}
        >   
            <CookieConsent />
            <h1
                style={{
                    margin: 0,
                    fontFamily: FONT_UI,
                    fontWeight: 800,
                    fontSize: 32,
                    color: C.ink,
                    letterSpacing: -0.5,
                }}
            >
                Code<span style={{ color: C.jam }}>Jam</span>
            </h1>

            <CodejamJarFlat mood={mood} size={200} hopSignal={hopSignal} />
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    animation: tilting ? 'cjf-tilt 400ms ease' : 'none',
                    transformOrigin: '50% 100%',
                }}
            >
                <input
                    value={alias}
                    onChange={(e) => setAlias(e.target.value.replace(/[\s-]+/g, '-'))}
                    placeholder="alias (optional)"
                    maxLength={40}
                    style={{
                        fontFamily: FONT_MONO,
                        fontSize: 15,
                        color: C.ink,
                        background: C.paper,
                        border: '2px solid transparent',
                        borderBottom: `2px solid ${C.jam}`,
                        borderRadius: '8px 8px 0 0',
                        padding: '10px 14px',
                        outline: 'none',
                        width: 180,
                    }}
                />

                <button
                    onClick={createRoom}
                    disabled={creating}
                    style={{
                        fontFamily: FONT_UI,
                        fontWeight: 700,
                        fontSize: 15,
                        color: C.white,
                        background: C.jam,
                        border: 'none',
                        borderRadius: '0 0 8px 8px',
                        padding: '8px 28px',
                        cursor: creating ? 'default' : 'pointer',
                        width: 180,
                    }}
                >
                    {creating ? 'Creating...' : 'Create Room'}
                </button>
            </div>

            <div style={{ fontFamily: FONT_UI, fontSize: 13, color: C.lidTop }}>or join an existing one</div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                        placeholder="room code"
                        style={{
                            fontFamily: FONT_MONO,
                            fontSize: 15,
                            color: C.ink,
                            background: C.paper,
                            border: `2px solid ${joinError ? C.mouth : 'transparent'}`,
                            borderBottom: `2px solid ${joinError ? C.mouth : C.jam}`,
                            borderRadius: 8,
                            padding: '10px 14px',
                            outline: 'none',
                            width: 180,
                        }}
                    />
                    <button
                        onClick={joinRoom}
                        disabled={joining || !roomId.trim()}
                        style={{
                            fontFamily: FONT_UI,
                            fontWeight: 700,
                            fontSize: 15,
                            color: C.white,
                            background: C.jam,
                            border: 'none',
                            borderRadius: 999,
                            padding: '10px 22px',
                            cursor: joining || !roomId.trim() ? 'default' : 'pointer',
                            opacity: !roomId.trim() ? 0.6 : 1,
                        }}
                    >
                        {joining ? 'Joining...' : 'Join Room'}
                    </button>
                </div>
                {joinError && (
                    <p style={{ margin: 0, fontFamily: FONT_UI, fontSize: 13, color: C.mouth }}>{joinError}</p>
                )}
            </div>
        </div>
    )
}

export default Home
