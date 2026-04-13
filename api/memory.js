export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action, username } = req.body;
  if (password !== process.env.APP_PASSWORD && password !== 'google-oauth') return res.status(401).json({ error: 'No autorizado' });

  const kv = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (action === 'get') {
    const r = await fetch(`${kv}/get/memory:${encodeURIComponent(username)}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    const memory = d.result ? JSON.parse(d.result) : { facts: [] };
    return res.status(200).json({ memory });
  }

  if (action === 'clear') {
    await fetch(`${kv}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['DEL', `memory:${username}`]])
    });
    return res.status(200).json({ ok: true });
  }

  res.status(400).json({ error: 'Invalid action' });
}
