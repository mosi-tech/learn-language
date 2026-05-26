export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  if (!apiKey) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
  }

  const voiceId = req.query.voiceId || req.body?.voiceId;
  if (!voiceId) {
    return res.status(400).json({ error: 'Missing voiceId' });
  }

  const { text, model_id, voice_settings } = req.body;

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({ text, model_id, voice_settings }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('ElevenLabs error:', response.status, errText);
      return res.status(response.status).send(errText);
    }

    const audioBuffer = await response.arrayBuffer();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.status(200).send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error('TTS proxy error:', err);
    res.status(502).json({ error: err.message });
  }
}