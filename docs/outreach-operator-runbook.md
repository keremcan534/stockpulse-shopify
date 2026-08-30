# StockPulse outreach operator runbook

This is a local, dry-run-only workflow. The default local state file is
`.stockpulse-outreach/state.json`; it is gitignored and can contain operational
data, so it must not be committed.

> **No live sender exists. preview and record-sent never contact anyone.**

Do not configure Gmail, SMTP, credentials, IYS records, a public deployment, or
any sending adapter as part of this workflow. Keep real recipients, contact
details, message bodies, and replies outside the repository and out of source
control.

## 1. Prepare a fictional candidate input outside the repository

From the repository root, copy the safe example to a local temporary location:

```powershell
$candidatePath = Join-Path $env:TEMP "stockpulse-p01.json"
Copy-Item examples/outreach/candidate.example.json $candidatePath
```

Edit only that copied file. Replace the business-specific fields with
verified public-business information before use: `code` (use `P01` for this
walkthrough), `businessName`, `storeDomain`, `sourceUrl`, `rationale`,
`targetRole`, and `channelSourceUrl`. Do not add an email address, a personal
name, a raw reply, a secret, or a message body. For a dry run, retain reserved
`.test` URLs and fictional values.

## 2. Add P01, create a draft, and list the queue

```powershell
npm run outreach -- candidate add --input $candidatePath
npm run outreach -- draft initial --candidate P01
npm run outreach -- list
```

The first command records a candidate, the second creates `P01-initial` in the
`draft` state, and the third shows only operational queue fields.

## 3. Review and approve exactly one message, then preview it

Before approving, inspect the copied candidate file's public source URLs and
rationale; do not infer a contact channel or add personal data. Approve only
the one message being reviewed:

```powershell
npm run outreach -- approve --message P01-initial
npm run outreach -- preview --message P01-initial
```

The preview prints the candidate, channel-source URL, and exact rendered body
locally. It is the final body review and is not transmission. If the sources or
body are unsuitable, stop before approving or recording a send. The CLI has no
edit, reject, or cancel command, and there is no bulk approval command.

## 4. Send manually only after action-time approval and legal gates

The tool cannot send anything. A human may use an external, manually operated
channel only after a fresh action-time approval of the recipient, channel, and
final text, and only after the legal and operational gates are complete:

- recipient business status and the applicable commercial-communication rules
  are verified;
- sender identity and required business information are ready;
- IYS obligations and a free, workable opt-out path are verified; and
- a compliant sending account and provider have been deliberately selected.

Do not perform that external action in this runbook. After a human has sent a
message outside the tool, record the state without transmitting anything:

```powershell
npm run outreach -- record-sent --message P01-initial
```

`record-sent` is a local record only; it never contacts anyone.

## 5. Record classified replies and an opt-out

Never store or paste a raw reply into the CLI or repository. Record only the
applicable classification labels after human review:

```powershell
npm run outreach -- reply --candidate P01 --labels meaningful_reply,problem_confirmed,demo_requested
```

For an opt-out, record `opt_out` (it suppresses later drafts and follow-ups for
that business):

```powershell
npm run outreach -- reply --candidate P01 --labels opt_out
```

Use only the labels supported by the tool: `meaningful_reply`,
`problem_confirmed`, `demo_requested`, `demo_feedback`, `pilot_requested`,
`price_stated`, `opt_out`, and `other`.

## 6. Create and approve one due follow-up

Only after the first message has been recorded as sent, five business days have
passed, and there is no reply or opt-out, create due follow-ups:

```powershell
npm run outreach -- followups create
npm run outreach -- list
npm run outreach -- approve --message P01-followup
npm run outreach -- preview --message P01-followup
```

The domain rules allow at most one follow-up per business. It needs its own
individual approval. A preview remains local and does not send it.

## 7. Read the local summary

```powershell
npm run outreach -- summary
```

The summary distinguishes drafts, approvals, recorded sends, and classified
outcomes. With no recorded sends, the response rate is reported as `not
measured`, not as a percentage.

## 8. Recover from corrupt local storage safely

If a command reports corrupt state, do not delete or overwrite the corrupt file
automatically. Preserve it first, then restore only a known-good backup that
you have independently verified. From the repository root:

```powershell
$statePath = Join-Path (Get-Location) ".stockpulse-outreach/state.json"
$preservedPath = "$statePath.corrupt-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $statePath -Destination $preservedPath

$knownGoodBackup = "C:\path\to\verified\state.json.backup"
Copy-Item -LiteralPath $knownGoodBackup -Destination $statePath
npm run outreach -- summary
```

Keep both the preserved corrupt file and the known-good backup until a human
has completed recovery review. If there is no verified backup, stop and seek
human recovery guidance; never initialize over the corrupt file automatically.
