const https = require('https');
const fs = require('fs');
const path = require('path');

function stripeGet(endpoint, secret) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.stripe.com',
      path: endpoint,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(secret + ':').toString('base64')
      }
    };
    https.get(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from Stripe')); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  const { session_id, tool } = req.query;

  // Validate inputs
  if (!session_id || !tool || !/^[a-z0-9-]+$/.test(tool)) {
    return res.status(400).send('Invalid request');
  }

  const secret = process.env.STRIPE_SECRET;
  if (!secret) return res.status(500).send('Server misconfigured');

  try {
    // Verify the Stripe checkout session
    const session = await stripeGet(
      `/v1/checkout/sessions/${encodeURIComponent(session_id)}?expand[]=line_items.data.price.product`,
      secret
    );

    if (session.error) return res.status(400).send('Session not found');
    if (session.payment_status !== 'paid') return res.status(403).send('Payment not complete');

    // Verify the purchased product matches the requested tool
    const productName = session.line_items?.data?.[0]?.price?.product?.name;
    if (productName !== tool) return res.status(403).send('Tool mismatch');

    // Serve the zip
    const zipPath = path.join(__dirname, '_zips', `${tool}.zip`);
    if (!fs.existsSync(zipPath)) return res.status(404).send('Package not found — contact anishpunati@gmail.com');

    const zip = fs.readFileSync(zipPath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${tool}.zip"`);
    res.setHeader('Content-Length', zip.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(zip);

  } catch (err) {
    console.error('Download error:', err.message);
    return res.status(500).send('Server error — contact anishpunati@gmail.com');
  }
};
