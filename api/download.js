// Vercel serverless function: /api/download
// Usage: GET /api/download?tool=<slug>&session_id=<stripe_session_id>
//
// Required Vercel environment variables:
//   STRIPE_SECRET    — Stripe secret key (sk_live_... or sk_test_...)
//   GITHUB_TOKEN     — GitHub personal access token with repo scope (for private repos)
//   GITHUB_USERNAME  — GitHub username (default: anishpunati)

module.exports = async function handler(req, res) {
  const { tool: slug, session_id } = req.query;

  if (!slug || !session_id) {
    return res.status(400).json({ error: 'Missing tool or session_id parameters.' });
  }

  // ── 1. Load tools.json from the live repo ──────────────────────────────────
  const toolsRes = await fetch(
    'https://raw.githubusercontent.com/anishpunati/mumicro/main/tools.json',
    { headers: { 'User-Agent': 'mumicro-download/1.0' } }
  );
  if (!toolsRes.ok) {
    return res.status(500).json({ error: 'Could not load tool registry.' });
  }
  const tools = await toolsRes.json();
  const tool  = tools.find(t => (t.slug || t.name) === slug);
  if (!tool) {
    return res.status(404).json({ error: `Tool "${slug}" not found.` });
  }

  // ── 2. Verify Stripe session ───────────────────────────────────────────────
  const stripeRes = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${session_id}`,
    {
      headers: {
        Authorization: 'Basic ' + Buffer.from(process.env.STRIPE_SECRET + ':').toString('base64'),
      },
    }
  );
  if (!stripeRes.ok) {
    return res.status(400).json({ error: 'Invalid or expired session.' });
  }
  const session = await stripeRes.json();

  if (session.payment_status !== 'paid') {
    return res.status(402).json({ error: 'Payment not completed.' });
  }

  // ── 3. Verify the payment was for THIS tool ────────────────────────────────
  // paymentLinkId is stored in tools.json when the tool is built.
  // If it's not present yet (legacy tools), we skip the check.
  const storedLinkId = tool.paymentLinkId || tool.stripeLinkId;
  if (storedLinkId && session.payment_link && session.payment_link !== storedLinkId) {
    return res.status(403).json({ error: 'This purchase was for a different tool.' });
  }

  // ── 4. Fetch the private repo zip from GitHub ──────────────────────────────
  const owner  = process.env.GITHUB_USERNAME || 'anishpunati';
  const zipRes = await fetch(
    `https://api.github.com/repos/${owner}/${slug}/zipball/main`,
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mumicro-download/1.0',
      },
      redirect: 'follow',
    }
  );

  if (!zipRes.ok) {
    console.error(`GitHub zipball failed: ${zipRes.status} for ${owner}/${slug}`);
    return res.status(500).json({ error: 'Failed to retrieve source archive. Please contact support.' });
  }

  // ── 5. Stream zip to the buyer ─────────────────────────────────────────────
  const zip = await zipRes.arrayBuffer();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-source.zip"`);
  res.setHeader('Cache-Control', 'no-store, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(Buffer.from(zip));
};
