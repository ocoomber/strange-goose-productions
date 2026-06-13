# Strange Goose Productions — Client Portal: What It Achieves

*A purpose-level overview for discussing feature design. This describes what
the portal accomplishes and why — not how it's built.*

---

## The core problem it solves

Strange Goose Productions makes video content for clients. Like any creative
production business, its biggest commercial risk isn't the work itself — it's
**disputes about what was agreed**. A client says "that's not the edit I
signed off on," or "I never approved going to final," or "you delivered late,"
or "I'm not paying the final invoice because this isn't what we discussed."
When the only record is a scatter of emails, WhatsApp messages, and verbal
calls, these arguments are expensive, stressful, and often unwinnable.

The portal exists to make that whole class of dispute go away. It gives every
project a **single, authoritative, tamper-proof record of what the client
agreed to and when** — so that "who approved what" is never a matter of
memory or interpretation.

## What it achieves, in one sentence

It turns a video project into a clear, shared, step-by-step journey where the
client formally signs off at each stage, and every sign-off becomes a
permanent, timestamped, account-tied record that protects both sides.

---

## What it achieves for the business (Owen)

- **Dispute protection.** Every client approval is captured as an immutable
  record tied to their logged-in account and stamped with the exact time. If a
  disagreement ever arises, there is an objective, defensible trail.
- **Clear payment anchors.** Key commercial moments — accepting the final
  version, acknowledging that further edits become chargeable — are explicit,
  recorded client actions, not vague email threads. This underpins invoicing.
- **A professional, premium impression.** Clients experience an organised,
  branded process rather than a chaotic chain of file links and emails. It
  signals that SGP is a serious operation.
- **Less chasing and ambiguity.** The client always knows whose turn it is and
  what's needed next, which reduces stalled projects and "where are we?" emails.
- **A clean end-of-project artefact.** Each completed project yields a tidy,
  printable record of the whole approval history — useful for archives,
  accounts, or any future challenge.

## What it achieves for the client

- **Always knowing where their project stands.** A clear view of the journey,
  what's been approved, what's happening now, and what's coming.
- **Confidence and control.** Nothing advances without their explicit sign-off
  at each stage; they're never surprised by work "moving on" without them.
- **A clear sense of commitment boundaries.** Moments where scope or cost
  changes (e.g. further edits becoming chargeable) are made visible and
  acknowledged, so expectations are shared, not assumed.
- **A permanent record they also benefit from.** The trail protects the client
  too — it's an honest, mutual account of what was agreed.

---

## The shape of the journey (what it represents, not how it runs)

A project moves through a fixed sequence of meaningful milestones, from initial
brief, through review rounds, to a locked picture, final sign-off, and delivery
of the finished files. At each milestone the client takes a deliberate action
appropriate to that stage — approving, confirming feedback, acknowledging a
boundary, accepting the final, or confirming files received. The project
completes only when the client has the finished deliverables in hand.

The **meaning** of the structure matters more than the exact number of steps:
it mirrors how a real video production actually unfolds, and it makes each
commercially-significant decision an explicit, recorded event.

---

## What the client sees and does

**Getting in.** The client never signs themselves up — their account is created
for them. They receive an email with a temporary password, sign in, and are
asked to set their own password. (They can alternatively continue with a Google
account instead of managing a password.) From then on it's a normal login.

**What they see.** A clean, branded view of their project as a sequence of
stages. The current stage is open and front-and-centre; completed stages are
collapsed into a tidy history they can look back on; stages that haven't been
reached yet aren't shown. At any moment it's obvious where the project is, what
has been agreed, and whether the ball is in their court or SGP's.

**The steps they take.** At each stage the client is asked for one clear,
appropriate action — and nothing moves forward until they take it:

1. **Approve the brief** — confirm the agreed starting point.
2. **Confirm feedback sent** (first edit) — acknowledge they've sent their notes.
3. **Confirm feedback sent** (second edit) — the same, for the second round.
4. **Acknowledge picture lock** — a deliberate boundary: they understand that
   further changes from here become chargeable.
5. **Confirm feedback sent** (colour & sound) — final round of notes.
6. **Accept the final version** — the key sign-off; this is the moment the
   finished film is agreed.
7. **Confirm files received** — once SGP releases the deliverables, the client
   confirms they've downloaded and checked everything, which completes the
   project.

Each action they take is recorded permanently against their account with a
timestamp. They never see anything technical — just a simple, reassuring "your
turn / approved / waiting on SGP" rhythm.

## What the admin (Owen) sees and does

**What he sees.** A private admin panel listing all clients and projects, with
the projects that need *his* attention sorted to the top — so he can see at a
glance where he's the one holding things up. Opening a project shows the same
stage-by-stage structure the client sees, but with the controls to drive it.

**The steps he takes.**

- **Set up the client and project.** Create the client account (which
  auto-emails them their login), and create their project.
- **Feed each stage.** Paste in the relevant material as the project
  progresses — video links, document links, notes — so the client has what they
  need to act at each stage.
- **Advance the project.** Move stages forward at the right moments, opening up
  the next action for the client.
- **Release the deliverables.** Near the end, attach the final files to the last
  stage and explicitly release them to the client, which notifies them the files
  are ready.
- **Close out if needed.** If the client doesn't click the final confirmation,
  Owen can mark the project complete on their behalf so it doesn't hang open.
- **Produce the record.** On completion, generate a clean, printable end-of-
  project document capturing the full approval history.
- **Manage clients over time.** Archive finished or inactive clients (hiding
  them while keeping every record), restore them if needed, or permanently
  delete test accounts.

Throughout, Owen's actions and the client's actions are kept distinct: the
client's approvals are the protected record, and Owen's role is to set the stage
for each of those approvals and keep the project moving.

---

## The principles behind it (useful for weighing design decisions)

These are the values the portal is built to serve. New features are worth
judging against them:

1. **Permanence over convenience.** Approvals are meant to be immutable. The
   record's trustworthiness is the whole point; anything that lets history be
   quietly rewritten undermines it.
2. **Explicit over implied.** Commercially important moments should be
   deliberate, visible client actions — never assumptions or defaults.
3. **Clarity over feature-richness.** The client should always understand where
   they are and what's being asked. Simplicity protects the experience.
4. **Mutual protection, not one-sided.** The record is framed as fair to both
   parties — it builds trust rather than feeling like a legal trap.
5. **Calm, professional, on-brand.** The portal is an extension of the SGP
   brand and should feel premium and reassuring, not technical or fiddly.

---

## What it deliberately is *not*

- Not a general project-management or task tool — it tracks one specific
  approval journey, not arbitrary to-dos.
- Not a file host or editing platform — it points to deliverables and links,
  it doesn't replace the production tooling.
- Not a messaging/chat app — it's a record of decisions, not a conversation.
- Not a marketing site — it's the private, post-sale client experience.

---

## Current state (for context when proposing features)

The core journey, sign-off recording, client and admin experiences, email
notifications, account management, and an end-of-project record are all in
place and working. There is not yet a live paying client on it — so this is a
good moment to weigh feature and design decisions before real-world use begins.
