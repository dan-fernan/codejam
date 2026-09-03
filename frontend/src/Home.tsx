import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
// @ts-expect-error CodejamJarFlat.jsx does not currently have TypeScript declarations.
import CodejamJarFlat from './CodejamJarFlat.jsx'

function Home () {
    const [creating, setCreating] = useState(false)
    const [joining, setJoining] = useState(false)
    const [roomId, setRoomId] = useState('')
    const [joinError, setJoinError] = useState('')
    const navigate = useNavigate()

    async function createRoom() {
        setCreating(true)
        try {
            let res = await fetch('http://localhost:8080/rooms', { method: 'POST' })
            const room = await res.json()
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
            // Eventually consider creating a second endpoint, as this returns an unused and frankly large amount of
            // bytes, which are used to actually update a Y.Doc. This is just an existence check, so not really necessary.
            if (!res.ok) {
                setJoinError('Room not found')
                return
            }
            navigate(`/room/${id}`)
        } finally {
            setJoining(false)
        }
    }

    return (
        <>
            <CodejamJarFlat />
            <button onClick={createRoom} disabled={creating}>
                {creating ? 'Creating...' : 'Create Room'}
            </button>
            <div>
                <input
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    placeholder="Room ID"
                />
                <button onClick={joinRoom} disabled={joining || !roomId.trim()}>
                    {joining ? 'Joining...' : 'Join Room'}
                </button>
                {joinError && <p>{joinError}</p>}
            </div>
        </>
    )
}

export default Home