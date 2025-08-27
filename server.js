// server.js
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const players = {};

// New, more detailed player data structure
const defaultPlayerData = {
    score: 0.0,
    autoClickRate: 0.000000001, // Passive income per second
    lastUpdated: Date.now()
};

app.get('/', (req, res) => {
    res.send('Backend is running!');
});

app.get('/player/:userId', (req, res) => {
    const { userId } = req.params;
    if (!players[userId]) {
        players[userId] = { ...defaultPlayerData };
    }
    // Calculate offline progress (optional but good practice)
    const now = Date.now();
    const timeOffline = (now - players[userId].lastUpdated) / 1000; // seconds
    const offlineEarnings = timeOffline * players[userId].autoClickRate;
    players[userId].score += offlineEarnings;
    players[userId].lastUpdated = now;

    console.log(`[GET] User ${userId} data requested. Granted ${offlineEarnings.toFixed(9)} for offline time.`);
    res.json(players[userId]);
});

app.post('/player/sync', (req, res) => {
    const { userId, score } = req.body;
    if (typeof userId === 'undefined' || typeof score === 'undefined') {
        return res.status(400).json({ error: 'Missing userId or score' });
    }
    if (!players[userId]) {
        players[userId] = { ...defaultPlayerData };
    }
    players[userId].score = score;
    players[userId].lastUpdated = Date.now(); // Update timestamp on sync
    // Don't log every sync to avoid spamming logs, or make it less verbose
    // console.log(`[POST] Synced User ${userId} score to ${score.toFixed(9)}`);
    res.json({ success: true });
});

app.listen(port, () => {
    console.log(`Backend server is running on port ${port}`);
});