export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  const redirectUri = `https://lion-ia.vercel.app/api/auth/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) return res.redirect('/?error=token_failed');

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const user = await userRes.json();

    // Create simple JWT-like token
    const payload = {
      name: user.name,
      email: user.email,
      picture: user.picture,
      ts: Date.now()
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = Buffer.from(`${encoded}.${process.env.JWT_SECRET}`).toString('base64').slice(0, 20);
    const token = `${encoded}.${signature}`;

    // Save user in KV
    const kv = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    await fetch(`${kv}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['SADD', 'users:all', user.name],
        ['SET', `user:${user.email}`, JSON.stringify({ name: user.name, email: user.email, picture: user.picture })]
      ])
    }).catch(() => {});

    // Redirect with token
    res.redirect(`/?token=${encodeURIComponent(token)}&name=${encodeURIComponent(user.name)}&picture=${encodeURIComponent(user.picture || '')}`);
  } catch(e) {
    res.redirect('/?error=auth_failed');
  }
}
