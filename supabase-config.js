// ========================================================
// นำค่าจากหน้า Supabase Dashboard > Project Settings > API
// มาแทนที่ค่าด้านล่างนี้
// - Project URL          -> SUPABASE_URL
// - anon / public API key -> SUPABASE_ANON_KEY
// ========================================================

const SUPABASE_URL = "https://eysadufolqifvpbsgbum.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5c2FkdWZvbHFpZnZwYnNnYnVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MDQxNzAsImV4cCI6MjEwMzQ4MDE3MH0.c6Y13XTHSW-AW_gfjBZCnlG9GDzCbfGxnUVHov-v_U4";

// เริ่มต้นการเชื่อมต่อ Supabase (ห้ามลบบรรทัดนี้)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);