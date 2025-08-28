// server.js - MERGED AND ENHANCED
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Decimal } = require('decimal.js');

const app = express();
const port = process.env.PORT || 3000;

// --- Supabase Setup ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());

// --- Game Constants (from your old project) ---
const INTRA_TIER_COST_MULTIPLIER = new Decimal(1.215);
const upgrades = {
    click_tier_1: { id: 'click_tier_1', name: 'A Cups', benefit: new Decimal('0.000000001'), base_cost: new Decimal('0.000000064') },
    auto_tier_1: { id: 'auto_tier_1', name: 'Basic Lotion', benefit: new Decimal('0.000000001'), base_cost: new Decimal('0.000000064') },
    // Add more upgrades here from your old project as needed
};

// --- API Endpoints ---
app.get('/', (req, res) => res.send('Backend is running and connected to Supabase!'));

app.get('/player/:userId', async (req, res) => {
    // This endpoint is already robust and works well. No changes needed here.
    const { userId } = req.params;
    let { data: player, error } = await supabase.from('players').select('*').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
    if (!player) {
        const { data: newPlayer, error: insertError } = await supabase.from('players').insert({ user_id: userId }).select().single();
        if (insertError) return res.status(500).json({ error: insertError.message });
        player = newPlayer;
    } else {
        const now = new Date();
        const lastUpdated = new Date(player.last_updated);
        const timeOffline = (now - lastUpdated) / 1000;
        if (timeOffline > 10) {
            const offlineEarnings = timeOffline * parseFloat(player.auto_click_rate);
            player.score = parseFloat(player.score) + offlineEarnings;
        }
    }
    res.json(player);
});

app.post('/player/sync', async (req, res) => {
    // This endpoint is also fine.
    const { userId, score } = req.body;
    if (!userId || typeof score === 'undefined') return res.status(400).json({ error: 'Missing userId or score' });
    const { error } = await supabase.from('players').update({ score, last_updated: new Date().toISOString() }).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// --- NEW UPGRADE ENDPOINT ---
app.post('/player/upgrade', async (req, res) => {
    const { userId, upgradeId } = req.body;
    if (!userId || !upgradeId) return res.status(400).json({ error: 'Missing userId or upgradeId' });

    const upgrade = upgrades[upgradeId];
    if (!upgrade) return res.status(404).json({ error: 'Upgrade not found' });

    try {
        // 1. Fetch the latest player data
        const { data: player, error: fetchError } = await supabase.from('players').select('*').eq('user_id', userId).single();
        if (fetchError || !player) throw new Error('Player not found.');

        const playerScore = new Decimal(player.score);
        const levelColumn = `${upgradeId}_level`;
        const currentLevel = new Decimal(player[levelColumn] || 0);

        // 2. Calculate the cost of the next level
        const cost = upgrade.base_cost.times(INTRA_TIER_COST_MULTIPLIER.pow(currentLevel));

        // 3. Check if the player has enough score
        if (playerScore.lessThan(cost)) {
            return res.status(400).json({ error: 'Not enough coins.' });
        }

        // 4. Prepare the data to be updated
        const newScore = playerScore.minus(cost);
        const newLevel = currentLevel.plus(1);

        const updates = {
            score: newScore.toFixed(9),
            [levelColumn]: newLevel.toNumber(),
            last_updated: new Date().toISOString()
        };

        // 5. Update click value or auto-click rate based on the upgrade type
        if (upgradeId.startsWith('click_')) {
            const newClickValue = new Decimal(player.click_value).plus(upgrade.benefit);
            updates.click_value = newClickValue.toFixed(9);
        } else if (upgradeId.startsWith('auto_')) {
            const newAutoClickRate = new Decimal(player.auto_click_rate).plus(upgrade.benefit);
            updates.auto_click_rate = newAutoClickRate.toFixed(9);
        }

        // 6. Push the updates to Supabase
        const { data: updatedPlayer, error: updateError } = await supabase
            .from('players')
            .update(updates)
            .eq('user_id', userId)
            .select()
            .single();

        if (updateError) throw updateError;

        res.json({ success: true, player: updatedPlayer });

    } catch (error) {
        console.error(`Upgrade error for user ${userId}, upgrade ${upgradeId}:`, error);
        res.status(500).json({ error: 'Failed to purchase upgrade.' });
    }
});

app.listen(port, () => console.log(`Backend server is running on port ${port}`));