require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Decimal } = require('decimal.js');

const app = express();
const port = process.env.PORT || 3000;

const SOLO_BET_CUTOFF_MS = 20 * 1000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Admin-ID',
    'admin-id',
    'X-Admin-ID',
    'x-user-id',
    'x-admin-secret'
  ],
}));

app.use(express.json());

const INTRA_TIER_COST_MULTIPLIER = new Decimal(1.215);
const SOLO_MIN_PLAYERS = 2;
const SOLO_DURATION_MS = 5 * 60 * 1000;
const TEAM_DURATION_MS = 10 * 60 * 1000;
const HOUSE_FEE_RATE = new Decimal('0.01');

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

function safeDecimal(v) {
  try {
    return new Decimal(v || 0);
  } catch {
    return new Decimal(0);
  }
}

function requireUser(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Missing user identity' });
  }
  req.userId = String(userId);
  next();
}

app.get('/', (req, res) => res.send('Backend is running and connected to Supabase!'));

const authenticateAdmin = (req, res, next) => {
  const token = req.headers['x-admin-secret'];
  const expected = process.env.ADMIN_SECRET;

  if (!expected || token !== expected) {
    console.log('Admin auth failed:', {
      received: token,
      expected: expected ? '***' : 'undefined'
    });
    return res.status(403).json({ error: 'Forbidden' });
  }

  req.admin = { user_id: 'admin-panel' };
  next();
};

