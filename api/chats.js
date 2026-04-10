export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { messages } = req.body;
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
  res.status(200).json(data);
}
