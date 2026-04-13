export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { messages, password, username, personality } = body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid messages' });
  if (password !== process.env.APP_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });

  const kv = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const kvGet = async (key) => {
    try {
      const r = await fetch(`${kv}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      return d.result;
    } catch { return null; }
  };

  const kvSet = async (key, value) => {
    try {
      await fetch(`${kv}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
    } catch {}
  };

  const user = username || 'anon';
  const memoryRaw = await kvGet(`memory:${user}`);
  const memory = memoryRaw ? JSON.parse(memoryRaw) : { facts: [] };

  const personalities = {
    default: 'Eres LION, una IA personal amigable, inteligente y directa. Ayudas con cualquier tema. Responde en español. Sé conciso y útil. Usa emojis con moderación.',
    amigo: 'Eres LION, un amigo cercano y relajado. Hablas de forma casual, eres divertido. Responde en español.',
    profesor: 'Eres LION, un profesor paciente y detallado. Explicas paso a paso. Responde en español.',
    motivador: 'Eres LION, un coach motivacional energético y positivo. Responde en español.',
    sarcastico: 'Eres LION, una IA con humor sarcástico pero siempre útil. Responde en español.'
  };

  const baseSystem = personalities[personality] || personalities.default;
  let memoryContext = '';
  if (memory.facts.length > 0) {
    memoryContext = `\n\nRecuerdas esto del usuario ${user}:\n${memory.facts.join('\n')}`;
  }

  // Extract facts with simple regex — no extra API call
  const lastUserMsg = messages[messages.length - 1];
  const userText = Array.isArray(lastUserMsg?.content)
    ? lastUserMsg.content.find(c => c.type === 'text')?.text || ''
    : lastUserMsg?.content || '';

  const extractFacts = (text) => {
    const facts = [];
    const t = text.toLowerCase();
    if (t.includes('me llamo') || t.includes('mi nombre es') || t.includes('soy ')) {
      const m = text.match(/(?:me llamo|mi nombre es|soy)\s+([A-ZÁ-Úa-zá-ú]+)/i);
      if (m) facts.push(`Nombre: ${m[1]}`);
    }
    if (t.includes('tengo') && t.includes('año')) {
      const m = text.match(/tengo\s+(\d+)\s+años?/i);
      if (m) facts.push(`Edad: ${m[1]} años`);
    }
    if (t.includes('vivo en') || t.includes('soy de')) {
      const m = text.match(/(?:vivo en|soy de)\s+([A-ZÁ-Úa-zá-ú\s]+?)(?:\.|,|$)/i);
      if (m) facts.push(`Ciudad: ${m[1].trim()}`);
    }
    if (t.includes('me gusta') || t.includes('me encanta')) {
      const m = text.match(/(?:me gusta|me encanta)\s+(.{3,40})(?:\.|,|$)/i);
      if (m) facts.push(`Le gusta: ${m[1].trim()}`);
    }
    if (t.includes('trabajo') || t.includes('estudio')) {
      const m = text.match(/(?:trabajo|estudio)\s+(?:en|como)?\s*(.{3,40})(?:\.|,|$)/i);
      if (m) facts.push(`Trabajo/Estudio: ${m[1].trim()}`);
    }
    return facts;
  };

  const newFacts = extractFacts(userText);
  if (newFacts.length > 0) {
    const updated = [...new Set([...memory.facts, ...newFacts])].slice(-20);
    kvSet(`memory:${user}`, JSON.stringify({ facts: updated }));
  }

  const system = baseSystem + memoryContext + '\n\nSi el usuario te dice su nombre, edad, gustos o información personal, úsala naturalmente en la conversación.';

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
  const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
  const cost = (tokens / 1000000) * 3;

  try {
    const now = Date.now();
    const day = new Date().toISOString().split('T')[0];
    const pipe = [
      ['INCR', 'stats:msgs:total'],
      ['INCR', `stats:msgs:${day}`],
      ['INCRBYFLOAT', 'stats:cost:total', cost.toFixed(6)],
      ['INCRBYFLOAT', `stats:cost:${day}`, cost.toFixed(6)],
      ['INCR', `stats:users:${user}`],
      ['LPUSH', `history:${user}`, JSON.stringify({ ts: now, user: userText, lion: reply, tokens })],
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