app.get("/player/:userId", requireUser, async (req, res) => {
  const userId = req.userId;
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
          offline_rate_per_hour: 0.000000001,
        })
        .select()
        .single();
      if (insertError) throw insertError;
      player = newPlayer;
    } else if (error) {
      throw error;
    }

    const now = new Date();
    const lastUpdated = new Date(player.last_updated || now.toISOString());
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
          last_updated: now.toISOString(),
        })
        .eq('user_id', userId);

      await supabase.from('user_logs').insert({
        user_id: userId,
        username: player.username || 'Unknown',
        action_type: 'offline_earnings',
        details: `Earned ${offlineEarnings.toFixed(9)} coins while offline for ${Math.floor(timeOfflineSeconds)}s`,
      });
    }

    res.json({
      ...player,
      profile_photo_url: player.profile_photo_url,
    });
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/enhanced-transaction-details', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data: transactions, error, count } = await supabase
            .from('transactions')
            .select('*', { count: 'exact' })
            .range(from, to)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const enhancedTransactions = await Promise.all(
            transactions.map(async (tx) => {
                const [sender, receiver] = await Promise.all([
                    supabase.from('players').select('username, first_name, last_name, profile_photo_url').eq('user_id', tx.sender_id).single(),
                    supabase.from('players').select('username, first_name, last_name, profile_photo_url').eq('user_id', tx.receiver_id).single()
                ]);

                return {
                    ...tx,
                    sender_name: sender.data?.first_name || sender.data?.username || 'Unknown',
                    sender_username: sender.data?.username,
                    sender_photo_url: sender.data?.profile_photo_url,
                    receiver_name: receiver.data?.first_name || receiver.data?.username || 'Unknown',
                    receiver_username: receiver.data?.username,
                    receiver_photo_url: receiver.data?.profile_photo_url
                };
            })
        );

        res.json({
            transactions: enhancedTransactions,
            totalCount: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/maintenance-status', authenticateAdmin, async (req, res) => {
    try {
        res.json({
            maintenance_mode: false,
            message: "System is running normally"
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/player/syncProfile', requireUser, async (req, res) => {
  const user_id = req.userId;
  const { username, first_name, last_name, language_code, photo_url } = req.body;

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
      { onConflict: 'user_id' },
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('syncProfile failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/player/sync', requireUser, async (req, res) => {
  const userId = req.userId;
  const { score } = req.body;

  if (!userId || typeof score === 'undefined') {
    return res.status(400).json({ error: 'Missing userId or score' });
  }

  const { error } = await supabase
    .from('players')
    .update({ score, last_updated: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/admin/user-details/:userId', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { data: user, error } = await supabase
            .from('players')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) throw error;

        res.json({
            success: true,
            user: {
                id: user.user_id,
                username: user.username,
                first_name: user.first_name,
                last_name: user.last_name,
                profile_photo_url: user.profile_photo_url,
                score: user.score,
                click_value: user.click_value,
                auto_click_rate: user.auto_click_rate,
                is_banned: user.is_banned,
                is_admin: user.is_admin,
                last_updated: user.last_updated
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/transaction-details', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 15, search = '' } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabase
            .from('transactions')
            .select('*', { count: 'exact' });

        if (search) {
            try {
                const { freeText, filters } = JSON.parse(search);
                if (freeText) {
                    // Search in amounts or related user names (requires joins, but supabase simple query is limited)
                    // For now, search ID or Amount
                    query = query.or(`id.eq.${freeText},amount.ilike.%${freeText}%`);
                }
                if (filters && Array.isArray(filters)) {
                    filters.forEach(f => {
                        const key = f.key.replace(':', '');
                        const val = f.value;
                        if (key === 'user') query = query.or(`sender_id.eq.${val},receiver_id.eq.${val}`);
                        else if (key === 'sender') query = query.eq('sender_id', val);
                        else if (key === 'receiver') query = query.eq('receiver_id', val);
                        else if (key === 'status') query = query.eq('status', val);
                        else if (key === 'date') query = query.gte('created_at', val).lte('created_at', val + 'T23:59:59');
                        else if (key === 'before') query = query.lte('created_at', val);
                        else if (key === 'after') query = query.gte('created_at', val);
                    });
                }
            } catch (e) {
                 // Fallback
            }
        }

        query = query.order('created_at', { ascending: false })
            .range(from, to);

        const { data: transactions, error, count } = await query;

        if (error) throw error;

        const enhancedTransactions = await Promise.all(
            transactions.map(async (tx) => {
                const [sender, receiver] = await Promise.all([
                    supabase.from('players').select('username, first_name, last_name, profile_photo_url').eq('user_id', tx.sender_id).single(),
                    supabase.from('players').select('username, first_name, last_name, profile_photo_url').eq('user_id', tx.receiver_id).single()
                ]);

                return {
                    ...tx,
                    sender_name: sender.data?.first_name || sender.data?.username || 'Unknown',
                    sender_username: sender.data?.username,
                    sender_photo_url: sender.data?.profile_photo_url,
                    receiver_name: receiver.data?.first_name || receiver.data?.username || 'Unknown',
                    receiver_username: receiver.data?.username,
                    receiver_photo_url: receiver.data?.profile_photo_url
                };
            })
        );

        res.json({
            transactions: enhancedTransactions,
            totalCount: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/maintenance-status', authenticateAdmin, async (req, res) => {
    try {
        const { maintenance_mode, message } = req.body;
        
        const { error: modeError } = await supabase
            .from('config')
            .upsert({ key: 'maintenance_mode', value: String(maintenance_mode) }, { onConflict: 'key' });
            
        if (modeError) throw modeError;
        
        if (message) {
            const { error: msgError } = await supabase
                .from('config')
                .upsert({ key: 'maintenance_message', value: message }, { onConflict: 'key' });
            if (msgError) throw msgError;
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/broadcast', authenticateAdmin, async (req, res) => {
    try {
        const { message, type, is_active } = req.body;
        
        if (message) {
            const { error: msgError } = await supabase
                .from('config')
                .upsert({ key: 'broadcast_message', value: message }, { onConflict: 'key' });
            if (msgError) throw msgError;
        }

        if (type) {
             const { error: typeError } = await supabase
                .from('config')
                .upsert({ key: 'broadcast_type', value: type }, { onConflict: 'key' });
            if (typeError) throw typeError;
        }
        
        if (typeof is_active !== 'undefined') {
            const { error: activeError } = await supabase
                .from('config')
                .upsert({ key: 'broadcast_active', value: String(is_active) }, { onConflict: 'key' });
            if (activeError) throw activeError;
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/enhanced-user-logs', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 15, search = '' } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabase
            .from('user_logs')
            .select('*', { count: 'exact' });

        if (search) {
            try {
                const { freeText, filters } = JSON.parse(search);
                if (freeText) {
                    query = query.or(`details.ilike.%${freeText}%,action_type.ilike.%${freeText}%`);
                }
                if (filters && Array.isArray(filters)) {
                    filters.forEach(f => {
                        const key = f.key.replace(':', '');
                        const val = f.value;
                        if (key === 'user') query = query.eq('user_id', val);
                        else if (key === 'action') query = query.eq('action_type', val);
                        else if (key === 'date') query = query.gte('created_at', val).lte('created_at', val + 'T23:59:59');
                        else if (key === 'before') query = query.lte('created_at', val);
                        else if (key === 'after') query = query.gte('created_at', val);
                    });
                }
            } catch (e) {
                query = query.or(`details.ilike.%${search}%,action_type.ilike.%${search}%`);
            }
        }

        query = query.order('created_at', { ascending: false })
            .range(from, to);

        const { data: logs, error, count } = await query;
        if (error) throw error;

        const enhancedLogs = await Promise.all(
            logs.map(async (log) => {
                const { data: user } = await supabase
                    .from('players')
                    .select('username, first_name, last_name, profile_photo_url')
                    .eq('user_id', log.user_id)
                    .single();

                return {
                    ...log,
                    username: user?.username || 'Unknown',
                    first_name: user?.first_name,
                    last_name: user?.last_name,
                    photo_url: user?.profile_photo_url
                };
            })
        );

        res.json({
            logs: enhancedLogs,
            totalCount: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/enhanced-admin-logs', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 15, search = '' } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabase
            .from('admin_logs')
            .select('*', { count: 'exact' });

        if (search) {
            try {
                const { freeText, filters } = JSON.parse(search);
                if (freeText) {
                    query = query.or(`details.ilike.%${freeText}%,action_type.ilike.%${freeText}%`);
                }
                if (filters && Array.isArray(filters)) {
                    filters.forEach(f => {
                        const key = f.key.replace(':', '');
                        const val = f.value;
                        if (key === 'admin') query = query.eq('admin_id', val);
                        else if (key === 'target') query = query.eq('target_user_id', val);
                        else if (key === 'action') query = query.eq('action_type', val);
                        else if (key === 'date') query = query.gte('created_at', val).lte('created_at', val + 'T23:59:59');
                        else if (key === 'before') query = query.lte('created_at', val);
                        else if (key === 'after') query = query.gte('created_at', val);
                    });
                }
            } catch (e) {
                query = query.or(`details.ilike.%${search}%,action_type.ilike.%${search}%`);
            }
        }

        query = query.order('created_at', { ascending: false })
            .range(from, to);

        const { data: logs, error, count } = await query;
        if (error) throw error;

        const enhancedLogs = await Promise.all(
            logs.map(async (log) => {
                let formattedDetails = log.details;
                try {
                    const parsed = JSON.parse(log.details);
                    formattedDetails = JSON.stringify(parsed, null, 2);
                } catch (e) {}

                const [admin, target] = await Promise.all([
                    log.admin_id !== 'system' ? 
                        supabase.from('players').select('username, first_name, last_name, profile_photo_url').eq('user_id', log.admin_id).single() : 
                        { data: null },
                    log.target_user_id ? 
                        supabase.from('players').select('username, first_name, last_name, profile_photo_url').eq('user_id', log.target_user_id).single() : 
                        { data: null }
                ]);

                return {
                    ...log,
                    formatted_details: formattedDetails,
                    admin_first_name: admin.data?.first_name,
                    admin_username: admin.data?.username,
                    admin_photo_url: admin.data?.profile_photo_url,
                    target_first_name: target.data?.first_name,
                    target_last_name: target.data?.last_name,
                    target_username: target.data?.username,
                    target_photo_url: target.data?.profile_photo_url
                };
            })
        );

        res.json({
            logs: enhancedLogs,
            totalCount: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/player/upgrade', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { upgradeId } = req.body;

    if (!userId || !upgradeId) {
      return res.status(400).json({ success: false, error: 'Missing userId or upgradeId.' });
    }

    const upgrade = upgrades[upgradeId];
    if (!upgrade) {
      return res.status(400).json({ success: false, error: 'Invalid upgrade.' });
    }

    const { data: player, error: fetchError } = await supabase
      .from('players')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (fetchError || !player) throw new Error('Player not found.');

    const playerScore = new Decimal(player.score);
    const levelColumn = `${upgradeId}_level`;
    const currentLevel = new Decimal(player[levelColumn] || 0);

    const cost = upgrade.base_cost.times(INTRA_TIER_COST_MULTIPLIER.pow(currentLevel));
    if (playerScore.lessThan(cost)) {
      return res.status(400).json({ success: false, error: 'Not enough coins.' });
    }

    const newScore = playerScore.minus(cost);
    const newLevel = currentLevel.plus(1);

    const updates = {
      score: newScore.toFixed(9),
      [levelColumn]: newLevel.toNumber(),
      last_updated: new Date().toISOString(),
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

    await supabase.from('user_logs').insert({
      user_id: userId,
      username: player.username,
      action_type: 'upgrade_purchase',
      details: `Purchased ${upgradeId} for ${cost}`,
    });
  } catch (error) {
    console.error(`Upgrade error:`, error);
    res.status(500).json({ success: false, error: 'Failed to purchase upgrade.' });
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
      .select('username, first_name, last_name, profile_photo_url, score, click_value, auto_click_rate')
      .order(sortBy, { ascending: false })
      .limit(10);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error(`Error fetching leaderboard for ${sortBy}:`, error);
    res.status(500).json({ error: 'Failed to fetch leaderboard data.' });
  }
});

app.get('/wallet/history/:userId', requireUser, async (req, res) => {
  const userId = req.userId;
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
      type: Number(tx.sender_id) === Number(userId) ? 'sent' : 'received',
    }));

    res.json(processedData);
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ error: 'Failed to fetch transaction history.' });
  }
});

app.post('/wallet/transfer', requireUser, async (req, res) => {
  const senderId = req.userId;
  const { receiverUsername, amount } = req.body;

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
      throw new Error('You cannot send coins to yourself.');
    }

    const { data: sender, error: senderError } = await supabase
      .from('players')
      .select('score')
      .eq('user_id', senderId)
      .single();

    if (senderError || !sender) {
      throw new Error('Sender user not found.');
    }
    const senderBalance = new Decimal(sender.score);
    if (senderBalance.lessThan(transferAmount)) {
      throw new Error('Insufficient funds.');
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
        receiver_username: receiverUsername,
      });

    if (logError) {
      console.error('CRITICAL: Transaction succeeded but logging failed!', logError);
    }

    res.json({ success: true, message: 'Transfer successful!' });
  } catch (error) {
    console.error('Transfer failed:', error.message);
    return res.status(500).json({ error: error.message || 'An unknown error occurred during the transfer.' });
  }
});

app.post('/tasks/claim', async (req, res) => {
  try {
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function defaultGameState() {
  return {
    solo: {
      pot: '0',
      participants: [],
      endTime: null,
      isActive: false,
    },
    team: {
      teams: [],
      pot: '0',
      endTime: null,
      isActive: false,
    },
    recentWinners: [],
    yourBets: {
      solo: '0',
      team: null,
    },
  };
}

async function saveUserGameState(userId, state) {
  const { error } = await supabase
    .from('game_state')
    .upsert(
      {
        user_id: 'global',
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) throw error;
}

app.get('/games/state/:userId', requireUser, async (req, res) => {
  try {
    const userId = req.userId;

    const { data: gameRow, error } = await supabase
      .from('game_state')
      .select('*')
      .eq('user_id', 'global')
      .single();

    if (error && error.code === 'PGRST116') {
      return res.json(defaultGameState());
    } else if (error) {
      throw error;
    }

    return res.json(gameRow.state || defaultGameState());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/games/join-solo', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { betAmount } = req.body;
    const bet = safeDecimal(betAmount);

    if (!userId || bet.lte(0)) {
      return res.status(400).json({ error: 'Invalid userId or bet amount' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('score, username, first_name, last_name, profile_photo_url')
      .eq('user_id', userId)
      .single();

    if (playerError || !player) throw new Error('Player not found');

    const balance = safeDecimal(player.score);
    if (balance.lt(bet)) {
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    const { data: gameRow, error: gameError } = await supabase
      .from('game_state')
      .select('*')
      .eq('user_id', 'global')
      .single();

    let state;
    if (gameError && gameError.code === 'PGRST116') {
      state = defaultGameState();
    } else if (gameError) {
      throw gameError;
    } else {
      state = gameRow.state || defaultGameState();
    }

    const solo = state.solo || defaultGameState().solo;

    if (solo.isActive && solo.endTime) {
      const now = new Date();
      const end = new Date(solo.endTime);
      const msLeft = end - now;

      if (msLeft <= SOLO_BET_CUTOFF_MS) {
        return res.status(400).json({ error: 'Betting closed for this round' });
      }
    }

    solo.pot = safeDecimal(solo.pot).plus(bet).toFixed(9);

    solo.participants = solo.participants || [];
    const idx = solo.participants.findIndex(p => String(p.userId) === String(userId));
    if (idx >= 0) {
      const prev = safeDecimal(solo.participants[idx].bet);
      solo.participants[idx].bet = prev.plus(bet).toFixed(9);
      solo.participants[idx].username = player.username || null;
      solo.participants[idx].first_name = player.first_name || null;
      solo.participants[idx].last_name = player.last_name || null;
      solo.participants[idx].profile_photo_url = player.profile_photo_url || null;
    } else {
      solo.participants.push({
        userId,
        username: player.username || null,
        first_name: player.first_name || null,
        last_name: player.last_name || null,
        profile_photo_url: player.profile_photo_url || null,
        bet: bet.toFixed(9),
      });
    }

    if (solo.participants.length >= SOLO_MIN_PLAYERS) {
      if (!solo.isActive) {
        solo.isActive = true;
        solo.endTime = new Date(Date.now() + SOLO_DURATION_MS).toISOString();
      }
    } else {
      solo.isActive = false;
      solo.endTime = null;
    }

    state.solo = solo;
    state.yourBets = state.yourBets || { solo: '0', team: null };
    state.yourBets.solo = safeDecimal(state.yourBets.solo).plus(bet).toFixed(9);

    const newScore = balance.minus(bet);
    await supabase
      .from('players')
      .update({
        score: newScore.toFixed(9),
        last_updated: new Date().toISOString(),
      })
      .eq('user_id', userId);

    await saveUserGameState(userId, state);

    res.json({ success: true, state, newBalance: newScore.toFixed(9) });
  } catch (e) {
    console.error('join-solo failed', e);
    res.status(500).json({ error: e.message || 'Join failed' });
  }
});

app.post('/games/draw-solo', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: gameRow, error } = await supabase
      .from('game_state')
      .select('*')
      .eq('user_id', 'global')
      .single();

    if (error) throw error;

    const state = gameRow.state || defaultGameState();
    const solo = state.solo || defaultGameState().solo;

    if (!solo.isActive) {
      return res.status(400).json({ error: 'No active solo game' });
    }

    const now = new Date();
    if (!solo.endTime || new Date(solo.endTime) > now) {
      return res.status(400).json({ error: 'Game not finished yet' });
    }

    const participants = solo.participants || [];
    if (participants.length < SOLO_MIN_PLAYERS) {
      for (const p of participants) {
        const bet = safeDecimal(p.bet);
        if (bet.lte(0)) continue;

        const { data: pl } = await supabase
          .from('players')
          .select('score')
          .eq('user_id', p.userId)
          .single();
        if (!pl) continue;

        const newScore = safeDecimal(pl.score).plus(bet);
        await supabase
          .from('players')
          .update({
            score: newScore.toFixed(9),
            last_updated: new Date().toISOString(),
          })
          .eq('user_id', p.userId);
      }

      state.solo = defaultGameState().solo;
      await saveUserGameState(userId, state);
      return res.json({ success: true, winner: null, prize: '0', refunded: true });
    }

    const totalPot = safeDecimal(solo.pot);
    if (totalPot.lte(0)) {
      state.solo = defaultGameState().solo;
      await saveUserGameState(userId, state);
      return res.json({ success: true, winner: null, prize: '0' });
    }

    let totalBet = new Decimal(0);
    participants.forEach(p => {
      totalBet = totalBet.plus(safeDecimal(p.bet));
    });

    let rnd = Math.random() * totalBet.toNumber();
    let winner = participants[0];
    for (const p of participants) {
      const b = safeDecimal(p.bet);
      if (rnd <= b.toNumber()) {
        winner = p;
        break;
      }
      rnd -= b.toNumber();
    }

    const fee = totalPot.times(HOUSE_FEE_RATE);
    const prizeAfterFee = totalPot.minus(fee);

    const { data: winPlayer, error: winErr } = await supabase
      .from('players')
      .select('score, username, first_name, last_name, profile_photo_url')
      .eq('user_id', winner.userId)
      .single();

    if (winErr || !winPlayer) throw new Error('Winner not found');

    const newScore = safeDecimal(winPlayer.score).plus(prizeAfterFee);
    await supabase
      .from('players')
      .update({
        score: newScore.toFixed(9),
        last_updated: new Date().toISOString(),
      })
      .eq('user_id', winner.userId);

    await supabase.from('user_logs').insert({
      user_id: winner.userId,
      username: winPlayer.username || winner.username || 'Anonymous',
      action_type: 'solo_lottery_win',
      details: `Won ${prizeAfterFee.toFixed(9)} in Solo Lottery (pot ${totalPot.toFixed(
        9,
      )}, fee ${fee.toFixed(9)})`,
    });

    state.recentWinners = state.recentWinners || [];
    state.recentWinners.unshift({
      game: 'solo',
      userId: winner.userId,
      username: winPlayer.username || winner.username || null,
      first_name: winPlayer.first_name || null,
      last_name: winPlayer.last_name || null,
      profile_photo_url: winPlayer.profile_photo_url || null,
      amount: prizeAfterFee.toFixed(9),
      date: new Date().toISOString(),
    });
    if (state.recentWinners.length > 10) {
      state.recentWinners = state.recentWinners.slice(0, 10);
    }

    state.solo = defaultGameState().solo;
    await saveUserGameState(userId, state);

    res.json({
      success: true,
      winner: { userId: winner.userId, username: winPlayer.username },
      prize: prizeAfterFee.toFixed(9),
    });
  } catch (e) {
    console.error('draw-solo failed', e);
    res.status(500).json({ error: e.message || 'Draw failed' });
  }
});

app.post('/games/withdraw-solo', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: gameRow, error } = await supabase
      .from('game_state')
      .select('*')
      .eq('user_id', 'global')
      .single();

    if (error && error.code === 'PGRST116') {
      return res.status(400).json({ error: 'No active solo bet to withdraw' });
    } else if (error) {
      throw error;
    }

    const state = gameRow.state || defaultGameState();
    const solo = state.solo || defaultGameState().solo;

    const participants = solo.participants || [];
    const idx = participants.findIndex(p => String(p.userId) === String(userId));
    if (idx < 0) {
      return res.status(400).json({ error: 'No active solo bet to withdraw' });
    }

    const bet = safeDecimal(participants[idx].bet);
    if (bet.lte(0)) {
      return res.status(400).json({ error: 'Nothing to withdraw' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('score')
      .eq('user_id', userId)
      .single();

    if (playerError || !player) throw new Error('Player not found');

    const newScore = safeDecimal(player.score).plus(bet);
    await supabase
      .from('players')
      .update({
        score: newScore.toFixed(9),
        last_updated: new Date().toISOString(),
      })
      .eq('user_id', userId);

    solo.pot = safeDecimal(solo.pot).minus(bet).toFixed(9);
    participants.splice(idx, 1);
    solo.participants = participants;

    if (participants.length >= SOLO_MIN_PLAYERS) {
    } else {
      solo.isActive = false;
      solo.endTime = null;
    }

    state.solo = solo;
    state.yourBets = state.yourBets || { solo: '0', team: null };
    state.yourBets.solo = safeDecimal(state.yourBets.solo).minus(bet).toFixed(9);

    await saveUserGameState(userId, state);

    res.json({
      success: true,
      refunded: bet.toFixed(9),
      newBalance: newScore.toFixed(9),
      state,
    });
  } catch (e) {
    console.error('withdraw-solo failed', e);
    res.status(500).json({ error: e.message || 'Withdraw failed' });
  }
});

app.post('/games/team/join', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { teamId, betAmount } = req.body;

    const bet = safeDecimal(betAmount);
    if (!userId || !teamId || bet.lte(0)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('score, username, first_name, last_name, profile_photo_url')
      .eq('user_id', userId)
      .single();

    if (playerError || !player) throw new Error('Player not found');

    const balance = safeDecimal(player.score);
    if (balance.lt(bet)) {
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    const { data: gameRow, error: gameError } = await supabase
      .from('game_state')
      .select('*')
      .eq('user_id', 'global')
      .single();

    let state;
    if (gameError && gameError.code === 'PGRST116') {
      state = defaultGameState();
    } else if (gameError) {
      throw gameError;
    } else {
      state = gameRow.state || defaultGameState();
    }

    const teamState = state.team || defaultGameState().team;
    teamState.teams = teamState.teams || [];

    const team = teamState.teams.find(t => t.id === teamId);
    if (!team) {
      return res.status(400).json({ error: 'Team not found' });
    }

    team.members = team.members || [];
    const idx = team.members.findIndex(m => String(m.userId) === String(userId));

    if (idx >= 0) {
      const prev = safeDecimal(team.members[idx].bet);
      team.members[idx].bet = prev.plus(bet).toFixed(9);
    } else {
      team.members.push({
        userId,
        username: player.username || null,
        first_name: player.first_name || null,
        last_name: player.last_name || null,
        profile_photo_url: player.profile_photo_url || null,
        bet: bet.toFixed(9),
      });
    }

    team.totalBet = safeDecimal(team.totalBet || 0).plus(bet).toFixed(9);

    teamState.pot = safeDecimal(teamState.pot).plus(bet).toFixed(9);
    teamState.isActive = true;
    if (!teamState.endTime) {
      teamState.endTime = new Date(Date.now() + TEAM_DURATION_MS).toISOString();
    }

    state.team = teamState;
    state.yourBets = state.yourBets || { solo: '0', team: null };
    const prevTeamBet = safeDecimal(state.yourBets.team?.bet || 0);
    state.yourBets.team = {
      teamId: team.id,
      bet: prevTeamBet.plus(bet).toFixed(9),
    };

    const newScore = balance.minus(bet);
    await supabase
      .from('players')
      .update({
        score: newScore.toFixed(9),
        last_updated: new Date().toISOString(),
      })
      .eq('user_id', userId);

    await saveUserGameState(userId, state);

    res.json({
      success: true,
      state,
      newBalance: newScore.toFixed(9),
      team,
    });
  } catch (e) {
    console.error('team join failed', e);
    res.status(500).json({ error: e.message || 'Failed to join team' });
  }
});

app.post('/games/team/create', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { name, betAmount } = req.body;

    const bet = safeDecimal(betAmount);
    if (!userId || !name || bet.lte(0)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('score, username, first_name, last_name, profile_photo_url')
      .eq('user_id', userId)
      .single();

    if (playerError || !player) throw new Error('Player not found');

    const balance = safeDecimal(player.score);
    if (balance.lt(bet)) {
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    const { data: gameRow, error: gameError } = await supabase
      .from('game_state')
      .select('*')
      .eq('user_id', 'global')
      .single();

    let state;
    if (gameError && gameError.code === 'PGRST116') {
      state = defaultGameState();
    } else if (gameError) {
      throw gameError;
    } else {
      state = gameRow.state || defaultGameState();
    }

    const teamState = state.team || defaultGameState().team;
    teamState.teams = teamState.teams || [];

    const teamId = `team_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    const team = {
      id: teamId,
      name,
      creatorId: userId,
      members: [
        {
          userId,
          username: player.username || null,
          first_name: player.first_name || null,
          last_name: player.last_name || null,
          profile_photo_url: player.profile_photo_url || null,
          bet: bet.toFixed(9),
        },
      ],
      totalBet: bet.toFixed(9),
    };

    teamState.teams.push(team);

    teamState.pot = safeDecimal(teamState.pot).plus(bet).toFixed(9);
    if (teamState.teams.length > 0) {
      teamState.isActive = true;
      if (!teamState.endTime) {
        teamState.endTime = new Date(Date.now() + TEAM_DURATION_MS).toISOString();
      }
    }

    state.team = teamState;
    state.yourBets = state.yourBets || { solo: '0', team: null };
    state.yourBets.team = { teamId: team.id, bet: bet.toFixed(9) };

    const newScore = balance.minus(bet);
    await supabase
      .from('players')
      .update({
        score: newScore.toFixed(9),
        last_updated: new Date().toISOString(),
      })
      .eq('user_id', userId);

    await saveUserGameState(userId, state);

    res.json({
      success: true,
      state,
      newBalance: newScore.toFixed(9),
      team,
    });
  } catch (e) {
    console.error('team create failed', e);
    res.status(500).json({ error: e.message || 'Failed to create team' });
  }
});

app.post('/games/team/draw', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: gameRow, error } = await supabase
      .from('game_state')
      .select('*')
      .eq('user_id', 'global')
      .single();

    if (error) throw error;

    const state = gameRow.state || defaultGameState();
    const teamState = state.team || defaultGameState().team;
    const teams = teamState.teams || [];

    if (!teamState.isActive || !teamState.endTime) {
      return res.status(400).json({ error: 'No active team game' });
    }

    const now = new Date();
    if (new Date(teamState.endTime) > now) {
      return res.status(400).json({ error: 'Game not finished yet' });
    }

    if (!teams.length) {
      teamState.pot = '0';
      teamState.isActive = false;
      teamState.endTime = null;
      state.team = teamState;
      await saveUserGameState(userId, state);
      return res.json({ success: true, winningTeam: null, prize: '0' });
    }

    const totalPot = safeDecimal(teamState.pot);
    if (totalPot.lte(0)) {
      teamState.isActive = false;
      teamState.endTime = null;
      state.team = teamState;
      await saveUserGameState(userId, state);
      return res.json({ success: true, winningTeam: null, prize: '0' });
    }

    let totalBet = new Decimal(0);
    for (const team of teams) {
      totalBet = totalBet.plus(safeDecimal(team.totalBet || 0));
    }

    let rnd = Math.random() * totalBet.toNumber();
    let winningTeam = teams[0];
    for (const team of teams) {
      const tb = safeDecimal(team.totalBet || 0);
      if (rnd <= tb.toNumber()) {
        winningTeam = team;
        break;
      }
      rnd -= tb.toNumber();
    }

    const fee = totalPot.times(HOUSE_FEE_RATE);
    const prize = totalPot.minus(fee);

    const members = winningTeam.members || [];
    if (!members.length) {
      teamState.isActive = false;
      teamState.endTime = null;
      state.team = teamState;
      await saveUserGameState(userId, state);
      return res.json({ success: true, winningTeam: null, prize: '0' });
    }

    let totalTeamBet = new Decimal(0);
    members.forEach(m => {
      totalTeamBet = totalTeamBet.plus(safeDecimal(m.bet));
    });

    for (const member of members) {
      const memberBet = safeDecimal(member.bet);
      if (memberBet.lte(0)) continue;

      const share = prize.times(memberBet).div(totalTeamBet);

      const { data: pl } = await supabase
        .from('players')
        .select('score, username, first_name, last_name')
        .eq('user_id', member.userId)
        .single();
      if (!pl) continue;

      const newScore = safeDecimal(pl.score).plus(share);
      await supabase
        .from('players')
        .update({
          score: newScore.toFixed(9),
          last_updated: new Date().toISOString(),
        })
        .eq('user_id', member.userId);

      if (member.userId === winningTeam.creatorId) {
        state.recentWinners = state.recentWinners || [];
        state.recentWinners.unshift({
          game: 'team',
          username: pl.username || member.username || 'Anonymous',
          amount: share.toFixed(9),
          date: new Date().toISOString(),
        });
        if (state.recentWinners.length > 10) {
          state.recentWinners = state.recentWinners.slice(0, 10);
        }
      }
    }

    state.team = defaultGameState().team;
    await saveUserGameState(userId, state);

    res.json({
      success: true,
      winningTeam: {
        id: winningTeam.id,
        name: winningTeam.name,
      },
      prize: prize.toFixed(9),
    });
  } catch (e) {
    console.error('team draw failed', e);
    res.status(500).json({ error: e.message || 'Failed to draw team winner' });
  }
});

app.post('/player/add-coins', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ error: 'Missing userId or amount' });
    }

    const { data: player } = await supabase
      .from('players')
      .select('score')
      .eq('user_id', userId)
      .single();

    if (!player) throw new Error('Player not found');

    const newScore = new Decimal(player.score).plus(new Decimal(amount));

    const { error } = await supabase
      .from('players')
      .update({
        score: newScore.toFixed(9),
        last_updated: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true, newScore: newScore.toFixed(9) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 15, search = '' } = req.query;
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
      currentPage: parseInt(page),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/admin/users/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    const { data: oldUser, error: fetchError } = await supabase
      .from('players')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError) throw fetchError;

    const { data, error } = await supabase
      .from('players')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    const adminId = req.admin ? String(req.admin.user_id) : 'system';
    
    const diff = {};
    for (const key in updates) {
      if (oldUser[key] !== updates[key]) {
        diff[key] = {
          old: oldUser[key],
          new: updates[key]
        };
      }
    }

    const { error: logError } = await supabase.from('admin_logs').insert({
      admin_id: adminId,
      action_type: 'update_user',
      target_user_id: String(userId),
      details: JSON.stringify({ updates: diff }),
    });

    if (logError) {
      console.error('CRITICAL: Failed to write admin log:', logError);
    }

    res.json({ success: true, user: data });
  } catch (error) {
    console.error('Server Error:', error.message);
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
      details: JSON.stringify({
        updates: { is_banned: { old: false, new: true } }
      }),
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
      details: JSON.stringify({
        updates: { is_banned: { old: true, new: false } }
      }),
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
      currentPage: parseInt(page),
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

    const { data, error, count } = await supabase
      .from('admin_logs')
      .select('*', { count: 'exact' })
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      logs: data || [],
      totalCount: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      currentPage: parseInt(page),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/combined-activity', authenticateAdmin, async (req, res) => {
  try {
    const { data: adminLogs } = await supabase
      .from('admin_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: userLogs } = await supabase
      .from('user_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    let combined = [];

    if (adminLogs) {
      combined = combined.concat(
        adminLogs.map(log => ({
          source: 'ADMIN',
          actor: log.admin_id,
          action: log.action_type,
          details: log.details,
          time: log.created_at,
        })),
      );
    }

    if (userLogs) {
      combined = combined.concat(
        userLogs.map(log => ({
          source: 'USER',
          actor: log.username || `User ${log.user_id}`,
          action: log.action_type,
          details: log.details,
          time: log.created_at,
        })),
      );
    }

    combined.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json({ logs: combined.slice(0, 15) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/maintenance-status', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'maintenance_mode')
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    const { data: msgData } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'maintenance_message')
      .single();

    res.json({ 
      maintenance_mode: data?.value === 'true',
      message: msgData?.value || 'The system is currently under maintenance. Please try again later.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/broadcast', async (req, res) => {
    try {
        const { data: activeData } = await supabase
            .from('config')
            .select('value')
            .eq('key', 'broadcast_active')
            .single();

        if (activeData?.value !== 'true') {
            return res.json({ active: false });
        }

        const { data: msgData } = await supabase
            .from('config')
            .select('value')
            .eq('key', 'broadcast_message')
            .single();
            
        const { data: typeData } = await supabase
            .from('config')
            .select('value')
            .eq('key', 'broadcast_type')
            .single();

        res.json({
            active: true,
            message: msgData?.value || '',
            type: typeData?.value || 'info'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/search-users', authenticateAdmin, async (req, res) => {
  try {
    const { query, limit = 10 } = req.query;
    if (!query) return res.json([]);

    const { data: players, error } = await supabase
      .from('players')
      .select('user_id, username, first_name, last_name, profile_photo_url')
      .or(`username.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,user_id.ilike.%${query}%`)
      .limit(limit);

    if (error) throw error;
    res.json(players);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('=== ADMIN STATS REQUEST ===');

    const { count: totalUsers } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });

    const today = new Date().toISOString().split('T')[0];
    const { count: activeToday } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
      .gte('last_updated', today);
    const { count: bannedUsers } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
      .eq('is_banned', true);
    const { count: totalTransactions } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true });

    const { data: players } = await supabase.from('players').select('score');
    let totalCoins = new Decimal(0);
    if (players) {
      players.forEach(p => {
        totalCoins = totalCoins.plus(new Decimal(p.score || 0));
      });
    }

    res.json({
      totalUsers: totalUsers || 0,
      activeToday: activeToday || 0,
      bannedUsers: bannedUsers || 0,
      totalTransactions: totalTransactions || 0,
      totalCoins: totalCoins.toFixed(2),
      totalClicks: 0,
    });
  } catch (error) {
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
      currentPage: parseInt(page),
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
        created_by: req.admin.user_id,
      })
      .select()
      .single();

    if (error) throw error;

    await supabase.from('admin_logs').insert({
      admin_id: req.admin.user_id,
      action_type: 'make_admin',
      target_user_id: userId,
      details: 'User promoted to admin',
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

    await supabase.from('admin_logs').insert({
      admin_id: req.admin.user_id,
      action_type: 'remove_admin',
      target_user_id: userId,
      details: 'Admin privileges removed',
    });

    res.json({ success: true, admin: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/admin/users/:userId/reset-score', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user } = await supabase.from('players').select('score').eq('user_id', userId).single();
    await supabase.from('players').update({ score: 0 }).eq('user_id', userId);

    await supabase.from('admin_logs').insert({
      admin_id: req.admin.user_id,
      action_type: 'reset_score',
      target_user_id: userId,
      details: JSON.stringify({
        updates: { score: { old: user?.score || 0, new: 0 } }
      }),
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

    const { data: user } = await supabase
      .from('players')
      .select('score')
      .eq('user_id', userId)
      .single();
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
      details: JSON.stringify({
        updates: {
          score: {
            old: user.score,
            new: newScore
          }
        },
        reason: `Added ${amount} coins`
      }),
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
      last_updated: new Date().toISOString(),
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
      details: 'Reset all upgrades and multipliers to default',
    });

    res.json({ success: true, user: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/admin/users/:userId/delete', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { data: user } = await supabase
      .from('players')
      .select('username')
      .eq('user_id', userId)
      .single();
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
      details: `Permanently deleted user: ${username}`,
    });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/admin/user-logs/:logId', authenticateAdmin, async (req, res) => {
  try {
    const { logId } = req.params;
    const { error } = await supabase.from('user_logs').delete().eq('id', logId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/admin/admin-logs/:logId', authenticateAdmin, async (req, res) => {
  try {
    const { logId } = req.params;
    const { error } = await supabase.from('admin_logs').delete().eq('id', logId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Backend server is running on port ${port}`);
});
