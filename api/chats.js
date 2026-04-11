export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, password, username } = req.body;
  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'Eres LION, una inteligencia artificial personal amigable, inteligente y directa. Ayudas con cualquier tema. Responde siempre en español. Sé conciso, claro y útil. Usa emojis con moderación.',
      messages
    })
  });

  const data = await response.json();
  const reply = data.content?.map(b => b.text || '').join('') || '';
  const tokens = data.usage?.input_tokens + data.usage?.output_tokens || 0;
  const cost = (tokens / 1000000) * 3;

  // Save to Upstash
  try {
    const now = Date.now();
    const day = new Date().toISOString().split('T')[0];
    const user = username || 'anon';
    const kv = process.env.STORAGE_URL;
    const token = process.env.STORAGE_TOKEN;

    const pipe = [
      ['INCR', `stats:msgs:total`],
      ['INCR', `stats:msgs:${day}`],
      ['INCRBYFLOAT', `stats:cost:total`, cost.toFixed(6)],
      ['INCRBYFLOAT', `stats:cost:${day}`, cost.toFixed(6)],
      ['INCR', `stats:users:${user}`],
      ['LPUSH', `history:${user}`, JSON.stringify({
        ts: now,
        user: messages[messages.length-1]?.content || '',
        lion: reply,
        tokens
      })],
      ['LTRIM', `history:${user}`, 0, 49],
      ['SADD', 'users:all', user]
    ];

    await fetch(`${kv}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipe)
    });
  } catch(e) { console.error('KV error:', e); }

  res.status(200).json(data);
}
