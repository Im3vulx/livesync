let map;
let userMarkers = [];
let locationWatchId = null;
let retryCount = 0;
let connectedUsers = [];
let localStream;
let peerConnection;

// Écouter l'événement de soumission du formulaire du pseudo
document.getElementById('submit-pseudo').addEventListener('click', async function () {
    const pseudo = document.getElementById('pseudo').value;
    if (!pseudo) {
        alert('Veuillez entrer un pseudo.');
        return;
    }

    try {
        await checkGeolocationAvailability();

        document.getElementById('pseudo-container').style.display = 'none';
        document.getElementById('container').style.display = 'flex';

        if (!map) {
            initMap();
        }

        localStorage.setItem('pseudo', pseudo);
        getUserPosition();

    } catch (error) {
        console.error('Échec de la vérification de la géolocalisation :', error);

        if (confirm('La géolocalisation semble ne pas fonctionner. Voulez-vous continuer avec une position par défaut ?')) {
            document.getElementById('pseudo-container').style.display = 'none';
            document.getElementById('container').style.display = 'block';

            if (!map) {
                initMap();
            }

            localStorage.setItem('pseudo', pseudo);
            handleFallback();
        }
    }
});

// Vérifier la disponibilité de la géolocalisation
function checkGeolocationAvailability() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject('L\'API de géolocalisation n\'est pas supportée');
            return;
        }

        const testOptions = {
            timeout: 3000,
            maximumAge: 0,
            enableHighAccuracy: false
        };

        navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            (error) => reject(error),
            testOptions
        );
    });
}

// Initialisation de la carte
function initMap() {
    try {
        map = L.map('map').setView([51.505, -0.09], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        return true;
    } catch (error) {
        console.error('Erreur lors de l\'initialisation de la carte:', error);
        return false;
    }
}

// Gérer les mises à jour de la position de l'utilisateur
function getUserPosition() {
    const pseudo = localStorage.getItem('pseudo');

    if (navigator.geolocation) {
        locationWatchId = navigator.geolocation.watchPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;

                // Mettre à jour la position de l'utilisateur sur le serveur
                fetch('/position', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        lat,
                        lon,
                        pseudo,
                    }),
                })
                    .then(response => response.json())
                    .then((data) => {
                        console.log('Position mise à jour:', data);
                        updateMap(data);
                    })
                    .catch((error) => console.error('Erreur lors de la mise à jour de la position:', error));
            },
            (error) => console.error('Erreur de géolocalisation:', error),
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }
}

// Mettre à jour la carte avec la nouvelle position de l'utilisateur
function updateMap(user) {
    if (!map) return;

    // Supprimer l'ancien marqueur
    userMarkers.forEach((marker) => marker.remove());
    userMarkers = [];

    const marker = L.marker([user.lat, user.lon]).addTo(map);
    marker.bindPopup(user.pseudo).openPopup();

    userMarkers.push(marker);
}

// Reconnexion au WebSocket pour récupérer les positions des utilisateurs
const socket = new WebSocket(`ws://${window.location.host}`);

const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function startCall(targetId) {
    try {
        // Obtenez le flux local (vidéo et audio)
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Créez une nouvelle connexion peer
        peerConnection = new RTCPeerConnection(config);

        // Ajouter les flux locaux à la connexion
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        // Créez une offre SDP
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Envoi de l'offre SDP à l'autre utilisateur via WebSocket
        socket.send(JSON.stringify({
            type: "call-offer",
            to: targetId,
            from: localStorage.getItem('pseudo'),
            offer: offer
        }));

        // Écoutez la réponse (réponse SDP) de l'autre utilisateur
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.send(JSON.stringify({
                    type: "ice-candidate",
                    to: targetId,
                    from: localStorage.getItem('pseudo'),
                    candidate: event.candidate
                }));
            }
        };

        // Affichage du flux vidéo local dans l'élément vidéo local
        document.getElementById('local-video').srcObject = localStream;

    } catch (error) {
        console.error("Erreur lors de la création de l'appel:", error);
    }
}

