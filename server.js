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
    click_tier_2: { id: 'click_tier_2', name: 'B Cups', benefit: new Decimal('0.000000008'), base_cost: new Decimal('0.000001024') },
    click_tier_3: { id: 'click_tier_3', name: 'C Cups', benefit: new Decimal('0.000000064'), base_cost: new Decimal('0.000016384') },
    click_tier_4: { id: 'click_tier_4', name: 'D Cups', benefit: new Decimal('0.000000512'), base_cost: new Decimal('0.000262144') },
    click_tier_5: { id: 'click_tier_5', name: 'DD Cups', benefit: new Decimal('0.000004096'), base_cost: new Decimal('0.004194304') },

    // AUTO (PER SECOND) UPGRADES
    auto_tier_1: { id: 'auto_tier_1', name: 'Basic Lotion', benefit: new Decimal('0.000000001'), base_cost: new Decimal('0.000000064') },
    auto_tier_2: { id: 'auto_tier_2', name: 'Enhanced Serum', benefit: new Decimal('0.000000008'), base_cost: new Decimal('0.000001024') },
    auto_tier_3: { id: 'auto_tier_3', name: 'Collagen Cream', benefit: new Decimal('0.000000064'), base_cost: new Decimal('0.000016384') },
    auto_tier_4: { id: 'auto_tier_4', name: 'Firming Gel', benefit: new Decimal('0.000000512'), base_cost: new Decimal('0.000262144') },
    auto_tier_5: { id: 'auto_tier_5', name: 'Miracle Elixir', benefit: new Decimal('0.000004096'), base_cost: new Decimal('0.004194304') },

    // OFFLINE UPGRADES
    offline_tier_1: { id: 'offline_tier_1', name: 'Simple Bralette', benefit: new Decimal('0.000000001'), base_cost: new Decimal('0.000000064') },
    offline_tier_2: { id: 'offline_tier_2', name: 'Sports Bra', benefit: new Decimal('0.000000008'), base_cost: new Decimal('0.000001024') },
    offline_tier_3: { id: 'offline_tier_3', name: 'Padded Bra', benefit: new Decimal('0.000000064'), base_cost: new Decimal('0.000016384') },
    offline_tier_4: { id: 'offline_tier_4', name: 'Push-Up Bra', benefit: new Decimal('0.000000512'), base_cost: new Decimal('0.000262144') },
    offline_tier_5: { id: 'offline_tier_5', name: 'Designer Corset', benefit: new Decimal('0.000004096'), base_cost: new Decimal('0.004194304') },

};

// --- API Endpoints ---
app.get('/', (req, res) => res.send('Backend is running and connected to Supabase!'));

app.get('/player/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        // Try to get the player
        let { data: player, error } = await supabase
            .from('players')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code === 'PGRST116') { // No rows found
            // Create a new player with default values
            const { data: newPlayer, error: insertError } = await supabase
                .from('players')
                .insert({
                    user_id: userId,
                    score: 0,
                    click_value: 0.000000001,
                    auto_click_rate: 0.000000001,
                    offline_rate_per_hour: 0.000000001
                })
                .select()
                .single();

            if (insertError) throw insertError;
            player = newPlayer;
        } else if (error) {
            throw error;
        }

        // Calculate offline earnings if needed
        const now = new Date();
        const lastUpdated = new Date(player.last_updated);
        const timeOfflineSeconds = (now - lastUpdated) / 1000;

        if (timeOfflineSeconds > 10) {
            const offlineEarnings = new Decimal(player.auto_click_rate)
                .times(timeOfflineSeconds)
                .plus(new Decimal(player.offline_rate_per_hour).times(timeOfflineSeconds / 3600));

            player.score = new Decimal(player.score).plus(offlineEarnings).toFixed(9);

            // Update the last_updated timestamp
            await supabase
                .from('players')
                .update({
                    score: player.score,
                    last_updated: now.toISOString()
                })
                .eq('user_id', userId);
        }

        res.json({
            ...player,
            profile_photo_url: player.profile_photo_url
        });
    } catch (error) {
        console.error('Error fetching player:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/player/syncProfile', async (req, res) => {
    const { user_id, username, first_name, last_name, language_code, photo_url } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

    try {
        const { error } = await supabase.from('players').upsert(
            {
                user_id,
                username,
                first_name,
                last_name,
                language_code,
                profile_photo_url: photo_url,
                last_updated: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
        );
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('syncProfile failed:', err);
        res.status(500).json({ error: err.message });
    }
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

app.get('/leaderboard/:sortBy', async (req, res) => {
    const { sortBy } = req.params;
    const validSorts = ['score', 'click_value', 'auto_click_rate'];

    if (!validSorts.includes(sortBy)) {
        return res.status(400).json({ error: 'Invalid sort parameter.' });
    }

    try {
        const { data, error } = await supabase
            .from('players')
            .select('username, profile_photo_url, score, click_value, auto_click_rate')
            .order(sortBy, { ascending: false })
            .limit(10);

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error(`Error fetching leaderboard for ${sortBy}:`, error);
        res.status(500).json({ error: 'Failed to fetch leaderboard data.' });
    }
});

app.listen(port, () => console.log(`Backend server is running on port ${port}`));