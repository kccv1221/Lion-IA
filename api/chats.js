export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = req.body; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { messages, password, username, personality } = body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid messages' });
  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });

  const kv = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  let memory = { facts: [] };
  try {
    const r = await fetch(`${kv}/get/memory:${encodeURIComponent(username||'anon')}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (d.result) {
      const parsed = typeof d.result === 'string' ? JSON.parse(d.result) : d.result;
      memory = { facts: Array.isArray(parsed?.facts) ? parsed.facts : [] };
    }
  } catch {}

  const personalities = {
    default: 'Eres LION, una IA personal amigable, inteligente y directa. Ayudas con cualquier tema. Responde en español. Sé conciso y útil. Usa emojis con moderación.',
    amigo: 'Eres LION, un amigo cercano y relajado. Hablas de forma casual, eres divertido. Responde en español.',
    profesor: 'Eres LION, un profesor paciente y detallado. Explicas paso a paso. Responde en español.',
    motivador: 'Eres LION, un coach motivacional energético y positivo. Responde en español.',
    sarcastico: 'Eres LION, una IA con humor sarcástico pero siempre útil. Responde en español.'
  };

  const baseSystem = personalities[personality] || personalities.default;
  const memoryContext = memory.facts.length > 0 ? `\n\nRecuerdas esto del usuario:\n${memory.facts.join('\n')}` : '';
  const system = baseSystem + memoryContext;

  const user = username || 'anon';
  const lastUserMsg = messages[messages.length - 1];
  const userText = Array.isArray(lastUserMsg?.content)
    ? lastUserMsg.content.find(c => c.type === 'text')?.text || ''
    : lastUserMsg?.content || '';

  const extractFacts = (text) => {
    const facts = [];
    const checks = [
      [/(?:me llamo|mi nombre es)\s+([A-ZÁ-Úa-zá-ú]+)/i, m => `Nombre: ${m[1]}`],
      [/tengo\s+(\d+)\s+años?/i, m => `Edad: ${m[1]} años`],
      [/(?:vivo en|soy de)\s+([A-ZÁ-Úa-zá-ú\s]+?)(?:\.|,|$)/i, m => `Ciudad: ${m[1].trim()}`],
      [/(?:me gusta|me encanta)\s+(.{3,40})(?:\.|,|$)/i, m => `Le gusta: ${m[1].trim()}`],
      [/(?:trabajo|estudio)\s+(?:en|como)?\s*(.{3,40})(?:\.|,|$)/i, m => `Trabajo/Estudio: ${m[1].trim()}`],
    ];
    for (const [regex, fn] of checks) {
      const m = text.match(regex);
      if (m) facts.push(fn(m));
    }
    return facts;
  };

  const newFacts = extractFacts(userText);
  if (newFacts.length > 0) {
    const updated = [...new Set([...memory.facts, ...newFacts])].slice(-20);
    fetch(`${kv}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', `memory:${user}`, JSON.stringify({ facts: updated })]])
    }).catch(() => {});
  }

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
      system,
      messages
    })
  });

  const data = await response.json();
  const reply = data.content?.map(b => b.text || '').join('') || '';

  try {
    const day = new Date().toISOString().split('T')[0];
    const pipe = [
      ['INCR', 'stats:msgs:total'],
      ['INCR', `stats:msgs:${day}`],
      ['INCR', `stats:users:${user}`],
      ['LPUSH', `history:${user}`, JSON.stringify({ ts: Date.now(), user: userText, lion: reply })],
      ['LTRIM', `history:${user}`, 0, 49],
      ['SADD', 'users:all', user]
    ];
    await fetch(`${kv}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipe)
    });
  } catch {}

  res.status(200).json(data);
}
