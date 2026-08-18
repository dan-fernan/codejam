import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function Home () {
    const [creating, setCreating] = useState(false)
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
    return (
        <button onClick={createRoom} disabled={creating}>
            {creating ? 'Creating...' : 'Create Room'}
        </button>
    )
}

export default Home