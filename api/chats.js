export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, password, username, personality } = req.body;
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

  // Load user memory
  const user = username || 'anon';
  const memoryRaw = await kvGet(`memory:${user}`);
  const memory = memoryRaw ? JSON.parse(memoryRaw) : { facts: [], summary: '' };

  const personalities = {
    default: 'Eres LION, una IA personal amigable, inteligente y directa. Ayudas con cualquier tema. Responde en español. Sé conciso y útil. Usa emojis con moderación.',
    amigo: 'Eres LION, un amigo cercano y relajado. Hablas de forma casual, usas slang, eres divertido. Tratas al usuario como tu mejor amigo. Responde en español.',
    profesor: 'Eres LION, un profesor paciente y detallado. Explicas paso a paso con ejemplos. Eres formal pero accesible. Responde en español.',
    motivador: 'Eres LION, un coach motivacional energético. Siempre positivo, entusiasta, con muchos emojis. Responde en español.',
    sarcastico: 'Eres LION, una IA con humor sarcástico e ironía inteligente, pero siempre útil al final. Responde en español.'
  };

  const baseSystem = personalities[personality] || personalities.default;

  // Build memory context
  let memoryContext = '';
  if (memory.facts.length > 0) {
    memoryContext = `\n\nLo que recuerdas del usuario ${user}:\n${memory.facts.join('\n')}`;
    if (memory.summary) memoryContext += `\nResumen de conversaciones anteriores: ${memory.summary}`;
  }

  const system = baseSystem + memoryContext + '\n\nSi el usuario menciona información personal importante (nombre, gustos, trabajo, etc.), recuérdala para futuras conversaciones. Al final de cada respuesta larga, identifica silenciosamente qué datos nuevos aprendiste del usuario.';

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

  // Extract and save new facts from conversation
  try {
    const lastUserMsg = messages[messages.length - 1];
    const userText = Array.isArray(lastUserMsg?.content)
      ? lastUserMsg.content.find(c => c.type === 'text')?.text || ''
      : lastUserMsg?.content || '';

    // Use AI to extract facts
    const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        system: 'Eres un extractor de datos. Si el mensaje del usuario contiene información personal importante (nombre real, edad, trabajo, ciudad, gustos, familia, objetivos), extráela como lista de hechos cortos. Si no hay nada importante, responde solo "NADA".',
        messages: [{ role: 'user', content: userText }]
      })
    });

    const extractData = await extractRes.json();
    const extracted = extractData.content?.[0]?.text || 'NADA';

    if (extracted !== 'NADA' && extracted.length > 5) {
      const newFacts = extracted.split('\n').filter(f => f.trim().length > 3);
      const updatedFacts = [...new Set([...memory.facts, ...newFacts])].slice(-20);
      await kvSet(`memory:${user}`, JSON.stringify({ facts: updatedFacts, summary: memory.summary }));
    }
  } catch(e) { console.error('Memory error:', e); }

  // Save stats and history
  try {
    const now = Date.now();
    const day = new Date().toISOString().split('T')[0];
    const lastMsg = messages[messages.length - 1];
    const userText = Array.isArray(lastMsg?.content)
      ? lastMsg.content.find(c => c.type === 'text')?.text || '[imagen]'
      : lastMsg?.content || '';

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
