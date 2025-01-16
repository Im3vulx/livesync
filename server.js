const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const app = express();
const port = 8080;

app.use(express.json());

// Liste pour stocker les positions des utilisateurs et la dernière mise à jour
let usersPositions = [];

// Servez les fichiers statiques (par exemple, un fichier HTML dans un dossier "public")
app.use(express.static(path.join(__dirname, "public")));

// Route pour la racine du site, renvoie un fichier HTML
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Endpoint pour récupérer les positions des utilisateurs
app.get("/positions", (req, res) => {
    res.json(usersPositions);
});

// Ajouter ou mettre à jour la position d'un utilisateur
app.post("/position", (req, res) => {
    const { id, lat, lon } = req.body;

    // Vérifier si l'utilisateur existe déjà dans la liste
    const userIndex = usersPositions.findIndex(user => user.id === id);

    if (userIndex !== -1) {
        // Si l'utilisateur existe, on supprime son ancienne position
        usersPositions.splice(userIndex, 1);
    }

    // Ajouter la nouvelle position de l'utilisateur avec un horodatage
    const user = { id, lat, lon, lastUpdated: Date.now() };
    usersPositions.push(user);
    res.status(201).json(user);
});

// Fonction pour supprimer tous les utilisateurs
function removeAllUsers() {
    usersPositions = [];
    console.log("Tous les utilisateurs ont été supprimés.");
}

// Endpoint pour supprimer tous les utilisateurs
app.delete("/users", (req, res) => {
    removeAllUsers();
    res.status(200).send("Tous les utilisateurs ont été supprimés.");
});

// Fonction pour supprimer les utilisateurs inactifs
function removeInactiveUsers() {
    const currentTime = Date.now();
    const activeUsers = usersPositions.filter(user => currentTime - user.lastUpdated < 5 * 60 * 1000);
    usersPositions = activeUsers;
    console.log("Utilisateurs inactifs supprimés.");
}

// Supprimer les utilisateurs inactifs toutes les 5 minutes
setInterval(removeInactiveUsers, 5 * 60 * 1000);

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