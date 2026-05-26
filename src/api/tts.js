const ELEVENLABS_VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID || 'SAz9YHcvj6GT2YYXdXww';

const STORAGE_KEY = 'll-tts-settings';

const DEFAULTS = {
  voiceId: ELEVENLABS_VOICE_ID,
  stability: 0.7,
  similarity_boost: 0.75,
  speed: 0.7,
};

export function getTTSSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTTSSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function hasTTS() {
  return true;
}

export async function speakWithLang(text, langKey, settingsOverride) {
  const settings = settingsOverride || getTTSSettings();

  try {
    const res = await fetch(`/api/tts/${settings.voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voiceId: settings.voiceId,
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: settings.stability,
          similarity_boost: settings.similarity_boost,
          speed: settings.speed,
        },
      }),
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      return;
    }
    console.warn('TTS failed:', res.status, await res.text());
  } catch (e) {
    console.warn('TTS error:', e);
  }

  return browserSpeak(text, langKey, settings.speed);
}

function browserSpeak(text, langKey, speed) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    const langMap = { en: 'en-US', es: 'es-ES', hi: 'hi-IN', hin: 'hi-IN' };
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = langMap[langKey] || 'en-US';
    utt.rate = speed;
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    window.speechSynthesis.speak(utt);
  });
}

export function getVoiceLang(langKey) {
  const langMap = { en: 'en-US', es: 'es-ES', hi: 'hi-IN' };
  return langMap[langKey] || 'en-US';
}

export { ELEVENLABS_VOICE_ID };