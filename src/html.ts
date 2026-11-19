/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Wraps a page body in the shared layout.
 *
 * @param title Page title.
 * @param body HTML already escaped by the caller.
 */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} - Clickmax Apps sample</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  a.button, button { display: inline-block; background: #4f46e5; color: #fff; border: 0; border-radius: 6px; padding: .55rem 1rem; font-size: 1rem; cursor: pointer; text-decoration: none; }
  form { display: inline; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; border-bottom: 1px solid #e5e7eb; padding: .4rem .5rem; }
  pre { background: #111827; color: #e5e7eb; padding: 1rem; border-radius: 6px; overflow: auto; max-height: 420px; }
  .error { border-left: 4px solid #b91c1c; background: #fef2f2; padding: .75rem 1rem; }
  .ok { border-left: 4px solid #16a34a; background: #f0fdf4; padding: .75rem 1rem; }
</style>
</head>
<body>
<h1><a href="/" style="color:inherit;text-decoration:none">Clickmax Apps sample</a></h1>
${body}
</body>
</html>`
}

/** Pretty-printed, escaped JSON block. */
export function json(value: unknown): string {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`
}
