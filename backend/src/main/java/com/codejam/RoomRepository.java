package com.codejam;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component 
public class RoomRepository {
    private final JdbcTemplate jdbc;

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
                "ON CONFLICT (user_id, room_id) DO NOTHING", userId, roomId);
        }
        return true;
    }
}
