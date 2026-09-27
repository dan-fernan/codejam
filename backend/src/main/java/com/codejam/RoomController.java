package com.codejam;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@CrossOrigin(origins="http://localhost:5173", allowCredentials = "true") // allows cross-origin traffic, then enables pages from 5173 to read 8080's responses, cookies included
public class RoomController {

    private record CreateRoomResponse(String id) {}

    private final RoomService service;

    public RoomController(RoomService service) {
        this.service = service;
    }

    @PostMapping("/rooms")
    public CreateRoomResponse createRoom(@CookieValue(name = "userId", required = false) String userId) {
        return new CreateRoomResponse(service.createRoom(userId));
    }

    @PostMapping("/rooms/{id}/join")
    public ResponseEntity<Void> joinRoom(@PathVariable String id, @CookieValue(name = "userId", required = false) String userId) {
        return service.joinRoom(id, userId) ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    @GetMapping("/rooms/{id}")
    public ResponseEntity<List<byte[]>> getRoom(@PathVariable String id) {
        if (!service.roomExists(id)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.getUpdates(id));
    }
}
