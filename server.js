// server.js
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000; // Use environment variable for port

app.use(cors());
app.use(express.json());

// In-memory database
const players = {};

// Default player data structure for new players
const defaultPlayerData = {
    score: 0,
    // We can add more things here later, like upgrades
    // autoClickerLevel: 0,
    // clickMultiplier: 1,
};

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.send('Backend is running!');
});

// GET: Fetch a user's data
app.get('/player/:userId', (req, res) => {
    const { userId } = req.params;
    // If player doesn't exist, create them with default data
    if (!players[userId]) {
        players[userId] = { ...defaultPlayerData };
    }
    console.log(`[GET] User ${userId} data requested.`);
    res.json(players[userId]);
});

// POST: Update a user's score
app.post('/player/sync', (req, res) => {
    const { userId, score } = req.body;

    if (typeof userId === 'undefined' || typeof score === 'undefined') {
        return res.status(400).json({ error: 'Missing userId or score' });
    }

    // Ensure player exists before updating
    if (!players[userId]) {
        players[userId] = { ...defaultPlayerData };
    }

    players[userId].score = score;
    console.log(`[POST] Synced User ${userId} score to ${score}`);
    res.json({ success: true, message: 'Score synced.' });
});

app.listen(port, () => {
    console.log(`Backend server is running on port ${port}`);
});