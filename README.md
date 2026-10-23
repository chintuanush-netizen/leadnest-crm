# Leadnest CRM

Self-serve, multi-client real estate lead CRM. Each builder, developer or agent signs up, gets their own private workspace, connects their lead sources and sees leads live.

**Stack:** React + Vite (frontend) · Supabase (Postgres, Auth, Realtime, Edge Functions)

## What's in the MVP

| Area | What it does |
|---|---|
| Accounts | Email + password or magic-link signup, 14-day trial, one user can belong to several workspaces |
| Isolation | Postgres Row Level Security: a client can never read or change another client's data (tested) |
| Roles | **Owner / Admin** see every lead and manage sources & team. **Agent** sees only leads assigned to them |
| Live inbox | New leads appear instantly (Supabase Realtime) with highlight + browser notification |
| Pipeline | New → Contacted → Visit scheduled → Visit done → Negotiation → Booked / Lost / Junk |
| Lead detail | One-tap Call and WhatsApp, owner, project, next follow-up, every form answer, campaign/ad/form names, UTM tags, notes timeline |
| Automation | Round-robin auto-assign to agents; repeat enquiries (same number within 90 days) flagged and routed back to the same agent |
| Projects | Tag leads by project, automatically per source or via a `project` form field |
| Team | Invite links per email with role; agents/admins manageable from the portal |
| Export | CSV export of the current filtered view |

### AI (Claude)

| Feature | Where |
|---|---|
| Lead score + summary | Lead panel → **AI insight** (Hot / Warm / Cold, one-line summary, next step). Leads page → **AI score N leads** scores every unscored lead on screen (up to 20 at a time). Scores are saved on the lead and exported in the CSV |
| WhatsApp writer | Lead panel → **Write a WhatsApp message**: pick purpose and language (English, Telugu, Hindi or mixed), edit, then **Open in WhatsApp** |
| Call notes cleanup | Type a rough note → **Tidy with AI**: rewrites it cleanly and suggests the new status and follow-up time (one click to apply) |
| Ask AI | Sidebar → **Ask AI**: chat about your latest 400 leads ("who should we call first today?") |

Agents only ever send the AI the leads they can already see (row-level security applies to every read).

### Lead sources

| Source | Endpoint | How it connects |
|---|---|---|
| Meta Lead Ads | `meta-webhook` + `meta-connect` | Client clicks **Continue with Facebook**, picks their page; we subscribe it to `leadgen` and fetch every submission |
| Google Ads lead forms | `google-leads?token=…` | Client pastes the URL + key into the lead form's webhook settings |
| Landing pages / websites | `ingest?token=…` | HTML form `action`, JS `fetch`, WordPress/Elementor/Webflow webhooks. JSON or form data. `_redirect` field for thank-you pages, `_gotcha` honeypot |
| Portals & 3rd-party apps | `ingest?token=…` | 99acres, MagicBricks, Housing.com, Zapier, Pabbly, Make: anything that can POST |
| WhatsApp | `whatsapp-webhook` | WhatsApp Cloud API number on your Meta app; first message creates a lead, later messages go on its timeline |

Field names are matched automatically (`name`, `full_name`, `mobile`, `phone_number`, `email`, `city`, `budget`, `message`, `project`, …). Unknown fields are kept on the lead, so no answer is lost. Phone numbers are normalised to `+91XXXXXXXXXX` (international numbers keep their own code).

---

## Setup

### 1. Supabase project
1. Create a project at supabase.com (choose the **Mumbai** region for Indian clients).
2. Install the CLI and link: `npx supabase login && npx supabase link --project-ref YOUR_REF`
3. Apply the schema: `npx supabase db push` (or paste `supabase/migrations/…_init.sql` into the SQL editor).
4. **Auth → URL Configuration:** set Site URL to your app domain (e.g. `https://crm.leadnest.in`) and add it to Redirect URLs.

