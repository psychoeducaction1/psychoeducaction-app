import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// Keep Supabase's default key explicit so local sign-out can clear only this
// application's Auth entries even when the Auth server is unavailable.
export const supabaseAuthStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
export const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { storageKey: supabaseAuthStorageKey } })
