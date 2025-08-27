// server.js
require('dotenv').config(); // To manage secret keys
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// --- Supabase Setup ---
// Put these in a .env file for security!
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());

// --- API Endpoints ---
app.get('/', (req, res) => res.send('Backend is running and connected to Supabase!'));

app.get('/player/:userId', async (req, res) => {
    const { userId } = req.params;

    // First, try to get the player
    let { data: player, error } = await supabase
        .from('players')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 means 'not found'
        console.error('Error fetching player:', error);
        return res.status(500).json({ error: error.message });
    }

    // If player not found, create them
    if (!player) {
        const { data: newPlayer, error: insertError } = await supabase
            .from('players')
            .insert({ user_id: userId })
            .select()
            .single();

        if (insertError) {
            console.error('Error creating player:', insertError);
            return res.status(500).json({ error: insertError.message });
        }
        player = newPlayer;
        console.log(`[GET] New player created: ${userId}`);
    } else {
        // Calculate offline progress for existing players
        const now = new Date();
        const lastUpdated = new Date(player.last_updated);
        const timeOffline = (now - lastUpdated) / 1000; // seconds
        const offlineEarnings = timeOffline * player.auto_click_rate;
        player.score = parseFloat(player.score) + offlineEarnings;
    }

    res.json(player);
});

app.post('/player/sync', async (req, res) => {
    const { userId, score } = req.body;

    if (!userId || typeof score === 'undefined') {
        return res.status(400).json({ error: 'Missing userId or score' });
    }

    const { error } = await supabase
        .from('players')
        .update({ score: score, last_updated: new Date().toISOString() })
        .eq('user_id', userId);

    if (error) {
        console.error('Error syncing score:', error);
        return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
});

app.listen(port, () => {
    console.log(`Backend server is running on port ${port}`);
});