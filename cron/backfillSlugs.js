// cron/backfillSlugs.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function slugify(text) {
  return (text || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function backfillTable({ table, titleField, idField = 'id' }) {
  console.log(`Backfilling slugs for ${table}...`);

  const pageSize = 1000;
  let offset = 0;
  let totalUpdated = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(`${idField}, ${titleField}, slug`)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error(`Error fetching ${table} (offset ${offset}):`, error);
      break;
    }

    if (!data || data.length === 0) {
      break; // No more rows
    }

    const updates = [];
    for (const row of data) {
      if (row.slug) continue; // keep existing slugs untouched
      const base = row[titleField] || '';
      if (!base) continue;
      const desired = slugify(base);
      if (!desired) continue;
      updates.push({ [idField]: row[idField], slug: desired });
    }

    if (updates.length) {
      const { error: upsertError } = await supabase
        .from(table)
        .upsert(updates, { onConflict: idField });
      if (upsertError) {
        console.error(`Error upserting batch in ${table} (offset ${offset}):`, upsertError);
        break;
      }
      totalUpdated += updates.length;
      console.log(`Updated ${updates.length} rows in ${table} (offset ${offset}).`);
    } else {
      console.log(`No updates needed in ${table} (offset ${offset}).`);
    }

    offset += pageSize;
  }

  console.log(`Finished backfilling ${table}. Total updated: ${totalUpdated}.`);
}

async function main() {
  await backfillTable({ table: 'categories', titleField: 'name' });
  await backfillTable({ table: 'topics', titleField: 'name' });
  await backfillTable({ table: 'scriptural_outlooks', titleField: 'article_title' });
  console.log('Slug backfill completed.');
}

if (require.main === module) {
  main();
}

module.exports = { main, slugify };