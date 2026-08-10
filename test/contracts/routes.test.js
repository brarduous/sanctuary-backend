const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8');
const messageSource = fs.readFileSync(path.join(__dirname, '../../routes/messages.js'), 'utf8');
const userSource = fs.readFileSync(path.join(__dirname, '../../routes/user.js'), 'utf8');
const messageSecurityMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260717140000_message_tenant_security.sql'), 'utf8');
const tenantRlsMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260717143000_congregation_owned_rls.sql'), 'utf8');
const normalizedErrors = fs.readFileSync(path.join(__dirname, '../../middleware/normalizeErrors.js'), 'utf8');
const apiVersionSource = fs.readFileSync(path.join(__dirname, '../../middleware/apiVersion.js'), 'utf8');
const kioskSource = fs.readFileSync(path.join(__dirname, '../../routes/kiosk.js'), 'utf8');
const exportSource = fs.readFileSync(path.join(__dirname, '../../routes/exports.js'), 'utf8');
const recoverySource = fs.readFileSync(path.join(__dirname, '../../routes/recovery.js'), 'utf8');
const softDeleteMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260717153000_critical_record_soft_delete.sql'), 'utf8');
const authorizationSource = fs.readFileSync(path.join(__dirname, '../../routes/authorization.js'), 'utf8');
const demoAdminSource = fs.readFileSync(path.join(__dirname, '../../routes/demoAdmin.js'), 'utf8');
const financialSecurityMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260717163000_financial_column_security.sql'), 'utf8');
const checkinIdempotencyMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260717170000_checkin_idempotency.sql'), 'utf8');
const peopleMergeMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260718142000_atomic_people_merge.sql'), 'utf8');
const volunteerSecurityMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260717173000_volunteer_tenant_security.sql'), 'utf8');
const personalGrowthMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260718140000_personal_growth_privacy.sql'), 'utf8');
const safeguardingMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260718141000_safeguarding_incidents.sql'), 'utf8');
const eventSource = fs.readFileSync(path.join(__dirname, '../../routes/events.js'), 'utf8');
const sermonSource = fs.readFileSync(path.join(__dirname, '../../routes/sermons.js'), 'utf8');
const studySource = fs.readFileSync(path.join(__dirname, '../../routes/bibleStudies.js'), 'utf8');
const operationsMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260718100000_production_operations.sql'), 'utf8');
const careSource = fs.readFileSync(path.join(__dirname, '../../routes/care.js'), 'utf8');
const givingSource = fs.readFileSync(path.join(__dirname, '../../routes/giving.js'), 'utf8');
const crmSource = fs.readFileSync(path.join(__dirname, '../../routes/crm.js'), 'utf8');
const newsSource = fs.readFileSync(path.join(__dirname, '../../routes/news.js'), 'utf8');
const newsGeneratorSource = fs.readFileSync(path.join(__dirname, '../../cron/generateScripturalOutlook.js'), 'utf8');
const promptSource = fs.readFileSync(path.join(__dirname, '../../prompts.js'), 'utf8');
const newsEditorialSource = fs.readFileSync(path.join(__dirname, '../../routes/newsEditorial.js'), 'utf8');
const newsVerificationSource = fs.readFileSync(path.join(__dirname, '../../utils/newsVerification.js'), 'utf8');
const newsEditorialMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260718150000_news_editorial_verification.sql'), 'utf8');
const newsBackfillSource = fs.readFileSync(path.join(__dirname, '../../scripts/backfillRecentNewsVerification.js'), 'utf8');
const volunteerSource = fs.readFileSync(path.join(__dirname, '../../routes/volunteers.js'), 'utf8');

test('all production routers are mounted at compatible paths', () => {
  for (const route of ['/events', '/stripe', '/kiosk', '/volunteers', '/webhooks', '/api/care', '/api/giving']) {
    assert.match(source, new RegExp(`app\\.use\\('${route.replace('/', '\\/')}'`));
  }
});

