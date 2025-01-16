const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const app = express();
const port = 8080;

app.use(express.json());

// Servir le fichier HTML pour l'interface
app.use(express.static(path.join(__dirname, "public")));

// Endpoint pour récupérer les positions des utilisateurs
let usersPositions = [];
app.get("/positions", (req, res) => {
    res.json(usersPositions);
});

// Ajouter une position d'utilisateur
app.post("/position", (req, res) => {
    const { id, lat, lon } = req.body;
    const user = { id, lat, lon };
    usersPositions.push(user);
    res.status(201).json(user);
});

const server = app.listen(port, () => {
    console.log(`Serveur en écoute sur http://localhost:${port}`);
});

// Serveur WebSocket
const wss = new WebSocket.Server({ server });
wss.on("connection", (ws) => {
    console.log("Un utilisateur s'est connecté");

    // Diffuser les positions en temps réel
    setInterval(() => {
        ws.send(JSON.stringify(usersPositions));
    }, 1000);
});