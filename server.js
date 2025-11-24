require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Decimal } = require('decimal.js');

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Admin-ID', 'admin-id', 'X-Admin-ID']
}));

app.use(express.json());

const INTRA_TIER_COST_MULTIPLIER = new Decimal(1.215);
const upgrades = {
    click_tier_1: { id: 'click_tier_1', name: 'A Cups', benefit: new Decimal('0.000000001'), base_cost: new Decimal('0.000000064') },
    click_tier_2: { id: 'click_tier_2', name: 'B Cups', benefit: new Decimal('0.000000008'), base_cost: new Decimal('0.000001024') },
    click_tier_3: { id: 'click_tier_3', name: 'C Cups', benefit: new Decimal('0.000000064'), base_cost: new Decimal('0.000016384') },
    click_tier_4: { id: 'click_tier_4', name: 'D Cups', benefit: new Decimal('0.000000512'), base_cost: new Decimal('0.000262144') },
    click_tier_5: { id: 'click_tier_5', name: 'DD Cups', benefit: new Decimal('0.000004096'), base_cost: new Decimal('0.004194304') },

    auto_tier_1: { id: 'auto_tier_1', name: 'Basic Lotion', benefit: new Decimal('0.000000001'), base_cost: new Decimal('0.000000064') },
    auto_tier_2: { id: 'auto_tier_2', name: 'Enhanced Serum', benefit: new Decimal('0.000000008'), base_cost: new Decimal('0.000001024') },
    auto_tier_3: { id: 'auto_tier_3', name: 'Collagen Cream', benefit: new Decimal('0.000000064'), base_cost: new Decimal('0.000016384') },
    auto_tier_4: { id: 'auto_tier_4', name: 'Firming Gel', benefit: new Decimal('0.000000512'), base_cost: new Decimal('0.000262144') },
    auto_tier_5: { id: 'auto_tier_5', name: 'Miracle Elixir', benefit: new Decimal('0.000004096'), base_cost: new Decimal('0.004194304') },

    offline_tier_1: { id: 'offline_tier_1', name: 'Simple Bralette', benefit: new Decimal('0.000000001'), base_cost: new Decimal('0.000000064') },
    offline_tier_2: { id: 'offline_tier_2', name: 'Sports Bra', benefit: new Decimal('0.000000008'), base_cost: new Decimal('0.000001024') },
    offline_tier_3: { id: 'offline_tier_3', name: 'Padded Bra', benefit: new Decimal('0.000000064'), base_cost: new Decimal('0.000016384') },
    offline_tier_4: { id: 'offline_tier_4', name: 'Push-Up Bra', benefit: new Decimal('0.000000512'), base_cost: new Decimal('0.000262144') },
    offline_tier_5: { id: 'offline_tier_5', name: 'Designer Corset', benefit: new Decimal('0.000004096'), base_cost: new Decimal('0.004194304') },

};

app.get('/', (req, res) => res.send('Backend is running and connected to Supabase!'));

const authenticateAdmin = async (req, res, next) => {
    try {
        console.log('=== ADMIN BYPASS ACTIVE ===');
        const adminId = '71bf9556-b67f-4860-8219-270f32ccb89b';
        console.log('Using admin ID:', adminId);

        const { data: admin, error } = await supabase
            .from('admin_users')
            .select('*')
            .eq('user_id', adminId)
            .eq('is_active', true)
            .single();

        if (error || !admin) {
            console.log('❌ Admin not found in database');
            return res.status(403).json({ error: 'Admin access denied' });
        }

        console.log('✅ Admin access granted for:', adminId);
        req.admin = admin;
        next();
    } catch (error) {
        console.error('❌ Admin authentication failed:', error);
        res.status(500).json({ error: 'Admin authentication failed' });
    }
};

