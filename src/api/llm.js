const OLLAMA_URL = import.meta.env.VITE_OLLAMA_API_URL || '';

let currentModel = import.meta.env.VITE_LLM_MODEL || 'gemini-3-flash-preview:cloud';

export function getModel() {
  return currentModel;
}

export function setModel(model) {
  currentModel = model;
}

const HISTORY_KEY = 'll-convos';

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function getConversationHistory(topic) {
  const history = loadHistory();
  return history[topic] || [];
}

export function addConversationEntry(topic, passage) {
  const history = loadHistory();
  if (!history[topic]) history[topic] = [];
  history[topic].push(passage);
  saveHistory(history);
}

export function clearHistory(topic) {
  const history = loadHistory();
  if (topic) {
    delete history[topic];
  } else {
    Object.keys(history).forEach((k) => delete history[k]);
  }
  saveHistory(history);
}

const LANG_INFO = {
  en: {
    name: 'English',
    cultureHint: 'Use natural everyday American English — casual, short sentences, common contractions.',
    voiceLang: 'en-US',
  },
  es: {
    name: 'Guatemalan/Latin American Spanish',
    cultureHint: 'Use everyday Guatemalan/Latin American Spanish — "buenas" for greetings, local expressions like "chévere", "pisto", "vámonos", etc. Sound like a real Guatemalan talking.',
    voiceLang: 'es-ES',
  },
  hi: {
    name: 'Hindi (written in English words, Hinglish)',
    cultureHint: 'Use everyday Hinglish — the way Hindi speakers text and chat. E.g. "kya kar raha hai?", "chalo", "haan bilkul", etc.',
    voiceLang: 'hi-IN',
  },
  hin: {
    name: 'Hindi (Devanagari)',
    cultureHint: 'Use everyday Hindi written in Devanagari script — natural conversational Hindi as spoken in India. E.g. "क्या कर रहे हो?", "चलो", "हाँ बिलकुल" etc. Not overly Sanskritized — real spoken Hindi.',
    voiceLang: 'hi-IN',
  },
  de: {
    name: 'German',
    cultureHint: 'Use natural everyday German — casual, conversational, not overly formal. Use "du" form by default. Common contractions like "hab ich", "wollt ich", local expressions.',
    voiceLang: 'de-DE',
  },
  ja: {
    name: 'Japanese (Romaji)',
    cultureHint: 'Use everyday Japanese written in Romaji (English alphabet) — the way learners practice. E.g. "konnichiwa", "ogenki desu ka?", "iidesu yo", "sou desu ne". Use casual form (ta-gen) unless formal is appropriate. Sound like a real Japanese person chatting, not a textbook.',
    voiceLang: 'ja-JP',
  },
  zhp: {
    name: 'Mandarin Chinese (Pinyin)',
    cultureHint: 'Use everyday Mandarin Chinese written in Pinyin (English alphabet with tone marks) — the way learners practice. E.g. "nǐ hǎo", "wǒ è le", "zhēn de ma?", "hǎo ba". Sound like a real Chinese person chatting casually, not a textbook.',
    voiceLang: 'zh-CN',
  },
};

export function getVoiceLang(langKey) {
  return LANG_INFO[langKey]?.voiceLang || 'en-US';
}

async function callLLM(systemPrompt, userPrompt, extraMessages) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(extraMessages || []),
    { role: 'user', content: userPrompt },
  ];

  const apiUrl = OLLAMA_URL ? `${OLLAMA_URL}/api/chat` : '/api/chat';
  const headers = { 'Content-Type': 'application/json' };

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: currentModel,
      messages,
      stream: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  if (data.message?.content) {
    return data.message.content;
  }
  if (data.content) {
    return data.content;
  }
  throw new Error('No text response from model');
}

export async function generatePassage(difficulty, topic, lineCount, sourceLang, targetLang) {
  const prev = getConversationHistory(topic);
  const src = LANG_INFO[sourceLang];
  const tgt = LANG_INFO[targetLang];

  const system = `You are a language learning assistant helping someone learn ${tgt.name}. You create short passages in ${src.name} that depict everyday scenarios from ${tgt.name}-speaking cultures. The goal is for the learner to translate these from ${src.name} into ${tgt.name}, so the ${src.name} should feel like a natural ${src.name} version of a ${tgt.name}-speaking conversation.

CRITICAL RULES:
- Write how normal people actually talk — real casual conversation, not a movie script
- Do NOT use forced slang, excessive idioms, or "creative" vocabulary
- Keep it simple, direct, and natural
- Do NOT repeat or closely paraphrase any previously generated passages`;

  const user = `Generate a ${difficulty}-level passage in ${src.name} about "${topic}" for someone learning ${tgt.name}.

The passage should depict a scenario from ${tgt.cultureHint}

Requirements:
- Exactly ${lineCount} lines/sentences
- Difficulty: ${difficulty} (${difficulty === 'easy' ? 'short simple sentences, basic vocabulary' : difficulty === 'medium' ? 'moderate sentences, some natural expressions' : 'longer sentences, natural phrasing, some colloquial expressions'})
- Each line should sound like something a real person would casually say in ${src.name}
- Write plain, natural ${src.name} — no forced idioms, no exaggerated slang
- Do NOT number the lines
- Do NOT add any labels, headers, or explanations
- Output ONLY the passage lines, one per line`;

  const contextMessages = prev.slice(-6).flatMap((p) => [
    { role: 'user', content: `[Previously generated for reference — do NOT repeat]:\n${p}` },
    { role: 'assistant', content: p },
  ]);

  const text = await callLLM(system, user, contextMessages);
  const lines = text.split('\n').map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
  const passageText = lines.join('\n');
  addConversationEntry(topic, passageText);
  return lines;
}

