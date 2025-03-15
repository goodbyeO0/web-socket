import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors"

const app = express();
app.use(cors({
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true
}))

let serverInstance = http.createServer(app);