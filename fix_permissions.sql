-- =================================================================================
-- FIX PERMISSIONS SCRIPT
-- Run this script in your Supabase SQL Editor to make users visible in the Admin Panel
-- =================================================================================

-- 1. Enable read access for the 'players' table
-- This allows the Admin Panel (using the Anon Key) to read all user data
CREATE POLICY "Enable read access for all users" ON "public"."players"
AS PERMISSIVE FOR SELECT
TO public
USING (true);

-- 2. Enable read access for 'transactions' table (just in case)
CREATE POLICY "Enable read access for all transactions" ON "public"."transactions"
AS PERMISSIVE FOR SELECT
TO public
USING (true);

-- 3. Enable read access for 'admin_tasks' table
CREATE POLICY "Enable read access for admin tasks" ON "public"."admin_tasks"
AS PERMISSIVE FOR SELECT
TO public
USING (true);

-- 4. Enable read access for 'admin_logs' and 'user_logs'
CREATE POLICY "Enable read access for admin logs" ON "public"."admin_logs"
AS PERMISSIVE FOR SELECT
TO public
USING (true);

CREATE POLICY "Enable read access for user logs" ON "public"."user_logs"
AS PERMISSIVE FOR SELECT
TO public
USING (true);
