# P0 API endpoint inventory

All protected routes require `Authorization: Bearer <token>`. Errors use `{ "error": { "code", "message", "fieldErrors?", "requestId" } }`.

| Method | Path | Router | Capability | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/events/dashboard/:congregationId` | events | `events.read` | Congregation event dashboard |
| POST | `/events` | events | `events.write` | Create event shell |
| POST | `/events/claim/:token` | events | authenticated | Claim delegated event |
| POST | `/stripe/onboard/:congregationId` | stripe | `finance.write` | Begin Connect onboarding |
| GET | `/stripe/status/:congregationId` | stripe | `finance.read` | Read Connect status |
| POST | `/stripe/dashboard/:congregationId` | stripe | `finance.read` | Open Connect dashboard |
| POST | `/stripe/checkout` | stripe | authenticated member | Create donation checkout |
| POST | `/kiosk/lookup` | kiosk | `check_in.read` | Privacy-limited guardian lookup |
| POST | `/kiosk/checkin` | kiosk | `check_in.write` | Check children in |
| POST | `/kiosk/page-parent` | kiosk | `check_in.write` | Page a guardian |
| POST | `/kiosk/dismiss-all` | kiosk | `check_in.write` | Verify and dismiss children |
| GET | `/volunteers/hub` | volunteers | authenticated member | Volunteer hub |
| GET | `/volunteers/browse-teams/:congregationId` | volunteers | `volunteers.read` | Browse teams |
| POST | `/volunteers/join-team` | volunteers | authenticated member | Request/join a team |
| POST | `/webhooks/revenuecat` | webhooks | webhook secret | RevenueCat event |

`/health` reports process liveness. `/ready` reports optional integration availability without exposing secret values.
