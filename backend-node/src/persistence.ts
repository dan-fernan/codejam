const SPRING_URL = process.env.SPRING_URL
const TIMEOUT_MS = 5_000

// null = room DNE (404). Throws if Spring is unreachable or errors
// callers can tell "no such room" apart from "persistence layer is down".
export async function loadState(roomId: string): Promise<Uint8Array | null> {
  const res = await fetch(`${SPRING_URL}/rooms/${encodeURIComponent(roomId)}/state`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (res.status === 404) return null
  if (!res.ok) throw new Error(`loadState ${roomId}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

// returns false on 404 (room was deleted), throws on anything else so the flush can retry
export async function saveState(roomId: string, bytes: Uint8Array): Promise<boolean> {
  const res = await fetch(`${SPRING_URL}/rooms/${encodeURIComponent(roomId)}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`saveState ${roomId}: HTTP ${res.status}`)
  return true
}
