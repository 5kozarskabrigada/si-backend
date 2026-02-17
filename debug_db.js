require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
    console.log('Testing connection to:', supabaseUrl);
    console.log('Using key starting with:', supabaseKey ? supabaseKey.substring(0, 10) + '...' : 'NONE');
    
    // Test Players Table
    console.log('\n--- Testing Players Table ---');
    const { data: players, error: playersError, count: playersCount } = await supabase
        .from('players')
        .select('*', { count: 'exact', head: true });
    
    if (playersError) {
        console.error('Error fetching players:', playersError.message);
        console.error('Error details:', playersError);
    } else {
        console.log(`Successfully connected! Found ${playersCount} players.`);
    }

    // Test Transactions Table
    console.log('\n--- Testing Transactions Table ---');
    const { data: tx, error: txError, count: txCount } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true });

    if (txError) {
        console.error('Error fetching transactions:', txError.message);
    } else {
        console.log(`Found ${txCount} transactions.`);
    }
}

testConnection();