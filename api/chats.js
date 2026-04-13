export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { messages, password, username, personality } = body;
  if (password !== process.env.APP_PASSWORD && password !== 'google-oauth') return res.status(401).json({ error: 'Contraseña incorrecta' });

  const kv = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const tavilyKey = process.env.TAVILY_API_KEY;

  // Load memory
  let memory = { facts: [] };
  try {
    const r = await fetch(`${kv}/get/memory:${encodeURIComponent(username||'anon')}`, { headers: { Authorization: `Bearer ${kvToken}` } });
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

  const user = username || 'anon';
  const lastUserMsg = messages[messages.length - 1];
  const userText = Array.isArray(lastUserMsg?.content)
    ? lastUserMsg.content.find(c => c.type === 'text')?.text || ''
    : lastUserMsg?.content || '';

  // Detect if search is needed
  const needsSearch = (text) => {
    const t = text.toLowerCase();
    const triggers = ['hoy', 'ahora', 'actualmente', 'precio', 'dólar', 'noticias', 'clima', 'tiempo en', 'cuánto cuesta', 'última', 'último', 'reciente', 'este año', 'este mes', '2024', '2025', '2026', 'qué pasó', 'quién ganó', 'resultado'];
    return triggers.some(w => t.includes(w));
  };

  // Web search with Tavily
  let searchContext = '';
  if (tavilyKey && needsSearch(userText)) {
    try {
      const searchRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: userText,
          search_depth: 'basic',
          max_results: 3,
          include_answer: true
        })
      });
      const searchData = await searchRes.json();
      if (searchData.answer || searchData.results?.length > 0) {
        searchContext = '\n\n🔍 INFORMACIÓN ACTUALIZADA DE INTERNET:\n';
        if (searchData.answer) searchContext += `Respuesta directa: ${searchData.answer}\n`;
        if (searchData.results?.length > 0) {
          searchData.results.slice(0, 3).forEach(r => {
            searchContext += `\nFuente: ${r.title}\n${r.content?.slice(0, 300)}\n`;
          });
        }
        searchContext += '\nUsa esta información para responder con datos actualizados.';
      }
    } catch(e) { console.error('Search error:', e); }
  }

  const system = baseSystem + memoryContext + searchContext + '\n\nSi usaste búsqueda web, menciona brevemente que la información es de internet con 🌐.';

  // Extract facts
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
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
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
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipe)
    });
  } catch {}

  res.status(200).json(data);
}
