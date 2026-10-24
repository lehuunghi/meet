# API v1 (current routes)

Base path `/api`. JSON requests/responses, except multipart XLSX. Cookie `meet_session`; every mutation requires exact `Origin: APP_ORIGIN`. Errors: `{ "error": "message" }`. No tenant selection in authenticated request bodies. Lists are capped (courses/users/classes/attendance 1000; meetings/audit 200; recordings 100), not paginated yet.

| Method | Path | Access / body |
|---|---|---|
| GET | /health | Public readiness, MySQL + Redis |
| GET | /setup/status | Public initialized/available flags only |
| POST | /setup/unlock | `{token}` from installer; separate 15-minute HttpOnly operator cookie |
| GET | /setup/settings | Operator only; all saved secrets redacted, assignment counts included |
| POST | /setup/settings | Operator `{settings,school}`; validates/persists provider pool, initial school/admin and R2 lifecycle/CORS |
| POST | /setup/check-sfu | Operator; creates diagnostic upstream session for submitted App ID/Secret |
| POST | /setup/lock | Revokes operator session |
| POST | /login | `{school,email,password}` |
| POST | /logout | Authenticated, revokes current session |
| GET | /me | Current identity |
| POST | /password | `{current,new}`, invalidates all user sessions |
| GET | /catalog | Authorized courses, class and teacher names |
| GET | /users | School admin |
| GET | /classes | School admin |
| GET | /audit | School admin, latest 200 actions |
| POST | /classes | Admin `{name}` → `{id}` |
| POST | /courses | Admin `{name,class_id,teacher_id}` → `{id}` |
| POST | /enrollments | Admin `{class_id,user_id}` |
| POST | /classes/:id/courses/batch | Admin rows `{id?,name,revision?}`; creates unassigned subjects, updates by short ID |
| GET | /classes/:id/students | Admin editable roster with short_id, student_code and revision, no password |
| POST | /classes/:id/students/batch | Admin rows `{id?,email,student_code,name,password,revision?}`; atomic create+enroll/update |
| POST | /teachers/batch | Separate teacher rows `{id?,email,name,password,revision?}` |
| POST | /teachers/import | XLSX email/name/password only; role forced to teacher |
| POST | /assignments | Admin rows `{course_id,teacher_id,revision}`; active same-school teacher or empty; blocks changes during live lessons |
| POST | /import | Admin multipart field `file`, one-sheet XLSX |
| GET | /meetings | Authorized meetings |
| POST | /meetings | Admin/assigned teacher `{course_id,title,starts_at,recording_allowed}` |
| POST | /meetings/:id/state | Admin/assigned teacher `{status:"live"}` or `{status:"ended"}` |
| POST | /meetings/:id/presence | Live meeting member `{kind:"join" or "heartbeat" or "leave"}` → `{seconds}` |
| GET | /meetings/:id/attendance | Teacher/admin roster, student own record only |
| GET | /attendance/report | Required `course_id`; optional `class_id`, `meeting_id`, zero-based `page`. Authorized class/subject report; student own row only. |
| POST | /meetings/:id/ice | Live meeting member, short-lived `iceServers` |
| POST | /meetings/:id/sfu | Live meeting member, operations below |
| GET | /meetings/:id/tracks | Active authorized publications |
| GET | /meetings/:id/participants | Members with current presence and hand state |
| GET | /meetings/:id/messages | Authorized room history, `after` numeric cursor, max 100 messages |
| POST | /meetings/:id/messages | Live member with active presence, `{content}`, 1–2000 characters, max 10/5s |
| POST | /meetings/:id/hand | Live member with active presence, `{raised:boolean}` |
| POST | /meetings/:id/recordings | Teacher/admin, recording-enabled live meeting → `{id,upload_url,content_type}` |
| GET | /meetings/:id/recordings | Members, ready metadata only |
| POST | /meetings/:id/recordings/:recording/complete | Owner + teacher/admin, verifies R2 HEAD |
| GET | /meetings/:id/recordings/:recording/download | Members → `{url}` expiring in five minutes |

Time is RFC3339 on input, UTC in MySQL. Use DSN `parseTime=true&loc=UTC`. IDs are opaque; don't infer tenant or permission from them.

Migration v3 preserves internal keys and adds immutable short IDs (SV/GV/LH/MH), per-school case-insensitive student codes and optimistic revisions. Login's `email` field now accepts an email or student code; student codes cannot contain @, avoiding email namespace ambiguity. Blank password on an existing editable row preserves its hash; changing profile/password invalidates prior sessions. Rate limiting is keyed by connection IP, school and normalized login identifier, so a proxy no longer imposes one 30-login bucket on an entire class; distributed username attacks still need edge controls. Courses may have no teacher until assigned; catalog uses a LEFT JOIN so those subjects remain visible to admins/enrolled students.

System setup uses the root-owned installer token, not a school-admin session. Runtime settings in CONFIG_DIR override legacy Cloudflare secret files. SFU class assignments use least assigned classes divided by weight, persisted under a MySQL advisory lock; meeting bindings pin an App ID. Disabled providers continue serving pinned classes but do not receive unassigned classes. Pool edits cannot delete or change pinned App IDs.

Recordings now include `expires_at`; expired/deleted rows are hidden and cannot be signed for download. Signed URLs last at most five minutes or remaining lifetime, whichever is shorter. R2 lifecycle scopes new objects under `recordings/` to 30 days, configured and re-read during setup. The startup/hourly janitor also deletes expired metadata-backed objects, including legacy prefixes, and retains deletion metadata. Physical removal is asynchronous and provider failures are retried.

Attendance report authorizes the course before reading data: admin within the school, teacher assigned to that course, or student enrolled in that course's class. A mismatched class or meeting returns 404. Results aggregate only live/ended meetings; `session_count` is the number of those meetings, `participated_sessions` counts a server-observed join, and `seconds` sums confirmed connection time. There is no automatic present/absent threshold. Current enrollment determines the roster; historical enrollment snapshots are not implemented. Up to 51 rows are returned per page: render the first 50 and use the look-ahead row to enable next-page navigation. Counts in the UI are labeled for the visible page. Student summary shows own session and minute totals. `/meetings?course_id=...` returns up to 200 authorized meetings in that course for the session selector; the report's all-sessions option aggregates the full course, beyond this selector limit.

SFU operations:

```json
{"op":"new"}
```

```json
{
 "op":"tracks",
 "session_id":"YOUR_OWN_SESSION_ID",
 "sessionDescription":{"type":"offer","sdp":"..."},
 "tracks":[{"location":"local","mid":"0","trackName":"camera-unique-id"}]
}
```

```json
{
 "op":"tracks",
 "session_id":"YOUR_RECEIVER_SESSION_ID",
 "tracks":[{"location":"remote","sessionId":"AUTHORIZED_PUBLISHER_SESSION","trackName":"camera-unique-id"}]
}
```

```json
{"op":"renegotiate","session_id":"YOUR_RECEIVER_SESSION_ID","sessionDescription":{"type":"answer","sdp":"..."}}
```

Provider error payloads/secrets are not forwarded on failed HTTP responses. Successful SFU responses retain the provider negotiation shape, including track-level errors; clients must check those before applying SDP. Do not log SDP, cookies, signed URLs, workbook passwords or TURN credentials.
