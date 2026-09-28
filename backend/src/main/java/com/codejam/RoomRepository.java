package com.codejam;

import java.time.Instant;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component 
public class RoomRepository {
    private final JdbcTemplate jdbc;

    public record RecentRoom(String id, String alias, Instant lastJoinedAt) {}

    public RoomRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    // Essentially creates a proxy interceptor that allows all jdbc updates in this method to be binded to the same thread.
    // The proxy only commits if the method returns normally, which enables the transactional behavior
    public void createRoom(String roomId, String userId, String alias) {
        jdbc.update("INSERT INTO rooms (id, alias) VALUES (?, ?)", roomId, alias);
        if (userId != null) {
            jdbc.update("INSERT INTO room_participants (user_id, room_id) VALUES (?, ?)", userId, roomId);
        }
    }

    @Transactional 
    public boolean joinRoom(String roomId, String userId) {
        Boolean exists = jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM rooms WHERE id = ?)", Boolean.class, roomId);
        if (!exists) return false;
        if (userId != null) {
            jdbc.update(
                "INSERT INTO room_participants (user_id, room_id) VALUES (?, ?) " +
                "ON CONFLICT (user_id, room_id) DO UPDATE SET last_joined_at = now()", userId, roomId);
        }
        return true;
    }

    public List<RecentRoom> getRecentRooms(String userId) {
        return jdbc.query(
            "SELECT r.id, r.alias, rp.last_joined_at " +
            "FROM room_participants rp " +
            "JOIN rooms r ON r.id = rp.room_id " +
            "WHERE rp.user_id = ? " +
            "ORDER BY rp.last_joined_at DESC " +
            "LIMIT 10",
            (rs, rowNum) -> new RecentRoom(
                rs.getString("id"),
                rs.getString("alias"),
                rs.getTimestamp("last_joined_at").toInstant()
            ),
            userId
        );
    }
}
