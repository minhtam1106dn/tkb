# TKB authentication and synchronization

Project: `tkb-family` (`sundoeijcnaqunpsajgr`), Free plan, Singapore (`ap-southeast-1`). Frontend remains on GitHub Pages.

- `tkb_task_catalog`: parent-only CRUD through `tkb_save_catalog`, role-filtered reads, revision conflicts and soft deletion. Day membership preserves past totals; task IDs and completion records are never removed. `test_catalog.sql` checks CRUD and permissions inside a rolled-back transaction.
- `schema.sql`: authenticated reads, child/parent permissions, task validation, completion revisions, idempotent operations, legacy import, and a login rate limiter.
- `tkb_parent_notes`: one daily note per child. Parents write through `tkb_set_parent_note`; each child can read only their own note.
  The parent input saves on Enter or blur. Children see the block only when a note exists, including on the Today tab.
- `tkb_snack_fund`: shared cash ledger visible to all three accounts. Parents add income; each child adds their own expenses. Parents can remove any mistaken entry, while children can remove only their own expense from today.
- `functions/tkb-login/index.ts`: validates one of three roles with Supabase Auth. A server-only HMAC pepper supports the chosen passwords without embedding passwords in the client. Login is limited to 30 attempts per IP per 15 minutes. Public account signup is disabled.
- `../auth-sync.js`: password sign-in, a device-local session with automatic token refresh, five-second polling while visible, per-account task and snack-fund caches, durable offline task queue, Web Locks across tabs, revision conflict resolution. The login function returns the authorized role, timetable and current-day tasks in one response; legacy import and queue flushing continue after the interface opens.
- `../cloud-config.js` contains only the public project URL and anonymous API key. Table permissions and RLS enforce access on the server.
- A returning browser refreshes its saved session online and verifies the account role before showing schedules. "Đổi người xem" retains the current session until another login succeeds; Cancel or Escape returns to the current viewer. An expired or revoked session asks for the password again. A signed-in page can queue changes offline; after an offline reload, sign-in requires a connection and queued changes remain saved.
- Legacy local records are imported once per child per browser after sign-in. Only that child's own completions are imported; existing cloud records win. Original local history is retained. Shared bath/uniform history migrates to the original child's private list before import.

## Update backend

Use Astraler browser-ready with profile `minhtam`, CDP `49222`, and the existing Supabase dashboard session, then:

```sh
PYTHONPATH=/tmp/tkb-cdp-deps python3 backend/deploy.py --schema --function
```

If websocket-client is missing, install it into a temporary directory and set PYTHONPATH accordingly. The script does not navigate tabs or create projects. Configuration and setup credentials stay in `~/.config/tkb/supabase-private.json` with file mode 600; never commit or print this file.

`provision.py` accepts credentials and passwords only through environment variables. Run it only for intentional account provisioning/password changes, not routine deployments. The local ignored `timetables.json` seeds schedules; normal schedule updates use the protected `tkb_timetables` table.

## Verification

Check real sign-ins, wrong passwords, forbidden anonymous/parent/cross-child writes, concurrent shared completion, original completer undo, stale revisions, idempotent retry, cross-session visibility, local migration and offline replay. Do not change existing family task records for tests. Use a dedicated test origin and remove only records created by the test.

- Per-day task changes use `tkb_daily_catalog` and the parent-only `tkb_save_daily_catalog` RPC. A daily entry overrides the same task ID for that day only; removed entries leave completion history untouched. `tkb_catalog_entries` returns both catalogs under the existing RLS rules. Checklist, dashboard and leaderboard resolve the same daily membership. Weekend rest days remain unchanged.
