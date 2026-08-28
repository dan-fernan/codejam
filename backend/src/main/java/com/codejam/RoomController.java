package com.codejam;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@CrossOrigin(origins="http://localhost:5173")
public class RoomController {

    private record CreateRoomResponse(String id) {}

    private final RoomService service;

    public RoomController(RoomService service) {
        this.service = service;
    }

    @PostMapping("/rooms")
    public CreateRoomResponse createRoom() {
        return new CreateRoomResponse(service.createRoom());
    }

    @GetMapping("/rooms/{id}")
    public ResponseEntity<List<byte[]>> getRoom(@PathVariable String id) {
        if (!service.roomExists(id)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.getUpdates(id));
    }
}
