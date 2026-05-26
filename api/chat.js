export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OLLAMA_API_KEY || '';
  const ollamaUrl = process.env.OLLAMA_API_URL || 'https://ollama.com';

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Ollama error:', response.status, errText);
      return res.status(response.status).send(errText);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    console.error('Chat proxy error:', err);
    res.status(502).json({ error: err.message });
  }
}