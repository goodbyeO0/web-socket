import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
}));

let serverInstance = http.createServer(app);


const io = new Server(serverInstance, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Game state
const players = {};
const INTERACTION_RADIUS = 100;

// Add these constants at the top
const DEFAULT_MAP_WIDTH = 1000;  // Default size, will be adjusted by client
const DEFAULT_MAP_HEIGHT = 1000;

app.get('/', (req, res) => {
    res.send('Socket.io server is running');
});

io.on("connection", (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // Initialize player in center of map
    players[socket.id] = {
        id: socket.id,
        x: Math.random() * (400 - 50) + 25,
        y: Math.random() * (400 - 50) + 25,
        name: `${socket.id.slice(0, 4)}`
    };

    // Broadcast updated players
    io.emit("playersUpdate", players);

    // Handle position updates with bounds checking
    socket.on("updatePosition", (position) => {
        if (players[socket.id]) {
            // Ensure position is within bounds
            const x = Math.max(0, Math.min(position.x, DEFAULT_MAP_WIDTH));
            const y = Math.max(0, Math.min(position.y, DEFAULT_MAP_HEIGHT));

            players[socket.id].x = x;
            players[socket.id].y = y;

            // Broadcast the update to all clients
            io.emit("playersUpdate", players);
        }
    });

    // Handle chat messages
    socket.on("sendMessage", (messageContent) => {
        const sender = players[socket.id];
        if (!sender) return;

        // Find players within interaction radius
        const nearbyPlayers = Object.values(players).filter(player => {
            if (player.id === socket.id) return false;

            const distance = Math.sqrt(
                Math.pow(player.x - sender.x, 2) +
                Math.pow(player.y - sender.y, 2)
            );
            return distance <= INTERACTION_RADIUS;
        });

        // Create message object
        const message = {
            senderId: socket.id,
            senderName: sender.name,
            content: messageContent,
            timestamp: new Date()
        };

        // Send message to nearby players and sender
        nearbyPlayers.forEach(player => {
            io.to(player.id).emit("receiveMessage", message);
        });
        socket.emit("receiveMessage", message); // Send to sender
    });

    // Handle disconnect
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        delete players[socket.id];
        io.emit("playersUpdate", players);
    })

})

const PORT = process.env.PORT || 3002;
serverInstance.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
