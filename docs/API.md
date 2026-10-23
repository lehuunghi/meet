# API v1 (current routes)

Base path `/api`. JSON requests/responses, except multipart XLSX. Cookie `meet_session`; every mutation requires exact `Origin: APP_ORIGIN`. Errors: `{ "error": "message" }`. No tenant selection in authenticated request bodies. Lists are capped (courses/users/classes/attendance 1000; meetings/audit 200; recordings 100), not paginated yet.

| Method | Path | Access / body |
|---|---|---|
| GET | /health | Public readiness, MySQL + Redis |
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
| POST | /meetings/:id/recordings | Teacher/admin, recording-enabled live meeting → `{id,upload_url,content_type}` |
| GET | /meetings/:id/recordings | Members, ready metadata only |
| POST | /meetings/:id/recordings/:recording/complete | Owner + teacher/admin, verifies R2 HEAD |
| GET | /meetings/:id/recordings/:recording/download | Members → `{url}` expiring in five minutes |

Time is RFC3339 on input, UTC in MySQL. Use DSN `parseTime=true&loc=UTC`. IDs are opaque; don't infer tenant or permission from them.

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
