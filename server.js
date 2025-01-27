const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());
app.use(helmet());
app.use(cors());

// Configuration des sessions HTTP
app.use(
    session({
        secret: process.env.SESSION_SECRET || "z`jAo%>8bJ=J*TJ^AbX-c0$6n$e'0gns",
        resave: false,
        saveUninitialized: true,
        cookie: { 
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24
        }
    }),
    helmet.contentSecurityPolicy({
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://unpkg.com"],
            styleSrc: ["'self'", "https://unpkg.com", "'unsafe-inline'"],
            imgSrc: ["'self'", "*", "data:"],
            connectSrc: ["'self'", "ws://localhost:8080"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
            scriptSrcAttr: ["'self'", "'unsafe-inline'"],
        },
    })
);

let usersPositions = [];

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/positions", (req, res) => {
    res.json(usersPositions);
});

// Ajouter ou mettre à jour la position d'un utilisateur
app.post("/position", (req, res) => {
    const { lat, lon, pseudo } = req.body;

    // Si l'utilisateur n'a pas encore de pseudo, on l'utilise de la session
    if (!pseudo) {
        return res.status(400).json({ error: "Pseudo est requis." });
    }

    const id = req.session.userId || uuidv4(); // UUID est encore généré s'il n'y a pas d'utilisateur en session

    // Ajoutez ou mettez à jour la position de l'utilisateur dans la liste
    const userIndex = usersPositions.findIndex(user => user.pseudo === pseudo);

    if (userIndex !== -1) {
        usersPositions.splice(userIndex, 1);
    }

    const user = { id, pseudo, lat, lon, lastUpdated: Date.now() };
    usersPositions.push(user);
    res.status(201).json(user);
});

// Fonction pour supprimer les utilisateurs inactifs
function removeInactiveUsers() {
    const currentTime = Date.now();
    const initialCount = usersPositions.length;
    const activeUsers = usersPositions.filter(user => currentTime - user.lastUpdated < 5 * 60 * 1000);
    usersPositions = activeUsers;

    const removedCount = initialCount - activeUsers.length;
    console.log(`${removedCount} utilisateurs inactifs supprimés.`);
}

setInterval(removeInactiveUsers, 5 * 60 * 1000);

const server = app.listen(port, () => {
    console.log(`Serveur en écoute sur http://localhost:${port}`);
});

const wss = new WebSocket.Server({ server });
let lastPositions = JSON.stringify([]);

setInterval(() => {
    const currentPositions = JSON.stringify(usersPositions);
    if (currentPositions !== lastPositions) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(currentPositions);
            }
        });
        lastPositions = currentPositions;
    }
}, 1000);

wss.on("connection", (ws) => {
    console.log("Un utilisateur s'est connecté");

    ws.on("close", () => {
        console.log("Un utilisateur s'est déconnecté");
    });

    ws.on("error", (error) => {
        console.error("Erreur WebSocket:", error);
    });
});

// Gestion des erreurs 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});