app.get('/player/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        let { data: player, error } = await supabase
            .from('players')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code === 'PGRST116') {
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

        const now = new Date();
        const lastUpdated = new Date(player.last_updated);
        const timeOfflineSeconds = (now - lastUpdated) / 1000;

        if (timeOfflineSeconds > 10) {
            const offlineEarnings = new Decimal(player.auto_click_rate)
                .times(timeOfflineSeconds)
                .plus(new Decimal(player.offline_rate_per_hour).times(timeOfflineSeconds / 3600));

            player.score = new Decimal(player.score).plus(offlineEarnings).toFixed(9);

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
    const { userId, score } = req.body;
    if (!userId || typeof score === 'undefined') return res.status(400).json({ error: 'Missing userId or score' });
    const { error } = await supabase.from('players').update({ score, last_updated: new Date().toISOString() }).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.post('/player/upgrade', async (req, res) => {
    const { userId, upgradeId } = req.body;
    if (!userId || !upgradeId) return res.status(400).json({ error: 'Missing userId or upgradeId' });

    const upgrade = upgrades[upgradeId];
    if (!upgrade) return res.status(404).json({ error: 'Upgrade not found' });

    try {
        const { data: player, error: fetchError } = await supabase.from('players').select('*').eq('user_id', userId).single();
        if (fetchError || !player) throw new Error('Player not found.');

        const playerScore = new Decimal(player.score);
        const levelColumn = `${upgradeId}_level`;
        const currentLevel = new Decimal(player[levelColumn] || 0);

        const cost = upgrade.base_cost.times(INTRA_TIER_COST_MULTIPLIER.pow(currentLevel));

        if (playerScore.lessThan(cost)) {
            return res.status(400).json({ error: 'Not enough coins.' });
        }

        const newScore = playerScore.minus(cost);
        const newLevel = currentLevel.plus(1);

        const updates = {
            score: newScore.toFixed(9),
            [levelColumn]: newLevel.toNumber(),
            last_updated: new Date().toISOString()
        };

        if (upgradeId.startsWith('click_')) {
            const newClickValue = new Decimal(player.click_value).plus(upgrade.benefit);
            updates.click_value = newClickValue.toFixed(9);
        } else if (upgradeId.startsWith('auto_')) {
            const newAutoClickRate = new Decimal(player.auto_click_rate).plus(upgrade.benefit);
            updates.auto_click_rate = newAutoClickRate.toFixed(9);
        }

        const { data: updatedPlayer, error: updateError } = await supabase
            .from('players')
            .update(updates)
            .eq('user_id', userId)
            .select()
            .single();

        if (updateError) throw updateError;

        res.json({ success: true, player: updatedPlayer });

        await supabase
            .from('user_logs')
            .insert({
                user_id: userId,
                username: player.username,
                action_type: 'upgrade_purchase',
                details: `Purchased ${upgradeId} for ${cost}`
            });
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

app.get('/wallet/history/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
    }

    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        const processedData = data.map(tx => ({
            ...tx,
            type: Number(tx.sender_id) === Number(userId) ? 'sent' : 'received'
        }));

        res.json(processedData);

    } catch (error) {
        console.error('Error fetching transaction history:', error);
        res.status(500).json({ error: 'Failed to fetch transaction history.' });
    }
});

app.post('/tasks/claim', async (req, res) => {
    // REMOVED: Unused player fetch logic since it wasn't connected to anything
    try {
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/wallet/transfer', async (req, res) => {
    const { senderId, receiverUsername, amount } = req.body;

    if (!senderId || !receiverUsername || !amount) {
        return res.status(400).json({ error: 'Invalid input. Missing fields.' });
    }
    const transferAmount = new Decimal(amount);
    if (transferAmount.isNegative() || transferAmount.isZero() || !transferAmount.isFinite()) {
        return res.status(400).json({ error: 'Invalid transfer amount.' });
    }

    try {
        const { data: receiver, error: receiverError } = await supabase
            .from('players')
            .select('user_id, score')
            .eq('username', receiverUsername)
            .single();

        if (receiverError || !receiver) {
            throw new Error(`Receiver user "${receiverUsername}" not found.`);
        }
        const receiverId = receiver.user_id;

        if (Number(senderId) === Number(receiverId)) {
            throw new Error("You cannot send coins to yourself.");
        }

        const { data: sender, error: senderError } = await supabase
            .from('players')
            .select('score')
            .eq('user_id', senderId)
            .single();

        if (senderError || !sender) {
            throw new Error("Sender user not found.");
        }
        const senderBalance = new Decimal(sender.score);
        if (senderBalance.lessThan(transferAmount)) {
            throw new Error("Insufficient funds.");
        }

        const newSenderScore = senderBalance.minus(transferAmount);
        const newReceiverScore = new Decimal(receiver.score).plus(transferAmount);

        const { error: updateSenderError } = await supabase
            .from('players')
            .update({ score: newSenderScore.toFixed(9) })
            .eq('user_id', senderId);

        if (updateSenderError) throw new Error('Failed to update sender balance.');

        const { error: updateReceiverError } = await supabase
            .from('players')
            .update({ score: newReceiverScore.toFixed(9) })
            .eq('user_id', receiverId);

        if (updateReceiverError) {
            await supabase.from('players').update({ score: senderBalance.toFixed(9) }).eq('user_id', senderId);
            throw new Error('Failed to update receiver balance. Transfer has been cancelled and refunded.');
        }

        const { error: logError } = await supabase
            .from('transactions')
            .insert({
                sender_id: senderId,
                receiver_id: receiverId,
                amount: transferAmount.toFixed(9),
                receiver_username: receiverUsername
            });

        if (logError) {
            console.error("CRITICAL: Transaction succeeded but logging failed!", logError);
        }

        res.json({ success: true, message: 'Transfer successful!' });

    } catch (error) {
        console.error('Transfer failed:', error.message);
        return res.status(500).json({ error: error.message || 'An unknown error occurred during the transfer.' });
    }
});

app.get('/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '' } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabase
            .from('players')
            .select('*', { count: 'exact' })
            .range(from, to);

        if (search) {
            query = query.or(`username.ilike.%${search}%,user_id.eq.${search}`);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        res.json({
            users: data,
            totalCount: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/users/:userId', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const updates = req.body;

        const { data, error } = await supabase
            .from('players')
            .update(updates)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        await supabase
            .from('admin_logs')
            .insert({
                admin_id: req.admin.user_id,
                action_type: 'update_user',
                target_user_id: userId,
                details: `Updated user data: ${JSON.stringify(updates)}`
            });

        res.json({ success: true, user: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/users/:userId/ban', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        const { data, error } = await supabase
            .from('players')
            .update({ is_banned: true })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        await supabase.from('admin_logs').insert({
            admin_id: req.admin.user_id,
            action_type: 'ban_user',
            target_user_id: userId,
            details: 'Banned user from the platform'
        });

        res.json({ success: true, user: data });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/users/:userId/unban', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        const { data, error } = await supabase
            .from('players')
            .update({ is_banned: false })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        await supabase.from('admin_logs').insert({
            admin_id: req.admin.user_id,
            action_type: 'unban_user',
            target_user_id: userId,
            details: 'Restored user access'
        });

        res.json({ success: true, user: data });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/user-logs', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20, userId } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabase
            .from('user_logs')
            .select('*', { count: 'exact' })
            .range(from, to)
            .order('created_at', { ascending: false });

        if (userId) {
            query = query.eq('user_id', userId);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        res.json({
            logs: data,
            totalCount: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/admin-logs', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        console.log('Fetching admin logs...');
        const { data, error, count } = await supabase
            .from('admin_logs')
            .select('*', { count: 'exact' })
            .range(from, to)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching admin logs:', error);
            throw error;
        }

        res.json({
            logs: data || [],
            totalCount: count || 0,
            totalPages: Math.ceil((count || 0) / limit),
            currentPage: parseInt(page)
        });
    } catch (error) {
        console.error('❌ Error in /admin/admin-logs:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        console.log('=== ADMIN STATS REQUEST ===');
        console.log('Admin making request:', req.admin.user_id);

        const { count: totalUsers, error: totalUsersError } = await supabase
            .from('players')
            .select('*', { count: 'exact', head: true });

        if (totalUsersError) throw totalUsersError;

        const today = new Date().toISOString().split('T')[0];
        const { count: activeToday, error: activeTodayError } = await supabase
            .from('players')
            .select('*', { count: 'exact', head: true })
            .gte('last_updated', today);

        if (activeTodayError) throw activeTodayError;

        const { count: bannedUsers, error: bannedUsersError } = await supabase
            .from('players')
            .select('*', { count: 'exact', head: true })
            .eq('is_banned', true);

        if (bannedUsersError) throw bannedUsersError;

        res.json({
            totalUsers: totalUsers || 0,
            activeToday: activeToday || 0,
            bannedUsers: bannedUsers || 0,
            totalClicks: 0
        });
    } catch (error) {
        console.error('❌ Error in /admin/stats:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/transactions', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data, error, count } = await supabase
            .from('transactions')
            .select('*', { count: 'exact' })
            .range(from, to)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            transactions: data,
            totalCount: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page)
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/users/:userId/make-admin', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase
            .from('admin_users')
            .insert({
                user_id: userId,
                is_active: true,
                created_by: req.admin.user_id
            })
            .select()
            .single();

        if (error) throw error;

        await supabase
            .from('admin_logs')
            .insert({
                admin_id: req.admin.user_id,
                action_type: 'make_admin',
                target_user_id: userId,
                details: 'User promoted to admin'
            });

        res.json({ success: true, admin: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/users/:userId/remove-admin', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase
            .from('admin_users')
            .update({ is_active: false })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        await supabase
            .from('admin_logs')
            .insert({
                admin_id: req.admin.user_id,
                action_type: 'remove_admin',
                target_user_id: userId,
                details: 'Admin privileges removed'
            });

        res.json({ success: true, admin: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.post('/admin/users/:userId/reset-score', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        await supabase.from('players').update({ score: 0 }).eq('user_id', userId);

        await supabase.from('admin_logs').insert({
            admin_id: req.admin.user_id,
            action_type: 'reset_score',
            target_user_id: userId,
            details: 'Score reset to 0'
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/users/:userId/add-coins', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { amount } = req.body;

        
        const { data: user } = await supabase.from('players').select('score').eq('user_id', userId).single();
        const newScore = new Decimal(user.score).plus(new Decimal(amount)).toFixed(9);

        const { data: updatedUser, error } = await supabase
            .from('players')
            .update({ score: newScore, last_updated: new Date().toISOString() })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

       
        await supabase.from('admin_logs').insert({
            admin_id: req.admin.user_id,
            action_type: 'add_coins', 
            target_user_id: userId,
            details: `Added ${amount} coins. Old: ${user.score}, New: ${newScore}`
        });

        res.json({ success: true, user: updatedUser });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/users/:userId/reset-upgrades', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        const resetData = {
            click_value: '0.000000001',
            auto_click_rate: '0.000000001',
            click_tier_1_level: 0,
            click_tier_2_level: 0,
            click_tier_3_level: 0,
            click_tier_4_level: 0,
            click_tier_5_level: 0,
            auto_tier_1_level: 0,
            auto_tier_2_level: 0,
            auto_tier_3_level: 0,
            auto_tier_4_level: 0,
            auto_tier_5_level: 0,
            last_updated: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('players')
            .update(resetData)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        await supabase.from('admin_logs').insert({
            admin_id: req.admin.user_id,
            action_type: 'reset_upgrades',
            target_user_id: userId,
            details: 'Reset all upgrades and multipliers to default'
        });

        res.json({ success: true, user: data });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/users/:userId/delete', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: user } = await supabase.from('players').select('username').eq('user_id', userId).single();
        const username = user ? user.username : 'Unknown';

        const { error } = await supabase
            .from('players')
            .delete()
            .eq('user_id', userId);

        if (error) throw error;

        await supabase.from('admin_logs').insert({
            admin_id: req.admin.user_id,
            action_type: 'delete_user',
            target_user_id: userId,
            details: `Permanently deleted user: ${username}`
        });

        res.json({ success: true, message: 'User deleted successfully' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => console.log(`Backend server is running on port ${port}`));