export async function evaluateTranslation(englishPassage, userTranslation, sourceLang, targetLang) {
  const src = LANG_INFO[sourceLang];
  const tgt = LANG_INFO[targetLang];

  const system = `You are a friendly language teacher evaluating a student's translation from ${src.name} to ${tgt.name}. You care about whether the student conveyed the RIGHT MEANING and SPIRIT — not whether they used the exact same words. There are many valid ways to say the same thing, and you give full credit for any natural, idiomatic expression that correctly conveys the intended meaning.

IMPORTANT:
- Ignore minor orthographic issues like missing accents, diacritics, or punctuation
- ${targetLang === 'hi' ? 'Accept any reasonable romanization (e.g. "kya" vs "kia" vs "kiya" are all valid).' : 'Focus on how native speakers would naturally say it. Multiple valid ways of expressing the same thing are all correct.'}
- A translation is WRONG only if it changes the meaning or is incomprehensible.
- Only mark something as "wrong" if it genuinely conveys the wrong meaning or is grammatically broken.`;

  const user = `Source passage in ${src.name} (line by line):
${englishPassage}

Student's ${tgt.name} translation (line by line):
${userTranslation}

Evaluate this translation. Respond ONLY with valid JSON (no markdown, no backticks):
{
  "score": <number 0-100>,
  "feedback": "<brief feedback, 2-3 sentences>",
  "correctedLines": [
    {
      "original": "<student's line exactly as written>",
      "corrected": "<the correct version of that line>",
      "changes": [
        {"wrong": "<wrong word/phrase from student>", "right": "<the correct word/phrase>"}
      ]
    }
  ]
}

Scoring guidelines:
- 90-100: The meaning and spirit are fully conveyed
- 75-89: Mostly correct, minor meaning differences
- 50-74: Understandable but some meanings are off
- 25-49: Significant meaning errors
- 0-24: Mostly incomprehensible or wrong meaning

For correctedLines:
- Split the student's translation into lines matching the source passage
- In "original", put the student's exact text for that line
- In "corrected", put how a native ${tgt.cultureHint.slice(0, tgt.cultureHint.indexOf('—') > 0 ? tgt.cultureHint.indexOf('—') : tgt.cultureHint.length)}
- In "changes", list ONLY genuine meaning errors — not just different phrasings
- If a line conveys the right meaning, set changes to []
- Keep the number of lines matching the source passage`;

  const text = await callLLM(system, user);
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { score: 0, feedback: 'Could not parse evaluation. Try again.', correctedLines: [] };
  }
}

export async function getCorrectTranslation(englishPassage, sourceLang, targetLang) {
  const src = LANG_INFO[sourceLang];
  const tgt = LANG_INFO[targetLang];

  const system = `You are a native-level ${tgt.name} speaker and language teacher. You provide natural, colloquial translations that sound like how a native speaker would actually say it in everyday conversation — not textbook/formal language. ${targetLang === 'es' ? 'Use everyday Guatemalan/Latin American Spanish — vos or tú are both fine.' : ''}`;

  const user = `Translate this ${src.name} passage into natural, everyday ${tgt.name}.

${tgt.cultureHint}

Source passage:
${englishPassage}

Output ONLY the translated lines, one per line. No labels, no numbers, no explanations.`;

  return await callLLM(system, user);
}

