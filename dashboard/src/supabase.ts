import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createClient<any, any>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'ledger' },
})
