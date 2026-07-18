# Check-in safeguarding runbook

Owner: Safeguarding lead  
Technical owner: Production backend owner  
Approval: Required before each ministry season and after every critical incident  
Review interval: Quarterly

## Operating boundary

- Locked kiosk mode is for family lookup and check-in only. It must not expose authenticated application navigation.
- A current network connection is required. Sanctuary does not queue offline child check-ins because guardian authorization, room capacity, duplicate prevention, medical alerts, and kiosk-session validity must be current.
- Only staff with `check_in.write` may open a kiosk or check a child in. Only staff with `check_in.override` may override pickup credentials or access safeguarding incidents.
- Never place medical details, child names, phone numbers, pickup codes, or incident narrative in chat, email, screenshots, or audit metadata.

## Before opening

1. Confirm the event, room, capacity, printer, label stock, network, and a second authorized volunteer.
2. Confirm guardian relationships and active medical alerts were reviewed by authorized staff.
3. Open the kiosk session and verify application navigation is absent.
4. Keep the setup device attended. A locked session persists across reloads; do not share the authenticated browser profile.

## Network loss and recovery

1. Stop check-in immediately when the offline warning appears. Do not use paper as an untracked substitute.
2. Keep the family with an authorized volunteer and restore the network.
3. Reload the kiosk; the locked session should recover from session storage.
4. Re-run family lookup and child selection. Never assume a request completed after an uncertain network failure.
5. The server idempotency key prevents a retried check-in from creating a duplicate. Confirm the settled result before printing or issuing a pickup credential.
6. If service cannot be restored, move families to the congregation's approved manual safeguarding process outside Sanctuary and reconcile records under dual control after service restoration.

## Guardian or pickup exception

1. Do not bypass a missing guardian relationship during check-in.
2. For pickup, verify identity using the congregation's approved procedure and involve the safeguarding lead.
3. Use checkout override only when the ordinary credential cannot be validated and document a specific reason. The server requires `check_in.override` and emits an immutable audit event.
4. For a dispute, missing child, suspected abuse, medical emergency, or unsafe adult, follow emergency policy first and record a safeguarding incident after immediate safety actions.

## Incident recording and escalation

1. Record type, severity, objective summary, actions taken, occurrence time, and linked event/check-in only when needed.
2. Critical or missing-child incidents require immediate safeguarding-lead escalation and emergency services when policy or law requires it.
3. Do not diagnose, speculate, or include unrelated confidential history.
4. Close an incident only after documenting the outcome. Recording and closure both emit immutable audit events.
5. Apply the approved safeguarding retention schedule; legal holds override routine deletion.

## End of session

1. Confirm every active child has a settled check-in and every pickup has a verified checkout or audited override.
2. Reconcile label failures, uncertain requests, room counts, and incidents.
3. Lock the kiosk session. Clear browser session storage only after the server reports it locked.
4. Sign out or close the dedicated kiosk browser profile and secure printed material.
