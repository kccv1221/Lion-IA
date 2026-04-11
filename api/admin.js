export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action, username } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const kv = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const kvGet = async (key) => {
    const r = await fetch(`${kv}/get/${key}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.result;
  };

  const kvLrange = async (key, start, end) => {
    const r = await fetch(`${kv}/lrange/${key}/${start}/${end}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.result || [];
  };

  const kvSmembers = async (key) => {
    const r = await fetch(`${kv}/smembers/${key}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.result || [];
  };

  try {
    if (action === 'stats') {
      const day = new Date().toISOString().split('T')[0];
      const [totalMsgs, todayMsgs, totalCost, todayCost, users] = await Promise.all([
        kvGet('stats:msgs:total'),
        kvGet(`stats:msgs:${day}`),
        kvGet('stats:cost:total'),
        kvGet(`stats:cost:${day}`),
        kvSmembers('users:all')
      ]);
      return res.status(200).json({ totalMsgs, todayMsgs, totalCost, todayCost, totalUsers: users.length, users });
    }

    if (action === 'history') {
      const items = await kvLrange(`history:${username}`, 0, 49);
      return res.status(200).json({ history: items.map(i => JSON.parse(i)) });
    }

    if (action === 'users') {
      const users = await kvSmembers('users:all');
      const counts = await Promise.all(users.map(u => kvGet(`stats:users:${u}`)));
      return res.status(200).json({ users: users.map((u, i) => ({ name: u, msgs: counts[i] || 0 })) });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
