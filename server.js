const fs = require("fs");
const https = require("https");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const { v4: uuidv4 } = require("uuid");

const app = express();
const port = process.env.PORT || 8080;

// Charger les certificats SSL
// const privateKey = fs.readFileSync("/etc/letsencrypt/live/loic.huet.caen.mds-project.fr/privkey.pem","utf8");
// const certificate = fs.readFileSync("/etc/letsencrypt/live/loic.huet.caen.mds-project.fr/fullchain.pem","utf8");
// const ca = fs.readFileSync("/etc/letsencrypt/live/loic.huet.caen.mds-project.fr/chain.pem","utf8");

// const credentials = { key: privateKey, cert: certificate, ca: ca };

// Configurer le serveur HTTPS
// const server = https.createServer(credentials, app);
const server = http.createServer(app);

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
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24,
        },
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

app.use((req, res, next) => {
    console.log("Vérification session avant ajout de l'ID:", req.session ? req.session.userId : "Session non définie");
    
    if (!req.session || !req.session.userId) {
        console.log("Aucun ID dans la session, création d'un nouvel ID...");
        if (!req.session) req.session = {};
        req.session.userId = uuidv4();
    }
    
    console.log("ID utilisateur dans la session:", req.session.userId);
    req.userId = req.session.userId;
    next();
});

let usersPositions = [];
let usersData = {};

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
    if (!pseudo) {
        return res.status(400).json({ error: "Pseudo est requis." });
    }

    const id = req.userId;
    console.log("ID de l'utilisateur:", id);

    const userIndex = usersPositions.findIndex((user) => user.pseudo === pseudo);

    if (userIndex !== -1) {
        usersPositions.splice(userIndex, 1);
    }

    const user = { id, pseudo, lat, lon, lastUpdated: Date.now() };
    usersPositions.push(user);
    res.status(201).json(user);
});

// Route pour recevoir les données d'accéléromètre
app.post("/accelerometer", (req, res) => {
    const { acceleration, alpha, beta, gamma, pseudo } = req.body;

    if (
        !acceleration ||
        typeof acceleration.x === "undefined" ||
        typeof acceleration.y === "undefined" ||
        typeof acceleration.z === "undefined"
    ) {
        return res
        .status(400)
        .json({ error: "Les valeurs d'accéléromètre (x, y, z) sont requises." });
    }

    if (
        typeof alpha === "undefined" ||
        typeof beta === "undefined" ||
        typeof gamma === "undefined"
    ) {
        return res.status(400).json({
        error: "Les valeurs de rotation (alpha, beta, gamma) sont requises.",
        });
    }

    if (!pseudo) {
        return res.status(400).json({ error: "Pseudo est requis." });
    }

    // Extraire x, y, z correctement
    const { x, y, z } = acceleration;

    // Ajouter ou mettre à jour les données d'accéléromètre pour l'utilisateur
    const userIndex = usersPositions.findIndex((user) => user.pseudo === pseudo);
    if (userIndex !== -1) {
        usersData[pseudo] = {
        acceleration: { x, y, z },
        rotation: { alpha, beta, gamma },
        };
    } else {
        const id = uuidv4();
        usersData[pseudo] = {
        acceleration: { x, y, z },
        rotation: { alpha, beta, gamma },
        };
        usersPositions.push({ id, pseudo });
    }

    res.status(201).json({ message: "Données d'accéléromètre mises à jour avec succès." });
});

// Route pour obtenir les données d'accéléromètre
app.get("/accelerometers", (req, res) => {
    const accelerometerData = Object.keys(usersData).map((pseudo) => ({
        pseudo,
        acceleration: usersData[pseudo].acceleration,
        rotation: usersData[pseudo].rotation,
    }));
    res.json(accelerometerData);
});

// Fonction pour supprimer les utilisateurs inactifs
function removeInactiveUsers() {
    const currentTime = Date.now();
    const initialCount = usersPositions.length;
    const activeUsers = usersPositions.filter(
        (user) => currentTime - user.lastUpdated < 5 * 60 * 1000
    );
    usersPositions = activeUsers;

    const removedCount = initialCount - activeUsers.length;
    console.log(`${removedCount} utilisateurs inactifs supprimés.`);
}

setInterval(removeInactiveUsers, 5 * 60 * 1000);

// WebSocket sur HTTPS
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
    ws.id = uuidv4();
    console.log(`Nouvel utilisateur connecté avec ID: ${ws.id}`);

    // Envoi de la liste des utilisateurs et de leurs positions
    ws.send(JSON.stringify(usersPositions));

    // Envoi des données d'accéléromètre
    ws.send(JSON.stringify(usersData));

    ws.on("message", (message) => {
        console.log("Message reçu:", message);
        const chatMessage = JSON.parse(message);

        if (chatMessage.type === "chat") {
        if (chatMessage.to) {
            wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.id === chatMessage.to) {
                client.send(JSON.stringify({
                type: "chat",
                from: chatMessage.from,
                message: chatMessage.message
                }));
            }
            });
        } else {
            wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                type: "chat",
                from: chatMessage.from,
                message: chatMessage.message
                }));
            }
            });
        }
        }

        if (chatMessage.type === "call-offer") {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.id === chatMessage.to) {
            client.send(JSON.stringify({
                type: "call-offer",
                from: chatMessage.from,
                offer: chatMessage.offer
            }));
            }
        });
        }

        if (chatMessage.type === "call-answer") {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.id === chatMessage.to) {
            client.send(JSON.stringify({
                type: "call-answer",
                from: chatMessage.from,
                answer: chatMessage.answer
            }));
            }
        });
        }
    });

    ws.on("close", () => {
        console.log(`Utilisateur déconnecté: ${ws.id}`);
    });

    ws.on("error", (error) => {
        console.error("Erreur WebSocket:", error);
    });
});

// Gestion des erreurs 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

// Démarrer le serveur HTTPS
server.listen(port, () => {
    console.log(`Serveur HTTPS en écoute sur http://localhost:${port}`);
});