// Fonction pour accepter un appel
socket.onmessage = async (message) => {
    const msg = JSON.parse(message.data);

    if (msg.type === "call-offer") {
        // L'utilisateur reçoit une offre d'appel
        const offer = msg.offer;
        const from = msg.from;

        // Créez une nouvelle connexion peer pour accepter l'appel
        peerConnection = new RTCPeerConnection(config);
        
        // Ajouter le flux audio/vidéo local à la connexion
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        // Répondre avec une réponse SDP
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Envoi de la réponse SDP à l'utilisateur qui a appelé
        socket.send(JSON.stringify({
            type: "call-answer",
            to: msg.from,
            from: localStorage.getItem('pseudo'),
            answer: answer
        }));

        // Gestion des candidats ICE
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.send(JSON.stringify({
                    type: "ice-candidate",
                    to: from,
                    from: localStorage.getItem('pseudo'),
                    candidate: event.candidate
                }));
            }
        };

        // Affichage du flux vidéo local
        document.getElementById('local-video').srcObject = localStream;
    }

    if (msg.type === "call-answer") {
        // Si l'utilisateur reçoit une réponse à son offre
        const answer = msg.answer;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }

    if (msg.type === "ice-candidate") {
        // Ajout de candidats ICE
        const candidate = msg.candidate;
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
};

// Créer la connexion Peer si elle n'est pas déjà créée
if (!peerConnection) {
    peerConnection = new RTCPeerConnection(config);
}

// Assurez-vous que le flux est ajouté avant de définir ontrack
peerConnection.ontrack = (event) => {
    const remoteStream = event.streams[0];
    document.getElementById('remote-video').srcObject = remoteStream;
};

// Fonction pour quitter l'appel
function hangUp() {
    // Fermer la connexion et le flux vidéo
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    document.getElementById('local-video').srcObject = null;
    document.getElementById('remote-video').srcObject = null;
}

socket.addEventListener('open', () => {
    console.log('WebSocket connecté');
});

socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    displayMessage(message);
});

socket.addEventListener('message', (event) => {
    const users = JSON.parse(event.data);
    updateOtherUsers(users);
});

socket.addEventListener('close', () => {
    console.log('WebSocket fermé');
});

function updateOtherUsers(users) {
    if (!map) return;

    // Mettre à jour la liste des utilisateurs connectés
    connectedUsers = users;
    updateUsersList();

    // Mettre à jour la carte avec les autres utilisateurs
    users.forEach((user) => {
        if (user.pseudo !== localStorage.getItem('pseudo')) {
            const existingMarker = userMarkers.find((marker) => marker.options.pseudo === user.pseudo);
            if (existingMarker) {
                existingMarker.setLatLng([user.lat, user.lon]);
            } else {
                const marker = L.marker([user.lat, user.lon], { pseudo: user.pseudo }).addTo(map);
                marker.bindPopup(user.pseudo).openPopup();
                userMarkers.push(marker);
            }
        }
    });
}

function updateUsersList() {
    const userListContainer = document.getElementById('user-list');
    userListContainer.innerHTML = '';

    connectedUsers.forEach(user => {
        const listItem = document.createElement('li');
        const buttonAppel = document.createElement('button');
        buttonAppel.textContent = 'Appeler';
        buttonAppel.addEventListener('click', () => {
            startCall(user.id);
        });
        listItem.appendChild(buttonAppel);
        listItem.textContent = user.pseudo;
        userListContainer.appendChild(buttonAppel);
        userListContainer.appendChild(listItem);
    });
}

// Fonction pour afficher un message dans le chat
function displayMessage(message) {
    const chatContainer = document.getElementById('chat-container');
    const messageElement = document.createElement('p');
    messageElement.textContent = `${message.user}: ${message.text}`;
    chatContainer.appendChild(messageElement);
}

// Envoi du message dans le chat
document.getElementById('send-chat').addEventListener('click', () => {
    const messageText = document.getElementById('chat-input').value;
    const user = localStorage.getItem('pseudo');
    
    const message = { user, text: messageText };
    
    // Envoyer le message au serveur WebSocket
    socket.send(JSON.stringify(message));
    
    // Réinitialiser le champ de saisie
    document.getElementById('chat-input').value = '';
});