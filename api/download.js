// Vercel serverless function: /api/download
//
// Two auth modes:
//
//   Individual purchase:
//     GET /api/download?tool=<slug>&session_id=<stripe_session_id>
//
//   Subscriber (µ micro Pass):
//     GET /api/download?tool=<slug>&email=<email>&mode=sub
//
// Required Vercel environment variables:
//   STRIPE_SECRET    — Stripe secret key (sk_live_...)
//   GITHUB_TOKEN     — GitHub personal access token with repo scope
//   GITHUB_USERNAME  — GitHub username (default: anishpunati)

module.exports = async function handler(req, res) {
  const { tool: slug, session_id, email, mode } = req.query;

  if (!slug) {
    return res.status(400).json({ error: 'Missing tool parameter.' });
  }

  const auth = 'Basic ' + Buffer.from(process.env.STRIPE_SECRET + ':').toString('base64');

  // ── Load tools.json from the live repo ──────────────────────────────────────
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

  // ── Auth: subscriber mode ────────────────────────────────────────────────────
  if (mode === 'sub') {
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required for subscriber downloads.' });
    }

    const custRes = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=10`,
      { headers: { Authorization: auth } }
    );
    if (!custRes.ok) {
      return res.status(500).json({ error: 'Could not verify subscription.' });
    }
    const custData = await custRes.json();
    let isSubscriber = false;

    for (const customer of (custData.data || [])) {
      const subRes = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active&limit=5`,
        { headers: { Authorization: auth } }
      );
      if (!subRes.ok) continue;
      const subData = await subRes.json();
      if (subData.data && subData.data.length > 0) { isSubscriber = true; break; }
    }

    if (!isSubscriber) {
      return res.status(403).json({ error: 'No active µ micro subscription found for this email.' });
    }

  // ── Auth: individual purchase mode ──────────────────────────────────────────
  } else {
    if (!session_id) {
      return res.status(400).json({ error: 'Missing session_id parameter.' });
    }

    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${session_id}`,
      { headers: { Authorization: auth } }
    );
    if (!sessionRes.ok) {
      return res.status(400).json({ error: 'Invalid or expired session.' });
    }
    const session = await sessionRes.json();

    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed.' });
    }

    // Verify the payment was specifically for this tool (if paymentLinkId is stored)
    const storedLinkId = tool.paymentLinkId || tool.stripeLinkId;
    if (storedLinkId && session.payment_link && session.payment_link !== storedLinkId) {
      return res.status(403).json({ error: 'This purchase was for a different tool.' });
    }
  }

  // ── Fetch private repo zip from GitHub ──────────────────────────────────────
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

  const zip = await zipRes.arrayBuffer();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-source.zip"`);
  res.setHeader('Cache-Control', 'no-store, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(Buffer.from(zip));
};
