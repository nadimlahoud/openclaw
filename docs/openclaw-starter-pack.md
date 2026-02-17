---
summary: "Five high-impact OpenClaw automations with copy-paste prompts"
read_when:
  - You want practical automations you can run immediately
  - You need reusable prompt templates for cron or heartbeat jobs
title: "OpenClaw Starter Pack"
---

# OpenClaw starter pack: 5 high-impact automations

This document gives you five practical automations you can copy into OpenClaw and schedule.

## How to use this file

1. Pick one automation that solves an immediate pain point.
2. Copy the prompt template exactly and adjust only the placeholders.
3. Schedule it with cron for precise timing or heartbeat for periodic awareness.
4. Start with a narrow scope, then expand sources/channels after the output quality is stable.

Placeholder conventions used below:

- `<TZ>`: your timezone (example: `America/New_York`)
- `<WINDOW>`: time window (example: `24h`, `7d`)
- `<CHANNELS>`: sources to check (example: `email,slack,telegram`)

## 1) Daily command brief

**Objective**
Generate one concise morning brief that combines priorities, calendar conflicts, and urgent messages.

**Trigger cadence**
Weekdays at 08:00 local time.

**Prompt template**

```md
Build my daily command brief for today in <TZ>.

Sources to review:

- Calendar events in the next 12 hours
- Unread/important items from <CHANNELS> in the last 18 hours
- Any existing tasks/todos due today

Output format:

1. Top 3 priorities (ranked)
2. Time-block plan (morning / afternoon / evening)
3. Urgent messages needing reply (max 5)
4. Risks/conflicts (double-booking, missed deadlines, missing info)
5. A 5-line action checklist I can execute immediately

Rules:

- Be specific, not motivational.
- If data is missing from a source, state it and continue.
- Keep total output under 220 words.
```

**Expected output**
A compact brief with top priorities, schedule guidance, and clear next actions.

**Why this is useful**
It turns fragmented context into a concrete plan in one pass.

## 2) Follow-up radar for stale threads

**Objective**
Find conversations that are likely dropped and draft high-quality follow-ups.

**Trigger cadence**
Every weekday at 14:30 local time.

**Prompt template**

```md
Run a follow-up radar scan over the last <WINDOW>.

Scope:

- Threads where I sent the last message and got no reply for 48+ hours
- High-signal conversations only (sales, hiring, partnerships, active projects)

For each candidate thread:

1. Explain why it matters in one sentence.
2. Draft a follow-up message with clear intent and next step.
3. Label urgency: high / medium / low.

Output:

- Table with columns: Contact, Topic, Last Activity, Urgency, Draft Follow-up.
- Max 10 rows, sorted by urgency then recency.

Rules:

- No guilt language.
- Keep each draft under 90 words.
- If context is weak, ask one clarifying question instead of guessing.
```

**Expected output**
A ranked list of stale but important threads plus ready-to-send follow-up drafts.

**Why this is useful**
It recovers opportunities that usually disappear in inbox noise.

## 3) Meeting-to-action extractor

**Objective**
Convert meetings and notes into an actionable task list with owners and deadlines.

**Trigger cadence**
Every evening at 18:00 local time.

**Prompt template**

```md
Extract actions from today’s meetings and notes.

Inputs:

- Calendar events from today
- Notes/transcripts captured today
- Related messages in the last 12 hours

Produce:

1. Decision log (what was decided)
2. Action items with fields:
   - owner
   - task
   - due date
   - dependency
   - confidence (high/medium/low)
3. Missing owners or missing due dates section
4. One summary paragraph for end-of-day review

Rules:

- Do not create actions without evidence.
- Mark assumptions explicitly.
- If owner is unclear, use "unassigned" and include a clarification question.
```

**Expected output**
A clean action register and decision log from noisy meeting artifacts.

**Why this is useful**
It reduces dropped commitments and shortens post-meeting cleanup time.

## 4) Weekly project health digest

**Objective**
Produce a weekly status report across active projects with blockers and next decisions.

**Trigger cadence**
Weekly on Friday at 16:00 local time.

**Prompt template**

```md
Create a weekly project health digest for the last 7 days.

Collect:

- Activity from project channels/repos/docs
- Open blockers and unresolved dependencies
- Missed or at-risk milestones

Output sections:

1. Project scorecard (On track / At risk / Off track)
2. Top 5 blockers (owner + unblock step)
3. Decisions needed next week (with recommended decision)
4. Carry-over tasks from last week not completed
5. Executive summary (max 120 words)

Rules:

- Prefer facts and timestamps over narrative.
- Include links/refs where possible.
- Flag missing telemetry explicitly.
```

**Expected output**
A leadership-ready digest with status, blockers, and concrete decision asks.

**Why this is useful**
It gives weekly visibility without manual status chasing.

## 5) Gateway reliability and security check

**Objective**
Continuously verify that OpenClaw remains healthy, authenticated, and safely exposed.

**Trigger cadence**
Every 4 hours.

**Prompt template**

```md
Run an OpenClaw reliability and security check.

Verify:

- Gateway health endpoint is reachable
- Auth is enforced (unauthenticated requests should fail)
- Current bind/exposure is expected (localhost-only unless explicitly configured)
- Channel/node errors in recent logs
- Disk space and workspace/state accessibility

Output:

1. Status: OK / Warning / Critical
2. Findings with severity and evidence
3. Immediate fixes (ordered)
4. One-line rollback recommendation if critical

Rules:

- No vague alerts; include concrete evidence.
- Suppress noisy repeats if same finding occurred in the last 24h.
```

**Expected output**
A prioritized health and security report with actionable remediation steps.

**Why this is useful**
It catches auth, exposure, and runtime regressions before they become outages.

## Operating notes

- **Token/auth:** keep gateway authentication enabled; never hardcode tokens in prompts or commit them to files.
- **Channel prerequisites:** automations should degrade gracefully when a channel/tool is unavailable; report missing capability and continue.
- **Local vs hosted:** macOS-only capabilities (for example Apple-specific local integrations) require a Mac runtime. VPS deployments should use channels, APIs, or nodes/bridges for equivalent workflows.
