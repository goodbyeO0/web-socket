import express from 'express';
import http from 'http';
import https from 'https';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

const app = express();
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
}));

let serverInstance = http.createServer(app);


const io = new Server(serverInstance, {
    cors: {
        origin: [
        ],
        methods: "*",
        credentials: true
    }
});

// Game state
const waitingPlayers = [];
const activeGames = {};
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
        name: `Player ${socket.id.slice(0, 4)}`
    };

    // Broadcast updated players
    io.emit("playersUpdate", players);

    // Handle join game request
    socket.on("joinGame", () => {
        console.log(`Player ${socket.id} wants to join a game`)

        if (waitingPlayers.length > 0) {
            const opponent = waitingPlayers.shift();
            const gameId = uuidv4();
            console.log(`Game Id: ${gameId}`)

            socket.join(gameId)
            io.sockets.sockets.get(opponent).join(gameId);

            activeGames[gameId] = {
                players: [socket.id, opponent],
                moves: {},
                gameId: gameId,
                currentRound: 1,
                scores: {
                    [socket.id]: 0,
                    [opponent]: 0
                }
            }
            // the syntax will make somehting like this
            // {
            //     "game123": {
            //         players: ["player1", "player2"],
            //         moves: {},
            //         gameId: "game123"
            //     }
            // }

            io.to(gameId).emit("gameStart", {
                gameId: gameId,
                opponent: true
            })

            console.log(`Game ${gameId} started between ${socket.id} and ${opponent}`)
        } else {
            waitingPlayers.push(socket.id);
            socket.emit("waiting");
            console.log(`Player ${socket.id} is waiting for an opponent`)
        }
    })

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

        // Remove from waiting list
        const waitingIndex = waitingPlayers.indexOf(socket.id);
        if (waitingIndex !== -1) {
            waitingPlayers.splice(waitingIndex, 1);
        }

        // Handle active games
        Object.keys(activeGames).forEach(gameId => {
            const game = activeGames[gameId];
            if (game.players.includes(socket.id)) {
                const opponentId = game.players.find(id => id !== socket.id);
                if (opponentId) {
                    io.to(opponentId).emit("opponentLeft");
                }
                delete activeGames[gameId]
            }
        })
    })

    // Handle make move request
    socket.on("makeMove", (data) => {
        const game = activeGames[data.gameId];
        if (!game) return;

        // Record the move
        game.moves[socket.id] = data.move;
        // moves: {
        //     "ABC123": "rock",
        // }

        // Notify opponent that a move was made
        const opponent = game.players.find(id => id !== socket.id);
        io.to(opponent).emit("opponentMoved");

        // Check if both players have moved
        if (Object.keys(game.moves).length === 2) {
            const player1 = game.players[0];
            const player2 = game.players[1];
            const move1 = game.moves[player1];
            const move2 = game.moves[player2];

            // Pass game.players to calculateWinner
            const winner = calculateWinner(move1, move2, game.players);

            if (winner) {
                game.scores[winner] += 1;
            }

            // Send results to both players
            game.players.forEach(playerId => {
                const isPlayer1 = playerId === player1;
                io.to(playerId).emit("roundResult", {
                    yourMove: isPlayer1 ? move1 : move2,
                    opponentMove: isPlayer1 ? move2 : move1,
                    winner: playerId === winner ? "you" : winner ? "opponent" : "tie",
                    round: game.currentRound
                });
            });

            // Reset moves for next round
            game.moves = {};
            game.currentRound += 1;

            // If game is over (after 3 rounds), clean up
            if (game.currentRound > 3) {
                delete activeGames[data.gameId];
            }
        }
    });
})

// Fix the calculateWinner function
function calculateWinner(move1, move2, players) {
    if (move1 === move2) return null; // tie

    if (
        (move1 === "rock" && move2 === "scissors") ||
        (move1 === "paper" && move2 === "rock") ||
        (move1 === "scissors" && move2 === "paper")
    ) {
        return players[0];
    } else if (
        (move2 === "rock" && move1 === "scissors") ||
        (move2 === "paper" && move1 === "rock") ||
        (move2 === "scissors" && move1 === "paper")
    ) {
        return players[1];
    }
}

const PORT = process.env.PORT || 3000;
serverInstance.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});