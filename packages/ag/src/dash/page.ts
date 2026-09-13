// The dashboard page: one static HTML document that polls /api/state.
export const page = (repo: string): string => /* html */ `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ag dash · ${repo}</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.4 system-ui, sans-serif; }
  body { margin: 0; padding: 1.5rem; }
  h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
  .meta { opacity: .65; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); vertical-align: top; }
  th { font-weight: 600; opacity: .7; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  a { color: inherit; }
  .badge { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .8rem; font-weight: 600; }
  .running { background: #2563eb22; color: #2563eb; }
  .done    { background: #16a34a22; color: #16a34a; }
  .parked  { background: #d9770622; color: #d97706; }
  .stalled { background: #dc262622; color: #dc2626; }
  .idle    { background: #6b728022; color: #6b7280; }
  .dim { opacity: .6; }
  code { font-size: .85em; }
</style>
<h1>ag dash · ${repo}</h1>
<div class="meta" id="meta">loading…</div>
<table>
  <thead><tr><th>Ticket</th><th>Status</th><th>Session</th><th>Branch</th><th>PR</th><th>Labels</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<script>
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + "s" : s < 3600 ? Math.round(s / 60) + "m" : (s / 3600).toFixed(1) + "h"; };
  async function tick() {
    const st = await (await fetch("/api/state")).json();
    document.getElementById("meta").textContent =
      st.rows.length + " tickets · updated " + ago(st.updatedAt) + " ago" + (st.error ? " · error: " + st.error : "");
    document.getElementById("rows").innerHTML = st.rows.map((r) => \`<tr>
      <td><a href="\${esc(r.issueUrl)}">#\${r.ticket}</a> \${esc(r.title)}</td>
      <td><span class="badge \${r.verdict}">\${r.verdict}</span></td>
      <td>\${r.session ? \`<code>\${esc(r.session.id)}</code> <span class="dim">\${r.session.status}, started \${ago(r.session.startedAt)} ago</span>\` : '<span class="dim">—</span>'}</td>
      <td>\${r.branch ? \`<code>\${esc(r.branch.name)}</code> <span class="dim">\${r.branch.ahead} ahead, \${r.branch.pushed ? "pushed" : "not pushed"}</span>\` : '<span class="dim">—</span>'}</td>
      <td>\${r.pr ? \`<a href="\${esc(r.pr.url)}">#\${r.pr.number}</a>\${r.pr.draft ? ' <span class="dim">draft</span>' : ""}\` : '<span class="dim">—</span>'}</td>
      <td class="dim">\${r.stateLabels.map(esc).join(", ")}</td>
    </tr>\`).join("");
  }
  tick(); setInterval(tick, 5000);
</script>`;
