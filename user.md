# user.md

This file describes the demo user the v0 surface is loaded for. The agent
reads it on open to know who they're serving and what to surface by default.
For v0 it's documentation-grade — runtime read-on-startup is a future
increment. The mock seed in `apps/mock-mcp-server/src/data/seed.json` is the
data the agent would actually fetch for this user.

## Identity

- **Name**: Riley Parker
- **Where**: Brooklyn, NY (Williamsburg)
- **Time zone**: America/New_York

## Roles

- Founder / operator of a small startup
- Active reader (newsletters, longform, HN)
- Has family obligations they like to remember without being nagged

## What they normally look at on open

In rough priority order:

1. **Mail** — flagged threads first (urgent / important / starred); then a
   short list of the most recent unread. Not the whole inbox.
2. **Today's calendar** — events + which need prep. The next event matters
   more than the rest.
3. **Messages across chat apps** — DMs and direct mentions only; channel
   chatter is filtered out unless mentioned.
4. **News from a small set of sources** they actually follow (Stratechery,
   HN, a few Substacks, one financial source).
5. **Weather** — current conditions + what to expect later today.
6. **Recently edited docs** — what they were last working on, across Notion,
   Google Docs, GitHub, and local files.

## Approval boundaries

- **Auto-OK**: composing the brief, summarizing items, navigating between
  references in the surface.
- **Ask first**: drafting replies, declining or rescheduling events,
  archiving mail, sending messages on the user's behalf, anything that would
  be visible to another person.
- **Never on its own**: payments, financial actions, signing things,
  irreversible deletes.

## Tone preferences

- Brief over exhaustive. 2–3 sentences in the chat panel; let the render
  field carry the detail.
- No exclamation points, no "I'm so sorry" preambles, no manufactured
  urgency.
- Surface what's *new* or *needs attention*. Skip the routine.
