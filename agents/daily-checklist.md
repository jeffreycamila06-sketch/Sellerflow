# SellerFlowLive — Daily Maintenance Checklist

Run once a day (ideally before Taiwan-evening live sessions). Check off each
item; anything that fails goes into a report — **do not auto-fix** (see
`sellerflow-maintenance-agent.md` safety rules).

## Code health

- [ ] **Run `npm run agent:check`** — lint, typecheck, and production build
      must all pass on current `main`. Any failure = report file:line, do not
      push fixes without owner approval.

## Backend health

- [ ] **Check `GET /health/tiktok`**
      (`https://sellerflow-live-server.onrender.com/health/tiktok`)
      - `activeConnections` makes sense for the time of day
      - `recentTiktokAttempts`: no flood of `fail`/`rate_limit` entries
        (a few "user isn't online" fails are normal; remember the ring buffer
        resets to empty after every deploy)
      - `rateLimitedAccounts` is 0, or explainable

- [ ] **Check Render logs for `[PLAN_CHECK]` BLOCK/ERROR**
      - BLOCK on a paying seller → verify their plan/expiry in Admin before
        they hit the problem mid-live
      - A stream of ERROR (fail-open) lines → Supabase connectivity issue
        from Render; investigate

## Cost / quota

- [ ] **Check Supabase egress** (Supabase dashboard → Usage)
      - Within the 5 GB monthly limit, trending normally
      - If climbing abnormally: check API logs for which table/endpoint is
        hot (history note: support_messages polling was the 45 GB culprit —
        removed; remaining polls are listUsers/audit/free-tier RPC, all
        admin-side and visibility-guarded)

## Sellers / admin

- [ ] **Check Pending Approvals in Admin** — new sign-ups (testers/sellers)
      waiting; the 👑 ADMIN nav badge and the Pending Approvals card show the
      count
      - While in Admin, glance at the red expiry banner (sellers ≤1 day from
        expiry) and the Plan Monitoring table

## Analytics

- [ ] **Check PostHog for a `connect_failed` spike**
      - Break down by `reason` and `$browser`
      - `unauthorized` spike → token/auth problem
      - `server_error` / `network` spike → Render or EulerStream trouble
      - One seller repeatedly failing → contact them before their next live

---

**If anything fails:** write a report (what failed, evidence, file:line if
code, suspected cause, proposed next step) and wait for owner approval before
changing anything.
