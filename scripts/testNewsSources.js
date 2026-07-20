// This command only performs public, read-only source retrieval. Supplying inert
// local values prevents unrelated database initialization from requiring secrets.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'news-source-smoke-test';

const { smokeTestNewsSources } = require('../cron/generateScripturalOutlook');

async function main() {
    const results = await smokeTestNewsSources();
    console.table(results);
    const failures = results.filter((result) => result.status !== 'ok');
    if (failures.length) {
        throw new Error(`${failures.length} news source retrieval test(s) failed`);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
