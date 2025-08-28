// bot.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// --- Environment Variables ---
const {
    TELEGRAM_BOT_TOKEN, // Your bot token from BotFather
    WEB_APP_URL,        // The URL to your Vercel frontend
    SUPABASE_URL,
    SUPABASE_KEY
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !WEB_APP_URL || !SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Missing critical environment variables for the bot!");
}

// --- Initialization ---
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('Telegram Bot is running...');

// --- /start Command Handler ---
bot.onText(/\/start/, async (msg) => {
    const { id: telegram_id, username, first_name, last_name, language_code } = msg.from;
    const chatId = msg.chat.id;

    try {
        // 1. Get User Profile Picture
        let profile_photo_url = null;
        const photos = await bot.getUserProfilePhotos(telegram_id, { limit: 1 });
        if (photos && photos.photos.length > 0) {
            // Get the highest resolution photo
            const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
            // Get the temporary downloadable link for the photo
            profile_photo_url = await bot.getFileLink(fileId);
        }

        // 2. Create or Update the User in Supabase
        // 'upsert' is perfect: it creates if the user is new, or updates if they exist.
        const { error } = await supabase.from('players').upsert(
            {
                user_id: telegram_id,
                username: username || `user_${telegram_id}`,
                first_name: first_name,
                last_name: last_name,
                language_code: language_code,
                profile_photo_url: profile_photo_url,
                last_updated: new Date().toISOString() // Update their activity timestamp
            },
            { onConflict: 'user_id' } // This tells Supabase to update if the user_id already exists
        );

        if (error) throw error;

        // 3. Send the welcome message with the "Open Game" button
        bot.sendMessage(chatId, "Welcome back! Click the button below to play.", {
            reply_markup: {
                inline_keyboard: [[{ text: "🚀 Open Game", web_app: { url: WEB_APP_URL } }]]
            }
        });
        console.log(`Successfully processed /start for user: ${username || telegram_id}`);

    } catch (error) {
        console.error(`Error in /start for user ${telegram_id}:`, error.message);
        bot.sendMessage(chatId, "Sorry, there was an error setting up your profile. Please try again later.");
    }
});