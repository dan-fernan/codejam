import 'dotenv/config'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import * as awarenessProtocol from 'y-protocols/awareness.js'
import { getOrLoadRoom, onRoomJoined, onRoomEmpty, flushAll, rooms } from './rooms.js'
import { handleMessage, send, syncStep1Message, awarenessMessage } from './protocol.js'

const PORT = Number(process.env.PORT)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN // http://localhost:5173 locally, https://codejam.dev in prod
const wss = new WebSocketServer({
  port: PORT,
  // runs before handshake completes
  verifyClient: ({ origin }: { origin?: string }) => origin === undefined || origin === FRONTEND_ORIGIN,
})

const HEARTBEAT_MS = 15_000
const alive = new WeakSet<WebSocket>() // sockets that answered since last ping

// every 15s: terminate any socket that didn't answer the previous ping, then ping the rest.
// a dead socket is detected within 15-30s
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!alive.has(socket)) {
      socket.terminate() // fires 'close' -> normal cleanup
      continue
    }
    alive.delete(socket)
    socket.ping()
  }
}, HEARTBEAT_MS)

wss.on('close', () => clearInterval(heartbeat))

wss.on('connection', async (socket: WebSocket, req) => {

  alive.add(socket)
  socket.on('pong', () => alive.add(socket))
  socket.on('error', (err) => console.error('socket error:', err.message)) // an 'error' with no listener crashes the process
  // WebsocketProvider connects to `${serverUrl}/${roomName}`, so the path is /<roomId>
  const roomId = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1))
  if (!roomId) return socket.close(4400, 'missing room id')

  // Buffer messages until the room is loaded. The client sends SyncStep1 the moment
  // the socket opens, and 'message' events emitted before a listener exists are lost.
  const pending: RawData[] = []
  const buffer = (data: RawData) => pending.push(data)
  socket.on('message', buffer)

  let room
  try {
    room = await getOrLoadRoom(roomId)
  } catch (err) {
    console.error(`load failed for ${roomId}:`, err)
    return socket.close(1011, 'persistence unavailable') // client will reconnect and retry
  }
  if (!room) return socket.close(4404, 'room not found')
  if (socket.readyState !== socket.OPEN) {
    // client left while we were loading
    if (room.sockets.size === 0) onRoomEmpty(room)
    return
  }

  room.sockets.set(socket, new Set())
  onRoomJoined(room) // cancels pending eviction if someone rejoined during the grace period
  console.log(`joined ${roomId} (${room.sockets.size} connected)`)

  socket.off('message', buffer)
  // step 3: attach the real message handler here and replay `pending` through it
  //

  const onMessage = (data: RawData) => {
    try {
      handleMessage(room, socket, data)
    } catch (err) {
      console.error(`bad message in ${roomId}:`, err)
      socket.close(1007, 'invalid message') // malformed message shouldn't crash server
    }
  }
  socket.on('message', onMessage)

  send(socket, syncStep1Message(room)) // "here's what I have:" pulls in client's offline edits
  const present = Array.from(room.awareness.getStates().keys())
  if (present.length > 0) send(socket, awarenessMessage(room, present)) // late joiner can see cursors right away

  for (const data of pending) onMessage(data) // replay whatever arrived during the load

  socket.on('close', () => {
    const ids = room.sockets.get(socket)
    room.sockets.delete(socket)
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(ids), null)
    }
    console.log(`left ${roomId} (${room.sockets.size} connected)`)
    if (room.sockets.size === 0) onRoomEmpty(room) // grace timer -> flush -> evict
  })
})

async function shutdown(signal: string) {
  console.log(`${signal}: flushing ${rooms.size} room(s) before exit`)
  setTimeout(() => process.exit(1), 10_000).unref() // hard limit if Spring hangs, makes sure timer can't keep Node alive
  clearInterval(heartbeat)
  for (const socket of wss.clients) socket.close(1012, 'server restarting') // clients will reconnect
  wss.close() // stop accepting new connections
  await flushAll()
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT')) // Ctrl + C

console.log(`real-time layer listening on :${PORT}`)
