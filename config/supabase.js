const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const productionProjectRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF || 'cmakuvkjxknwhonfqbit';
if (process.env.NODE_ENV !== 'production' && supabaseUrl?.includes(productionProjectRef)) {
  throw new Error('Refusing to connect development or tests to the production Supabase project. Use npm run dev:staging.');
}
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

module.exports = supabase;