### 2. Edge functions
```bash
npx supabase secrets set \
  META_APP_ID=xxx META_APP_SECRET=xxx \
  META_VERIFY_TOKEN=any-long-random-string \
  META_GRAPH_VERSION=v23.0

npx supabase functions deploy ingest           --no-verify-jwt
npx supabase functions deploy google-leads     --no-verify-jwt
npx supabase functions deploy meta-webhook     --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
npx supabase functions deploy meta-connect     # keeps JWT check: only signed-in admins
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### 3. Frontend
```bash
cp .env.example .env   # fill in URL, anon key, Meta app id
npm install
npm run dev            # local
npm run build          # deploy dist/ to Vercel / Netlify / Cloudflare Pages
```
Add a SPA rewrite (all paths → `/index.html`) so `/invite/…` links work.

### 4. Meta app (one app for all clients)
1. developers.facebook.com → Create app → **Business** type. Add **Facebook Login for Business** and **Webhooks** (and **WhatsApp** if you want WhatsApp leads).
2. Webhooks → **Page** → callback `https://YOUR_REF.supabase.co/functions/v1/meta-webhook`, verify token = `META_VERIFY_TOKEN`, subscribe to `leadgen`.
3. Webhooks → **WhatsApp Business Account** → callback `…/functions/v1/whatsapp-webhook`, same verify token, subscribe to `messages`.
4. Add your CRM domain to the app's allowed domains / Valid OAuth Redirect URIs.
5. Permissions used: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`, `leads_retrieval`, `business_management`.
6. **Before outside clients can connect,** the app needs Business Verification and App Review for those permissions. Until then it works only for people with a role on the app (add your own team as testers to try it end to end).
7. Each client's page must also allow your app under Business Settings → Integrations → **Leads Access** if they've restricted CRM access.

Test with Meta's **Lead Ads Testing Tool**.

### 5. Google Ads
In the portal: Lead sources → Google Ads lead forms → copy URL + key → paste into the lead form asset's webhook section → **Send test data**. A test lead appears instantly.


### 6. AI
1. Get an API key at console.anthropic.com.
2. Apply the AI migration (`npx supabase db push` picks up `…_ai.sql`).
3. Set the secret and deploy the function:
```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
# optional: AI_MODEL=claude-sonnet-5-5 AI_MODEL_QUICK=claude-haiku-5-5
npx supabase functions deploy ai      # keeps JWT check: signed-in workspace members only
```
AI usage is billed to your Anthropic account. Scoring uses the quick model; WhatsApp drafts, note cleanup and Ask AI use the main model.

### Demo mode
With no Supabase keys in `.env` (or `VITE_DEMO=1`), the app runs on built-in sample data so you can click through every screen. In demo mode AI runs through Claude when the page is opened inside claude.ai.

---

## Project layout
```
supabase/
  migrations/…_init.sql      schema, RLS, triggers, RPCs
  migrations/…_ai.sql        AI score columns on leads
  functions/
    _shared/leads.ts         field mapping, phone normalisation, insert/dedupe, Meta signature check
    ingest/                  websites, portals, Zapier/Pabbly
    meta-webhook/            Lead Ads delivery
    meta-connect/            Facebook page connect (list pages, subscribe, store token)
    google-leads/            Google Ads lead form webhook
    whatsapp-webhook/        WhatsApp Cloud API messages
    ai/                      Claude proxy for the AI features (members only)
src/
  pages/                     Auth, Onboarding, Leads, Ask AI, Integrations, Team, Settings, Invite
  components/                Layout, LeadDrawer, AddLeadModal, AiPanels
  lib/ai.ts                  AI prompts (scoring, WhatsApp, notes, Ask AI)
  lib/demo.ts                sample data for demo mode
  context/Session.tsx        auth + current workspace + members
```

## What was tested
- Schema applied to Postgres 16 with Supabase's auth stubs.
- Two client workspaces: the second client sees zero rows and cannot update the first client's leads.
- Agents see only their own leads and cannot create sources; status changes write to the timeline.
- Round-robin alternates between agents; a repeat enquiry is flagged and goes to the same agent.
- All edge functions pass `deno check`; field mapping verified on website, Meta and Google payload shapes.
- Frontend type-checks and builds.

Not yet tested against live Meta/Google accounts. That needs your app credentials.

## Recommended next steps
1. **Billing:** Razorpay subscriptions; enforce `plan` / `trial_ends_at` (lead cap or source cap per tier).
2. **Email invites & alerts:** Resend or SES for invite emails, instant new-lead emails, daily digest.
3. **Lead alerts on WhatsApp** to the assigned agent (Cloud API template message).
4. **Portal email parsing:** for portals that only email leads, a forwarding address parsed into leads.
5. **Follow-up reminders** view (overdue `next_follow_up`) and a Kanban board.
6. **Agency admin view:** a super-admin dashboard across all workspaces for Leadnest's own team.
7. Rate limiting on `ingest` (Supabase `pg_net` or a Cloudflare worker in front).
