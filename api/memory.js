export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action, username } = req.body;
  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const kv = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (action === 'get') {
    const r = await fetch(`${kv}/get/memory:${username}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    const memory = d.result ? JSON.parse(d.result) : { facts: [], summary: '' };
    return res.status(200).json({ memory });
  }

  if (action === 'clear') {
    await fetch(`${kv}/del/memory:${username}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return res.status(200).json({ ok: true });
  }

  res.status(400).json({ error: 'Invalid action' });
}
