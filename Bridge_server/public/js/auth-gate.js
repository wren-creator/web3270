// Bounces an unauthenticated visitor to /login on the hosted
// (multi-tenant) deployment. A no-op on the internal deployment, which
// has no account system at all — /api/config is how this script tells
// the two apart without hardcoding a deployment flag into a static
// HTML file. Real enforcement already happens server-side (handlers/ws.js's
// connect gate, every account-scoped API route) regardless of this
// running — this is purely so an anonymous visitor lands on /login
// instead of a terminal shell that will fail to connect to anything.
(async function () {
  try {
    const cfg = await fetch('/api/config', { credentials: 'same-origin' }).then(r => r.json());
    if (!cfg.multiTenant) return;

    const me = await fetch('/api/me', { credentials: 'same-origin' });
    if (me.status === 401) window.location.href = '/login';
  } catch {
    // Network hiccup — fail open rather than lock someone out of the
    // internal deployment (or a slow-loading hosted one) over it.
  }
})();
