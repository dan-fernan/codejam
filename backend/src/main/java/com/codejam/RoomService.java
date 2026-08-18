package com.codejam;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

@Service
public class RoomService {
    public record Room(String id, String code, String language) {}

    // ConcurrentHashMap allows multiple threads to access the same map,
    // while locking each bucket to ensure serialized updates to the same bucket
    // data, not simultaneous ones. Otherwise would have race conditions/lost updates
     
    private final Map<String, Room> rooms = new ConcurrentHashMap<>(); 

    public String createRoom() {
        String id = UUID.randomUUID().toString();
        rooms.put(id, new Room(id, "", "python"));
        return id;
    }

    public Room getRoom(String id) {
        return rooms.get(id);
    }

    public void updateRoom(String id, String code, String language) {
        rooms.put(id, new Room(id, code, language));
    }
}
