package com.codejam;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;

import java.util.UUID;
import java.time.Duration;
import java.util.List;

@RestController
@CrossOrigin(origins="http://localhost:5173", allowCredentials = "true") // allows cross-origin traffic, then enables pages from 5173 to read 8080's responses, cookies included
public class RoomController {

    private record CreateRoomResponse(String id) {}
    private record CreateRoomRequest(String alias) {}

    private final RoomService service;

    public RoomController(RoomService service) {
        this.service = service;
    }

    @PostMapping("/rooms")
    public CreateRoomResponse createRoom(
            @RequestBody(required = false) CreateRoomRequest request,
            @CookieValue(name = "userId", required = false) String userId) {
        String alias = request != null ? request.alias() : null;
        return new CreateRoomResponse(service.createRoom(userId, alias));
    }

    @PostMapping("/rooms/{id}/join")
    public ResponseEntity<Void> joinRoom(@PathVariable String id, @CookieValue(name = "userId", required = false) String userId) {
        return service.joinRoom(id, userId) ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    @PostMapping("/session")
    public ResponseEntity<Void> session(@CookieValue(name = "userId", required = false) String userId) {
        if (userId != null) {
            return ResponseEntity.noContent().build();
        }
        ResponseCookie cookie = ResponseCookie.from("userId", UUID.randomUUID().toString()) // creates cookie builder
            .httpOnly(true) // prevents the cookie from being read via document.cookie
            .path("/")
            .maxAge(Duration.ofDays(365))
            .sameSite("Lax")
            .build();
        return ResponseEntity.noContent()
            .header(HttpHeaders.SET_COOKIE, cookie.toString()) // serializes the cookie header to hold the content of our built cookie object
            .build();
    }

    @GetMapping("/rooms/{id}")
    public ResponseEntity<List<byte[]>> getRoom(@PathVariable String id) {
        if (!service.roomExists(id)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.getUpdates(id));
    }
}
