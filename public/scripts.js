let map;
let userMarkers = [];
let locationWatchId = null;
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

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
        document.getElementById('container').style.display = 'block';

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

function sendPositionToServer(lat, lon) {
    const pseudo = localStorage.getItem('pseudo');
    fetch('/position', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            id: pseudo || 'utilisateur-local',
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

    if (!map) {
        console.warn('Carte non initialisée');
        return;
    }

    userMarkers.forEach(marker => map.removeLayer(marker));
    userMarkers = [];

    usersPositions.forEach(user => {
        if (user.lat && user.lon) {
            const marker = L.marker([user.lat, user.lon]).addTo(map)
                .bindPopup(`<b>Utilisateur</b><br>ID: ${user.id}<br>Latitude: ${user.lat}<br>Longitude: ${user.lon}`);
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

// Gestion des permissions de l'accéléromètre
document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            const permissionState = await DeviceMotionEvent.requestPermission();
            if (permissionState !== 'granted') {
                throw new Error('Accès refusé à l\'accéléromètre');
            }
        }
    } catch (error) {
        console.error('Erreur d\'accès à l\'accéléromètre :', error);
    }
});