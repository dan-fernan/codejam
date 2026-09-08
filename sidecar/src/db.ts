import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL})


// still need to set up DB, but this is a placeholder for updating our DB on a closed room.

export async function writeRoomBytes(roomId: string, bytes: Uint8Array): Promise<void> {
    await pool.query(
        `INSERT INTO rooms (id, bytes, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at`,
        [roomId, bytes]
    )
}