export async function startConversation(difficulty, topic, targetLang, userGender, targetGender, personality) {
  const tgt = LANG_INFO[targetLang];
  const personalityHint = {
    friendly: 'warm, casual, and approachable',
    professional: 'polite, professional, but still conversational',
    funny: 'humorous, playful, uses jokes and light teasing',
    patient: 'very patient, speaks slowly and clearly, gives gentle encouragement',
    encouraging: 'enthusiastic, gives lots of positive feedback and praise',
    therapist: 'a caring therapist — asks thoughtful questions, listens actively, reflects back what was said, offers gentle insights, creates a safe supportive space',
  }[personality] || 'warm and friendly';

  const genderHint = targetGender === 'woman'
    ? `You are a woman. Use feminine speech patterns naturally.`
    : `You are a man. Use masculine speech patterns naturally.`;
  const learnerHint = userGender === 'woman'
    ? `The learner is a woman.`
    : `The learner is a man.`;

  const system = `You are a ${personalityHint} native ${tgt.name} ${targetGender} having a casual conversation with a language learner.
${genderHint}
${learnerHint}

RULES:
- Always respond ONLY in ${tgt.name}, never English
- Keep responses short and natural — 1-2 sentences max
- ${tgt.cultureHint}
- Be ${personalityHint}

FORMAT: Always respond in exactly this format:
[corrected] ... [/corrected] [reply] ... [/reply]

The [corrected] section: If the learner's previous message had mistakes, briefly fix them. If it was correct, just repeat what they said. If it makes no sense at all, say "I didn't understand that, could you try again?"
The [reply] section: Continue the conversation naturally.

Example when learner makes a mistake saying "yo tener hambre":
[corrected] Tienes hambre [/corrected] [reply] ¿Tienes hambre? Vamos a comer algo, ¿qué se te antoja? [/reply]

Example when learner is correct saying "tengo hambre":
[corrected] Tengo hambre [/corrected] [reply] ¡Qué bueno! ¿Qué quieres comer? [/reply]`;

  const user = `Start a casual conversation with me about "${topic}". Keep it ${difficulty} level. Since this is the start, just say your opening line. Format: [corrected] (leave empty since learner hasn't spoken yet) [/corrected] [reply] your opening line here [/reply]`;

  const text = await callLLM(system, user);
  return text.trim();
}

export async function continueConversation(messages, targetLang, difficulty, topic, userGender, targetGender, personality) {
  const tgt = LANG_INFO[targetLang];
  const personalityHint = {
    friendly: 'warm, casual, and approachable',
    professional: 'polite, professional, but still conversational',
    funny: 'humorous, playful, uses jokes and light teasing',
    patient: 'very patient, speaks slowly and clearly, gives gentle encouragement',
    encouraging: 'enthusiastic, gives lots of positive feedback and praise',
    therapist: 'a caring therapist — asks thoughtful questions, listens actively, reflects back what was said, offers gentle insights, creates a safe supportive space',
  }[personality] || 'warm and friendly';

  const genderHint = targetGender === 'woman'
    ? `You are a woman. Use feminine speech patterns naturally.`
    : `You are a man. Use masculine speech patterns naturally.`;
  const learnerHint = userGender === 'woman'
    ? `The learner is a woman.`
    : `The learner is a man.`;

  const system = `You are a ${personalityHint} native ${tgt.name} ${targetGender} having a casual conversation with a language learner.
${genderHint}
${learnerHint}

RULES:
- Always respond ONLY in ${tgt.name}, never English
- Keep responses short and natural — 1-2 sentences max
- ${tgt.cultureHint}
- Be ${personalityHint}

FORMAT: Always respond in exactly this format:
[corrected] ... [/corrected] [reply] ... [/reply]

The [corrected] section: Look at what the learner just said.
- If they made mistakes, briefly write the corrected version of their sentence
- If they were correct, repeat what they said
- If it makes no sense at all or is incomprehensible, say "No entendí, ¿puedes repetir?" (or equivalent in the target language)

The [reply] section: Continue the conversation naturally.

Examples:

Learner says "yo tener hambre" (wrong: should be "tengo"):
[corrected] Tengo hambre [/corrected] [reply] ¿Tienes hambre? Vamos a comer algo [/reply]

Learner says "tengo hambre" (correct):
[corrected] Tengo hambre [/corrected] [reply] ¡Sí! ¿Qué quieres comer? [/reply]

Learner says "asdfghjkl" (nonsensical):
[corrected] No entendí, ¿puedes repetir? [/corrected] [reply] No te entendí, ¿puedes intentar de nuevo? [/reply]`;

  const user = `Continue the conversation. The learner just said: "${messages[messages.length - 1].content}"`;

  const chatMessages = messages.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const text = await callLLM(system, user, chatMessages);
  return text.trim();
}

export async function translateToSource(text, targetLang, sourceLang) {
  const tgtInfo = LANG_INFO[targetLang];
  const srcInfo = LANG_INFO[sourceLang];

  const system = `You are a translator. Translate the following ${tgtInfo.name} text to ${srcInfo.name}. Output ONLY the ${srcInfo.name} translation, nothing else.`;

  const user = text;

  const result = await callLLM(system, user);
  return result.trim();
}

export async function suggestResponse(chatMessages, targetLang, difficulty) {
  const tgt = LANG_INFO[targetLang];

  const system = `You are a language learning assistant. The learner is stuck and needs a suggestion for what to say next in their ${tgt.name} conversation. Give them a short, natural response they could say — 1 sentence max. Output ONLY the suggested response in ${tgt.name}, nothing else. ${tgt.cultureHint}`;

  const lastMsg = [...chatMessages].reverse().find((m) => m.role === 'assistant');
  const user = `The last thing said to them was: "${lastMsg ? lastMsg.content : ''}". Give me a natural ${difficulty}-level response they could say next.`;

  const result = await callLLM(system, user);
  return result.trim();
}