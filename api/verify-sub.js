// Vercel serverless function: /api/verify-sub
// GET /api/verify-sub?email=user@example.com
// Returns: { subscribed: true, customerName: '...' } or { subscribed: false }
//
// Required Vercel env var: STRIPE_SECRET

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const { email } = req.query;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address required.' });
  }

  const auth = 'Basic ' + Buffer.from(process.env.STRIPE_SECRET + ':').toString('base64');

  // ── 1. Find Stripe customers by email ─────────────────────────────────────
  const custRes = await fetch(
    `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=10`,
    { headers: { Authorization: auth } }
  );
  if (!custRes.ok) {
    return res.status(500).json({ error: 'Could not reach payment provider.' });
  }
  const custData = await custRes.json();

  if (!custData.data || custData.data.length === 0) {
    return res.status(200).json({ subscribed: false });
  }

  // ── 2. Check each customer for an active subscription ─────────────────────
  for (const customer of custData.data) {
    const subRes = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active&limit=5`,
      { headers: { Authorization: auth } }
    );
    if (!subRes.ok) continue;
    const subData = await subRes.json();

    if (subData.data && subData.data.length > 0) {
      return res.status(200).json({
        subscribed: true,
        customerName: customer.name || null,
      });
    }
  }

  return res.status(200).json({ subscribed: false });
};
