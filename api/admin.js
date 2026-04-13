export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action, username } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const kv = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const kvGet = async (key) => {
    const r = await fetch(`${kv}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.result;
  };

  const kvLrange = async (key, start, end) => {
    const r = await fetch(`${kv}/lrange/${encodeURIComponent(key)}/${start}/${end}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.result || [];
  };

  const kvSmembers = async (key) => {
    const r = await fetch(`${kv}/smembers/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.result || [];
  };

  // Get last 7 days dates
  const getLast7Days = () => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  };

  try {
    if (action === 'stats') {
      const day = new Date().toISOString().split('T')[0];
      const last7 = getLast7Days();

      const [totalMsgs, todayMsgs, totalCost, todayCost, users, ...chartData] = await Promise.all([
        kvGet('stats:msgs:total'),
        kvGet(`stats:msgs:${day}`),
        kvGet('stats:cost:total'),
        kvGet(`stats:cost:${day}`),
        kvSmembers('users:all'),
        ...last7.map(d => kvGet(`stats:msgs:${d}`)),
      ]);

      const chartMsgs = last7.map((d, i) => ({ date: d, msgs: parseInt(chartData[i] || 0) }));

      return res.status(200).json({
        totalMsgs: parseInt(totalMsgs || 0),
        todayMsgs: parseInt(todayMsgs || 0),
        totalCost: parseFloat(totalCost || 0),
        todayCost: parseFloat(todayCost || 0),
        totalUsers: users.length,
        users,
        chartMsgs
      });
    }

    if (action === 'history') {
      const items = await kvLrange(`history:${username}`, 0, 49);
      return res.status(200).json({ history: items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean) });
    }

    if (action === 'users') {
      const users = await kvSmembers('users:all');
      const counts = await Promise.all(users.map(u => kvGet(`stats:users:${u}`)));
      return res.status(200).json({ users: users.map((u, i) => ({ name: u, msgs: parseInt(counts[i] || 0) })) });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
