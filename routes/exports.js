const express = require('express');
const { createHash } = require('node:crypto');
const supabase = require('../config/supabase');
const authenticateUser = require('../middleware/auth');
const { requireCapability } = require('../middleware/authorization');

const router = express.Router();
const specifications = {
  auditEvents: { table: 'audit_events', columns: 'id,congregation_id,actor_user_id,action,resource_type,resource_id,request_id,metadata,occurred_at' },
  bibleStudies: { table: 'bible_studies', columns: 'study_id,title,subtitle,created_at,updated_at,user_id,study_method,status,congregation_id,is_published' },
  campuses: { table: 'campuses', columns: 'id,congregation_id,name,created_at' },
  checkIns: { table: 'check_ins', columns: 'id,congregation_id,event_id,profile_id,checked_in_by,status,checked_in_at,checked_out_at,deleted_at,deletion_reason' },
  congregation: { table: 'congregations', columns: 'congregation_id,name,description,created_at,updated_at', single: true },
  congregationMembers: { table: 'congregation_members', columns: 'member_id,congregation_id,join_date,user_id,last_active_date' },
  households: { table: 'households', columns: 'id,congregation_id,name,created_at' },
  people: { table: 'church_crm_profiles', columns: 'id,congregation_id,household_id,first_name,last_name,household_role,email,phone,created_at' },
  events: { table: 'events', columns: 'id,congregation_id,title,description,event_date,end_time,location,event_type,is_public,status,created_at' },
  eventVolunteers: { table: 'event_volunteers', columns: 'id,congregation_id,event_id,role_id,user_id,status,notified_at,created_at' },
  guardianRelationships: { table: 'guardian_relationships', columns: 'id,congregation_id,guardian_profile_id,child_profile_id,relationship,pickup_authorized,verified_at,created_at' },
  kioskSessions: { table: 'kiosk_sessions', columns: 'id,congregation_id,event_id,opened_by,locked_at,expires_at,created_at' },
  medicalAlerts: { table: 'medical_alerts', columns: 'id,congregation_id,child_profile_id,alert_type,description,active,created_at' },
  communications: { table: 'pastoral_messages', columns: 'message_id,congregation_id,author_id,title,message_type,message_body,is_published,created_at' },
  organizationMemberships: { table: 'organization_memberships', columns: 'id,congregation_id,user_id,role,campus_id,active,created_at,updated_at' },
  pickupCredentials: { table: 'pickup_credentials', columns: 'id,congregation_id,check_in_id,expires_at,verified_at,verified_by,override_reason' },
  prayers: { table: 'prayer_requests', columns: 'id,congregation_id,user_id,request_text,visibility,created_at' },
  roleMembers: { table: 'role_members', columns: 'id,congregation_id,role_id,user_id,status,joined_at' },
  volunteerRoles: { table: 'volunteer_roles', columns: 'id,congregation_id,name,description,color_code,join_policy' },
  careCases: { table: 'care_cases', columns: 'id,congregation_id,profile_id,prayer_request_id,assignee_user_id,title,description,priority,status,confidentiality,follow_up_at,reminder_at,outcome,retention_until,created_at,updated_at,closed_at,deleted_at' },
  communicationGroups: { table: 'communication_groups', columns: 'id,congregation_id,name,description,filter_definition,created_at,updated_at' },
  communicationPreferences: { table: 'communication_preferences', columns: 'congregation_id,profile_id,email_enabled,sms_enabled,push_enabled,unsubscribed_at,quiet_hours_start,quiet_hours_end,time_zone,updated_at' },
  messageDeliveries: { table: 'message_deliveries', columns: 'id,congregation_id,message_id,profile_id,channel,status,failure_code,attempts,last_attempt_at,delivered_at,bounced_at,created_at' },
  personSegments: { table: 'person_segments', columns: 'id,congregation_id,name,definition,created_at,updated_at' },
  personTimeline: { table: 'person_timeline_events', columns: 'id,congregation_id,profile_id,event_type,occurred_at,summary,visibility_capability,source_type,source_id,metadata' },
  eventRegistrations: { table: 'event_registrations', columns: 'id,congregation_id,event_id,profile_id,guest_email,status,response_data,registered_at,attended_at,cancelled_at,waitlist_position' },
  eventResources: { table: 'event_resources', columns: 'id,congregation_id,name,resource_type,capacity,active,metadata' },
  volunteerProfiles: { table: 'volunteer_profiles', columns: 'congregation_id,user_id,qualifications,background_check_status,background_check_expires_at,active,created_at,updated_at' },
  volunteerAvailability: { table: 'volunteer_availability', columns: 'id,congregation_id,user_id,starts_at,ends_at,availability,reason,recurrence_rule,created_at' },
  checkinRooms: { table: 'checkin_rooms', columns: 'id,congregation_id,name,capacity,age_min_months,age_max_months,active' },
  givingFunds: { table: 'giving_funds', columns: 'id,congregation_id,name,description,restricted,active' },
  givingBatches: { table: 'giving_batches', columns: 'id,congregation_id,name,status,expected_total_cents,actual_total_cents,opened_at,closed_at' },
  gifts: { table: 'gifts', columns: 'id,congregation_id,donor_profile_id,fund_id,batch_id,amount_cents,currency,source,received_at,status,refunded_amount_cents,created_at' },
  recurringGifts: { table: 'recurring_gifts', columns: 'id,congregation_id,donor_profile_id,fund_id,amount_cents,cadence,status,next_charge_at,created_at' },
  giftRefunds: { table: 'gift_refunds', columns: 'id,congregation_id,gift_id,amount_cents,reason,refunded_at' },
};

function csv(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.map(quote).join(','), ...rows.map((row) => columns.map((column) => quote(row[column])).join(','))].join('\n');
}

router.post('/:congregationId', authenticateUser, requireCapability('organization.export'), async (req, res, next) => {
  try {
    const datasets = {};
    for (const [name, specification] of Object.entries(specifications)) {
      const { data, error } = await supabase.from(specification.table).select(specification.columns).eq('congregation_id', req.congregationId);
      if (error) throw error;
      datasets[name] = data || [];
    }
    const serialized = JSON.stringify(datasets);
    const generatedAt = new Date().toISOString();
    const manifest = {
      schemaVersion: 2,
      congregationId: req.congregationId,
      generatedAt,
      generatedBy: req.user.id,
      format: ['json', 'csv'],
      recordCounts: Object.fromEntries(Object.entries(datasets).map(([name, rows]) => [name, rows.length])),
      sha256: createHash('sha256').update(serialized).digest('hex'),
      excluded: ['authentication credentials', 'API keys', 'provider credentials', 'Stripe account identifiers', 'pickup credential hashes', 'medical notes'],
    };
    const { data: audit, error: auditError } = await supabase.from('audit_events').insert({ congregation_id: req.congregationId, actor_user_id: req.user.id, action: 'organization.exported', resource_type: 'organization', resource_id: String(req.congregationId), request_id: req.requestId, metadata: { recordCounts: manifest.recordCounts, sha256: manifest.sha256 } }).select('id').single();
    if (auditError) throw auditError;
    res.set('Content-Disposition', `attachment; filename="sanctuary-export-${req.congregationId}-${generatedAt.slice(0, 10)}.json"`);
    res.json({ manifest: { ...manifest, auditEventId: audit.id }, json: datasets, csv: Object.fromEntries(Object.entries(datasets).map(([name, rows]) => [`${name}.csv`, csv(rows)])) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
