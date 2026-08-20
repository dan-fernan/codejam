package com.codejam;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
// DelegatingWebSocketConfiguration is imported by @EnableWebSocket, looks through
// Spring context specifically for beans of WebSocketConfigurer type. The import
// builds one WebSocketHandlerRegistry obj and calls the implemented method, on
// every WebSocketConfigurer it can find, handing each the same registry.
public class WebSocketConfig implements WebSocketConfigurer{

    private final RoomWebSocketHandler handler;

    public WebSocketConfig(RoomWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler,"/ws/rooms/*").setAllowedOrigins("http://localhost:5173");
    }
}
