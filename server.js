// server.js
const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;

// --- Middleware ---
app.use(cors()); // Allow requests from your Mini App's URL
app.use(express.json()); // Allow the server to read JSON from requests

// --- In-Memory Database (for simplicity) ---
// This will store scores. When the server restarts, data is lost.
// For a real app, you would use a database like PostgreSQL or MongoDB.
const playerScores = {};

// --- API Endpoints ---

// GET: Fetch a user's score
app.get('/score/:userId', (req, res) => {
    const { userId } = req.params;
    const score = playerScores[userId] || 0; // Return 0 if the user is new
    console.log(`[GET] User ${userId} score is ${score}`);
    res.json({ score });
});

// POST: Update a user's score
app.post('/score', (req, res) => {
    const { userId, score } = req.body;

    // Basic validation
    if (typeof userId === 'undefined' || typeof score === 'undefined') {
        return res.status(400).json({ error: 'Missing userId or score' });
    }

    playerScores[userId] = score;
    console.log(`[POST] Updated User ${userId} score to ${score}`);
    res.json({ success: true, message: 'Score updated.' });
});

// --- Start the Server ---
app.listen(port, () => {
    console.log(`Backend server is running on http://localhost:${port}`);
});