test('operations tables are forced-RLS and withheld from direct clients', () => {
  for (const table of ['message_deliveries','care_cases','person_timeline_events','event_registrations','volunteer_profiles','checkin_rooms','giving_funds','gifts','content_versions','ai_generation_runs']) {
    assert.match(operationsMigration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(operationsMigration, /force row level security/);
  assert.match(operationsMigration, /revoke all on public\.%I from anon, authenticated/);
});

test('care and giving operations require capabilities and emit sensitive audit events', () => {
  for (const capability of ['care.read','care.write']) assert.match(careSource, new RegExp(`requireCapability\\('${capability.replace('.', '\\.')}\\'`));
  for (const capability of ['finance.read','finance.write']) assert.match(givingSource, new RegExp(`requireCapability\\('${capability.replace('.', '\\.')}\\'`));
  assert.match(careSource, /care\.queue_accessed/);
  assert.match(givingSource, /finance\.ledger_accessed/);
  assert.match(givingSource, /finance\.gift_refunded/);
});

test('confidential care and timeline reads are independently capability filtered', () => {
  assert.match(careSource, /care\.confidential/);
  assert.match(careSource, /confidentialAccess/);
  assert.match(careSource, /CONFIDENTIALITY_INVALID/);
  assert.match(careSource, /person_timeline_events/);
  assert.match(crmSource, /visibility_capability/);
  assert.match(crmSource, /allowedCapabilities/);
  assert.match(crmSource, /people\.timeline_accessed/);
});

test('people operations cover import, bulk updates, merge, segments, consent, and timelines', () => {
  for (const contract of ['/import', '/bulk', '/segments', '/timeline', 'consent_status', 'people.merged']) assert.match(crmSource, new RegExp(contract.replace('/', '\\/')));
  assert.match(crmSource, /requireCapability\('people\.write'\)/);
  assert.match(crmSource, /requireCapability\('care\.write'\)/);
});

test('people merge is atomic across operational relationships and remains recoverable', () => {
  assert.match(crmSource, /merge_crm_profiles/);
  for (const table of ['person_timeline_events','care_cases','check_ins','gifts','recurring_gifts','event_registrations','guardian_relationships','medical_alerts','pastoral_notes','communication_preferences','communication_group_members','message_deliveries']) assert.match(peopleMergeMigration, new RegExp(table));
  assert.match(peopleMergeMigration, /merged_into_id=target_profile_id/);
  assert.match(peopleMergeMigration, /grant execute.*service_role/i);
  assert.match(recoverySource, /RECOVERY_LIST_UNSUPPORTED/);
});

test('people directory separates attendance and withholds confidential care notes', () => {
  assert.match(crmSource, /last_attendance_at/);
  assert.match(crmSource, /from\('check_ins'\)/);
  assert.doesNotMatch(crmSource, /select\('\*, pastoral_notes/);
});

test('events, volunteers, and check-in cover production scheduling and safeguarding contracts', () => {
  for (const contract of ['/resources', '/register', '/attendance', '/cancel', '/substitute']) assert.match(eventSource, new RegExp(contract.replace('/', '\\/')));
  for (const contract of ['/availability', '/rotations', '/background-checks']) assert.match(volunteerSource, new RegExp(contract.replace('/', '\\/')));
  assert.match(kioskSource, /KIOSK_SESSION_INACTIVE/);
  assert.match(kioskSource, /ROOM_CAPACITY_REACHED/);
  assert.match(kioskSource, /checkin_labels/);
});

test('financial provider columns are not granted to authenticated direct clients', () => {
  assert.match(financialSecurityMigration, /revoke select, update on public\.congregations from authenticated/i);
  assert.doesNotMatch(financialSecurityMigration.match(/grant select \(([^)]+)/i)?.[1] || '', /stripe/i);
});

test('every demo reset is production-disabled and audited with its trusted actor', () => {
  assert.match(demoAdminSource, /SUPABASE_ENVIRONMENT === 'production'/);
  assert.match(demoAdminSource, /action: 'demo\.reset'/);
  assert.match(demoAdminSource, /x-demo-actor-id/);
});

test('effective capabilities are derived server-side from memberships, defaults, and overrides', () => {
  assert.match(source, /app\.use\('\/api\/authorization', authorizationRouter\)/);
  assert.match(authorizationSource, /organization_memberships/);
  assert.match(authorizationSource, /role_capabilities/);
  assert.match(authorizationSource, /capability_overrides/);
  assert.doesNotMatch(authorizationSource, /req\.body/);
});

test('critical records support capability-gated audited soft deletion and restoration', () => {
  assert.match(source, /app\.use\('\/api\/recovery', recoveryRouter\)/);
  for (const table of ['church_crm_profiles', 'households', 'events', 'pastoral_messages', 'prayer_requests', 'check_ins']) assert.match(softDeleteMigration, new RegExp(table));
  assert.match(softDeleteMigration, /as restrictive for select/);
  assert.match(recoverySource, /soft_deleted/);
  assert.match(recoverySource, /restored/);
  assert.match(recoverySource, /requireCapability/);
});

test('organization export is capability-gated, audited, checksummed, and excludes credentials', () => {
  assert.match(source, /app\.use\('\/api\/exports', exportsRouter\)/);
  assert.match(exportSource, /requireCapability\('organization\.export'\)/);
  assert.match(exportSource, /organization\.exported/);
  assert.match(exportSource, /sha256/);
  assert.match(exportSource, /recordCounts/);
  for (const table of ['audit_events', 'bible_studies', 'campuses', 'check_ins', 'church_crm_profiles', 'congregation_members', 'congregations', 'events', 'event_volunteers', 'guardian_relationships', 'households', 'kiosk_sessions', 'medical_alerts', 'organization_memberships', 'pastoral_messages', 'pickup_credentials', 'prayer_requests', 'role_members', 'volunteer_roles']) assert.match(exportSource, new RegExp(`table: '${table}'`));
  assert.doesNotMatch(exportSource, /stripe_account_id|credential_hash|medical_notes/);
});

test('kiosk operations require capabilities, verified guardians, and cryptographic pickup codes', () => {
  for (const capability of ['check_in.read', 'check_in.write', 'check_in.override']) assert.match(kioskSource, new RegExp(`requireCapability\\('${capability.replace('.', '\\.')}'\\)`));
  assert.match(kioskSource, /guardian_relationships/);
  assert.match(kioskSource, /pickup_credentials/);
  assert.match(kioskSource, /timingSafeEqual/);
  assert.match(kioskSource, /randomInt/);
  assert.doesNotMatch(kioskSource, /Math\.random/);
  assert.match(kioskSource, /idempotency-key/);
  assert.match(kioskSource, /normalizePhone\(candidate\.primary_phone\)/);
  assert.match(kioskSource, /HOUSEHOLD_NOT_FOUND/);
  assert.match(kioskSource, /eq\('congregation_id', req\.congregationId\)[\s\S]+eq\('household_id', household\.id\)/);
  assert.match(checkinIdempotencyMigration, /check_ins_one_active_child_event/);
});

test('event staffing is capability-gated, audited, and tenant-isolated', () => {
  assert.match(eventSource, /requireCapability\('volunteers\.write'\)/);
  assert.match(eventSource, /volunteer\.scheduled/);
  assert.match(eventSource, /volunteer\.\$\{status\}/);
  for (const table of ['event_volunteers', 'role_members']) {
    assert.match(volunteerSecurityMigration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(volunteerSecurityMigration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  }
  assert.match(volunteerSecurityMigration, /Volunteer assignment tenant mismatch/);
});

test('sermon and study ownership is derived from the authenticated user', () => {
  assert.match(sermonSource, /const userId = req\.user\.id/);
  assert.match(sermonSource, /eq\('user_id', req\.user\.id\)/);
  assert.match(sermonSource, /const allowed = new Set/);
  assert.doesNotMatch(sermonSource, /const \{ userId, topic/);
  assert.match(studySource, /const userId = req\.user\.id/);
  assert.match(studySource, /eq\('user_id', req\.user\.id\)/);
  assert.match(studySource, /allowedLessonFields/);
  assert.doesNotMatch(studySource, /const \{ userId, topic/);
});

test('legacy JSON errors are normalized with safe codes and request IDs', () => {
  assert.match(source, /app\.use\(normalizeErrors\)/);
  assert.match(normalizedErrors, /res\.statusCode < 400/);
  assert.match(normalizedErrors, /requestId: req\.requestId/);
  assert.doesNotMatch(normalizedErrors, /stack/);
});

test('public API routers have v1 aliases and bounded legacy telemetry', () => {
  const versioning = apiVersionSource;
  for (const mount of [
    "app.use('/api/v1', sermonsRouter)",
    "app.use('/api/v1', bibleStudiesRouter)",
    "app.use('/api/v1/messages', messagesRouter)",
    "app.use('/api/v1/crm', crmRouter)",
    "app.use('/api/v1/events', eventsRouter)",
    "app.use('/api/v1/kiosk', kioskRouter)",
    "app.use('/api/v1/care', careRouter)",
    "app.use('/api/v1/giving', givingRouter)",
  ]) assert.match(source, new RegExp(mount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(versioning, /X-API-Deprecated/);
  assert.match(versioning, /api_legacy_request/);
  assert.doesNotMatch(versioning, /req\.(body|cookies?)\b/);
  assert.ok(source.indexOf("app.use('/api/v1', sermonsRouter)") < source.indexOf('app.use(notFound)'));
});

test('filtered news feeds avoid the production-timeout nested taxonomy join', () => {
  assert.match(newsSource, /hydrateOutlookTaxonomies/);
  assert.match(newsSource, /resolveFilteredOutlookIds/);
  assert.match(newsSource, /from\('outlook_topics'\)\.select\('outlook_id'\)/);
  assert.match(newsSource, /from\('outlook_categories'\)\.select\('outlook_id'\)/);
  assert.match(newsSource, /Promise\.all/);
  assert.doesNotMatch(newsSource, /outlook_topics!inner/);
  assert.doesNotMatch(newsSource, /outlook_categories!inner/);
});

test('news generation separates layperson outlook from clergy guidance', () => {
  for (const field of [
    'newsSummary',
    'sourceAndFramingAnalysis',
    'outlook',
    'citedPassages',
    'faithfulResponse',
    'clergyGuidance',
    'sources',
    'additionalSourcesNeeded',
  ]) assert.match(promptSource, new RegExp(`"${field}"`));
  assert.match(promptSource, /Never invent a URL, author, quotation, reviewer/);
  assert.match(newsGeneratorSource, /status: 'pending_human_review'/);
  assert.match(newsGeneratorSource, /allowedUrls\.has\(source\.url\)/);
  assert.match(newsGeneratorSource, /contentSchemaVersion = 3/);
  assert.match(newsSource, /publicNewsOutlook/);
  assert.match(newsSource, /requireCapability\('content\.read'\)/);
  assert.match(newsGeneratorSource, /publisherImageUrl/);
  assert.match(newsGeneratorSource, /publisherFallbackImageUrl/);
  assert.doesNotMatch(newsGeneratorSource, /createAndStoreNewsImage/);
});

test('news verification separates public truthfulness from private editorial confidence', () => {
  assert.match(promptSource, /originalArticleAssessment/);
  assert.match(promptSource, /supported.*partially_supported.*unverifiable.*unsupported.*contradicted/s);
  assert.match(newsVerificationSource, /truthfulnessScore/);
  assert.doesNotMatch(newsVerificationSource.match(/function publicAssessment[\s\S]*?\n}/)?.[0] || '', /confidenceScore:/);
  assert.match(newsEditorialSource, /confidenceScore/);
  assert.match(newsEditorialSource, /requireAdmin/);
  assert.match(newsSource, /correctionLimiter/);
  assert.match(newsSource, /automated_high_confidence/);
  assert.match(newsSource, /confidence_score.*>= 60/);
  assert.match(newsEditorialSource, /reviewAlert/);
  assert.match(newsEditorialSource, /confidenceScore < 60/);
  assert.match(newsGeneratorSource, /news_low_confidence_review_required/);
  assert.match(newsBackfillSource, /news_low_confidence_review_required/);
});

test('news editorial history is immutable and withheld from direct clients', () => {
  for (const table of ['news_score_versions','news_editorial_revisions','news_review_decisions','news_correction_notices']) {
    assert.match(newsEditorialMigration, new RegExp(`${table}_immutable`));
  }
  assert.match(newsEditorialMigration, /revoke all on public\.news_article_sources[\s\S]*from anon, authenticated/);
  assert.match(newsEditorialMigration, /force row level security/);
});

test('recent news verification backfill is bounded, resumable, and preserves legacy content', () => {
  assert.match(newsBackfillSource, /NEWS_BACKFILL_APPROVED.*recent-24h/);
  assert.match(newsBackfillSource, /gte\('created_at', since\)/);
  assert.match(newsBackfillSource, /scoredIds/);
  assert.match(newsBackfillSource, /\.\.\.article\.ai_outlook/);
  assert.match(newsBackfillSource, /persistNewsVerification/);
  assert.match(newsBackfillSource, /NEWS_BACKFILL_CONCURRENCY/);
  assert.match(newsBackfillSource, /Math\.min\(6/);
  assert.match(newsBackfillSource, /Promise\.all\(Array\.from/);
});

test('news ingestion isolates publisher navigation failures', () => {
  assert.match(newsGeneratorSource, /catch \(navigationError\)/);
  assert.match(newsGeneratorSource, /Skipping article after navigation failure/);
  assert.match(newsGeneratorSource, /finally \{\s*await browser\.close\(\)/);
});

test('every legacy congregation-owned table has forced RLS in the enforcement migration', () => {
  for (const table of ['bible_studies', 'check_ins', 'church_crm_profiles', 'congregation_members', 'congregations', 'events', 'households', 'prayer_requests', 'volunteer_roles']) {
    assert.match(tenantRlsMigration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(tenantRlsMigration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  }
  assert.match(tenantRlsMigration, /revoke all[\s\S]+from anon/i);
});

test('message routes derive authorship and require congregation capabilities', () => {
  assert.match(messageSource, /requireCapability\('communications\.write'\)/);
  assert.match(messageSource, /requireCapability\('communications\.read'\)/);
  assert.match(messageSource, /author_id: req\.user\.id/);
  assert.match(messageSource, /congregation_id: req\.congregationId/);
  assert.doesNotMatch(messageSource, /author_id:\s*req\.body/);
});

test('personal growth is separated, owner-only, exportable, and deletable', () => {
  assert.match(personalGrowthMigration, /create table if not exists public\.personal_growth_profiles/i);
  assert.match(personalGrowthMigration, /force row level security/i);
  assert.match(personalGrowthMigration, /revoke all.+anon, authenticated/is);
  assert.match(userSource, /personal-growth\/export/);
  assert.match(userSource, /router\.delete\('\/user-profile\/:userId\/personal-growth'/);
  assert.match(userSource, /PERSONAL_GROWTH_MIGRATION_REQUIRED/);
  assert.match(userSource, /Your changes were not saved to ordinary preferences/);
});

test('safeguarding incidents are restricted, auditable, and closable', () => {
  assert.match(safeguardingMigration, /create table if not exists public\.safeguarding_incidents/i);
  assert.match(safeguardingMigration, /force row level security/i);
  assert.match(safeguardingMigration, /revoke all.+anon, authenticated/is);
  assert.match(kioskSource, /safeguarding\.incident_recorded/);
  assert.match(kioskSource, /safeguarding\.incident_closed/);
  assert.match(kioskSource, /INCIDENT_INVALID/);
  assert.match(kioskSource, /OUTCOME_REQUIRED/);
  assert.match(kioskSource, /loadIncidentTenant, requireCapability\('check_in\.override'\)/);
});

test('broadcast recipient resolution is tenant-scoped and enforced before persistence', () => {
  assert.match(messageSource, /resolveRecipientProfiles/);
  assert.match(messageSource, /eligibleRecipientCount/);
  assert.match(messageSource, /isAdditiveSchemaUnavailable/);
  assert.match(messageSource, /preference\?\.\[preferenceField\] !== true/);
  assert.match(messageSource, /channelCounts/);
  assert.match(messageSource, /RECIPIENTS_EMPTY/);
  assert.ok(messageSource.indexOf("code: 'RECIPIENTS_EMPTY'") < messageSource.indexOf("from('pastoral_messages')\n      .insert"));
  assert.match(messageSource, /\.eq\('congregation_id', congregationId\)/);
});

test('pastoral message RLS filters reads and writes by tenant capability', () => {
  assert.match(messageSecurityMigration, /enable row level security/i);
  assert.match(messageSecurityMigration, /force row level security/i);
  assert.match(messageSecurityMigration, /communications\.read/);
  assert.match(messageSecurityMigration, /communications\.write/);
  assert.match(messageSecurityMigration, /author_id = auth\.uid\(\)/);
  assert.match(messageSecurityMigration, /revoke all on table public\.pastoral_messages from anon/i);
});

test('health endpoints and terminal error middleware are registered', () => {
  assert.match(source, /app\.get\('\/health'/);
  assert.match(source, /app\.get\('\/ready'/);
  assert.ok(source.indexOf('app.use(notFound)') > source.indexOf("app.use('/webhooks'"));
  assert.ok(source.indexOf('app.use(errorHandler)') > source.indexOf('app.use(notFound)'));
});

test('importing the app does not always start a listener', () => {
  assert.match(source, /if \(require\.main === module\)/);
  assert.match(source, /module\.exports = app/);
});
