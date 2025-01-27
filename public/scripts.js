let map;
let userMarkers = [];
let locationWatchId = null;
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
let connectedUsers = [];

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
        console.error('Erreur lors de l\'initialisation de la carte :', error);
        return false;
    }
}

// Gestion du fallback en cas d'échec de la géolocalisation
function handleFallback() {
    console.log('Utilisation de la position par défaut');
    const fallbackLat = 48.8566;
    const fallbackLon = 2.3522;

    map.setView([fallbackLat, fallbackLon], 13);

    const marker = L.marker([fallbackLat, fallbackLon]).addTo(map)
        .bindPopup('Position par défaut (Paris)<br>La géolocalisation a échoué')
        .openPopup();
    userMarkers.push(marker);

    alert('La géolocalisation a échoué. Vérifiez vos paramètres et réessayez.');
}

// Obtenir la position de l'utilisateur
function getUserPosition() {
    if (!map) {
        console.warn('Carte non initialisée. Tentative d\'initialisation...');
        if (!initMap()) {
            alert('Impossible d\'initialiser la carte. Veuillez actualiser la page.');
            return;
        }
    }

    if (navigator.geolocation) {
        if (locationWatchId !== null) {
            navigator.geolocation.clearWatch(locationWatchId);
        }

        const options = {
            enableHighAccuracy: false,
            timeout: 5000,
            maximumAge: 10000
        };

        locationWatchId = navigator.geolocation.watchPosition(
            (position) => {
                retryCount = 0;
                const { latitude: lat, longitude: lon, accuracy } = position.coords;

                map.setView([lat, lon], 13);

                userMarkers.forEach(marker => map.removeLayer(marker));
                userMarkers = [];

                const marker = L.marker([lat, lon]).addTo(map)
                    .bindPopup(`Vous êtes ici<br>Précision : ${accuracy.toFixed(2)} m`)
                    .openPopup();
                userMarkers.push(marker);

                sendPositionToServer(lat, lon);
            },
            (error) => {
                console.error('Erreur de localisation :', error);

                if (retryCount < MAX_RETRIES) {
                    retryCount++;
                    console.log(`Nouvelle tentative ${retryCount} sur ${MAX_RETRIES}`);
                    setTimeout(getUserPosition, RETRY_DELAY);
                } else {
                    handleFallback();
                }
            },
            options
        );
    } else {
        alert('La géolocalisation n\'est pas supportée par ce navigateur.');
    }
}

// Envoyer la position de l'utilisateur au serveur
function sendPositionToServer(lat, lon) {
    const pseudo = localStorage.getItem('pseudo');
    fetch('/position', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            pseudo: pseudo || 'utilisateur-local',
            lat: lat,
            lon: lon
        })
    }).then(response => response.json())
        .then(data => {
            console.log('Position envoyée :', data);
        }).catch(error => console.error('Erreur d\'envoi :', error));
}

// WebSocket pour récupérer les positions en temps réel
const socket = new WebSocket("ws://localhost:8080");

socket.onmessage = (event) => {
    const usersPositions = JSON.parse(event.data);
    connectedUsers = usersPositions;
    updateUserList();

    if (!map) {
        console.warn('Carte non initialisée');
        return;
    }

    userMarkers.forEach(marker => map.removeLayer(marker));
    userMarkers = [];

    usersPositions.forEach(user => {
        if (user.lat && user.lon) {
            // Utilisation du pseudo dans le pop-up
            const marker = L.marker([user.lat, user.lon]).addTo(map)
                .bindPopup(`<b>${user.pseudo || user.id}</b><br>Latitude: ${user.lat}<br>Longitude: ${user.lon}`);
            userMarkers.push(marker);
        }
    });
};

socket.onerror = (error) => {
    console.error('Erreur WebSocket :', error);
};

socket.onclose = (event) => {
    console.log('Connexion WebSocket fermée :', event);
};

// Met à jour la liste des utilisateurs connectés
function updateUserList() {
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';

    connectedUsers.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';

        // Affichage du pseudo
        const userName = localStorage.getItem('pseudo') || user.id;
        userItem.innerHTML = `
            <p><strong>${userName}</strong></p>
            <button class="message-button" onclick="sendMessage('${user.pseudo}')">Message</button>
            <button class="call-button" onclick="startCall('${user.pseudo}')">Appel FaceTime</button>
        `;
        userList.appendChild(userItem);
    });
}

// Envoi du message
function sendMessage(userPseudo) {
    const user = connectedUsers.find(u => localStorage.getItem('pseudo') === userPseudo);
    const userName = user ? user.pseudo : localStorage.getItem('pseudo');

    document.getElementById('conversation-with').innerText = userName;
    document.getElementById('conversation-container').style.display = 'flex';
    
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML += `<div><strong>Vous :</strong> Salut ${userName} !</div>`;
}

// Démarrage de l'appel FaceTime
function startCall(userPseudo) {
    const isAppleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    if (isAppleDevice) {
        const facetimeUrl = `facetime://${userPseudo}`;
        window.location.href = facetimeUrl;
    } else {
        alert(`FaceTime n'est disponible que sur des appareils Apple. Impossible de démarrer un appel.`);
    }
}

// Envoi du message du chat
function sendChatMessage() {
    const message = document.getElementById('message-input').value;
    if (message.trim()) {
        const messagesDiv = document.getElementById('messages');
        messagesDiv.innerHTML += `<div><strong>Vous :</strong> ${message}</div>`;
        document.getElementById('message-input').value = '';
    }
}

// Fermer la conversation
function closeConversation() {
    document.getElementById('conversation-container').style.display = 'none';
    document.getElementById('messages').innerHTML = '';
}