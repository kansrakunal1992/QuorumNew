// lib/cron-email.ts
// -- Phase 2/3 (retention work): shared email shell for the new crons ----------
// Same look and the same Resend call as app/api/cron/daily-nudge/route.ts (which
// keeps its own private copy -- untouched). One quiet layout, ONE call to
// action, and a signed one-click unsubscribe for the specific kind of email.

export function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendEmail({ to, subject, html, tag }: { to: string; subject: string; html: string; tag: string }): Promise<boolean> {
  const apiKey  = process.env.RESEND_API_KEY
  const rawFrom = process.env.FROM_EMAIL ?? 'Quorum <quorum@quorumvault.org>'
  const from    = rawFrom.includes('<') ? rawFrom : `Quorum <${rawFrom.trim()}>`
  if (!apiKey) { console.error(`[${tag}] RESEND_API_KEY not set -- email not sent`); return false }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      console.error(`[${tag}] Resend error ${res.status}:`, await res.text().catch(() => '?'))
      return false
    }
    return true
  } catch (err) {
    console.error(`[${tag}] network error sending email:`, err)
    return false
  }
}

export function buildSimpleEmailHtml(opts: {
  title:       string
  lead:        string          // plain text, escaped here
  detail?:     string | null   // plain text paragraph, escaped here
  listLabel?:  string | null
  listItems?:  string[]        // plain text, escaped here
  ctaLabel:    string
  ctaUrl:      string
  appUrl:      string
  unsubUrl:    string
  unsubLabel:  string
}): string {
  const items = (opts.listItems ?? []).map(i => `<li style="margin:0 0 6px">${esc(i)}</li>`).join('')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(opts.title)}</title>
</head>
<body style="background:#f5f4f0;margin:0;padding:48px 20px;font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:480px;margin:0 auto">
    <p style="color:#999;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 40px;font-family:monospace">
      Quorum &middot; Judgment Record
    </p>
    <p style="color:#1a1a1a;font-size:19px;line-height:1.55;margin:0 0 ${opts.detail || items ? '18px' : '32px'};font-weight:400">
      ${esc(opts.lead)}
    </p>
    ${opts.detail ? `<p style="color:#555;font-size:15px;line-height:1.65;margin:0 0 ${items ? '18px' : '32px'}">${esc(opts.detail)}</p>` : ''}
    ${items ? `${opts.listLabel ? `<p style="color:#999;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px">${esc(opts.listLabel)}</p>` : ''}<ul style="color:#444;font-size:15px;line-height:1.5;margin:0 0 32px;padding-left:18px">${items}</ul>` : ''}
    <a href="${opts.ctaUrl}"
       style="display:inline-block;background:#c9a84c;color:#0a0a12;text-decoration:none;
              padding:13px 28px;border-radius:8px;font-size:14px;font-weight:700;
              letter-spacing:0.04em">
      ${esc(opts.ctaLabel)} &rarr;
    </a>
    <p style="color:#bbb;font-size:11px;margin:48px 0 0;line-height:1.8">
      You&rsquo;re receiving this because you use Quorum.<br>
      <a href="${opts.unsubUrl}" style="color:#aaa;text-decoration:underline">${esc(opts.unsubLabel)}</a>
      &nbsp;&middot;&nbsp;
      <a href="${opts.appUrl}" style="color:#aaa;text-decoration:none">Quorum</a>
    </p>
  </div>
</body>
</html>`
}
