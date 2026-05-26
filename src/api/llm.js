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
    scenarioHint: 'everyday American life — going to a coffee shop, chatting with neighbors, casual workplace conversations',
    cultureHint: 'Use natural everyday American English — casual, short sentences, common contractions.',
    voiceLang: 'en-US',
  },
  es: {
    name: 'Guatemalan/Latin American Spanish',
    scenarioHint: 'everyday life in Guatemala — visiting the local market, eating at a small family restaurant, taking a chicken bus, family gatherings',
    cultureHint: 'Use everyday Guatemalan/Latin American Spanish — "buenas" for greetings, local expressions like "chévere", "pisto", "vámonos", etc. Sound like a real Guatemalan talking.',
    voiceLang: 'es-ES',
  },
  hi: {
    name: 'Hindi (written in English words, Hinglish)',
    scenarioHint: 'everyday life in India — getting tea at a roadside stall, bargaining at a market, chatting with friends on the street, family occasions',
    cultureHint: 'Use everyday Hinglish — the way Hindi speakers text and chat. E.g. "kya kar raha hai?", "chalo", "haan bilkul", etc.',
    voiceLang: 'hi-IN',
  },
  hin: {
    name: 'Hindi (Devanagari)',
    scenarioHint: 'everyday life in India — getting tea at a roadside stall, bargaining at a market, chatting with friends on the street, family occasions',
    cultureHint: 'Use everyday Hindi written in Devanagari script — natural conversational Hindi as spoken in India. E.g. "क्या कर रहे हो?", "चलो", "हाँ बिलकुल" etc. Not overly Sanskritized — real spoken Hindi.',
    voiceLang: 'hi-IN',
  },
  de: {
    name: 'German',
    scenarioHint: 'everyday life in Germany — getting bread from the bakery, riding the subway, chatting at a beer garden, visiting friends',
    cultureHint: 'Use natural everyday German — casual, conversational, not overly formal. Use "du" form by default. Common contractions like "hab ich", "wollt ich", local expressions.',
    voiceLang: 'de-DE',
  },
  ja: {
    name: 'Japanese (Romaji)',
    scenarioHint: 'everyday life in Japan — convenience store runs, eating ramen, commuting on the train, chatting with coworkers',
    cultureHint: 'Use everyday Japanese written in Romaji (English alphabet) — the way learners practice. E.g. "konnichiwa", "ogenki desu ka?", "iidesu yo", "sou desu ne". Use casual form (ta-gen) unless formal is appropriate. Sound like a real Japanese person chatting, not a textbook.',
    voiceLang: 'ja-JP',
  },
  zhp: {
    name: 'Mandarin Chinese (Pinyin)',
    scenarioHint: 'everyday life in China — eating at a noodle shop, haggling at a market, taking the subway, visiting friends',
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

async function* callLLMStream(systemPrompt, userPrompt, extraMessages) {
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
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.message?.content) {
          yield data.message.content;
        }
      } catch {}
    }
  }
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
- Do NOT repeat or closely paraphrase any previously generated passages
- You MUST output EXACTLY the requested number of lines — no more, no less
- Do NOT include any ${tgt.name} text — write ONLY in ${src.name}
- Do NOT add parenthetical translations, brackets, or any explanation`;

  const user = `Generate a ${difficulty}-level passage in ${src.name} about "${topic}" for someone learning ${tgt.name}.

The passage should depict a scenario from ${tgt.scenarioHint}

IMPORTANT: The passage MUST be written entirely in ${src.name}. Even though the scenario is set in a ${tgt.name}-speaking culture, do NOT use any ${tgt.name} words — write only in ${src.name}.

Write in ${src.name} using this style: ${src.cultureHint}

IMPORTANT: Output EXACTLY ${lineCount} line${lineCount > 1 ? 's' : ''}, no more, no less.

Requirements:
- EXACTLY ${lineCount} line${lineCount > 1 ? 's' : ''} — this is mandatory, do not write more or fewer
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
  const lines = text.split('\n').map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean).slice(0, lineCount);
  const passageText = lines.join('\n');
  addConversationEntry(topic, passageText);
  return lines;
}

export function generatePassageStream(difficulty, topic, lineCount, sourceLang, targetLang) {
  const prev = getConversationHistory(topic);
  const src = LANG_INFO[sourceLang];
  const tgt = LANG_INFO[targetLang];

  const system = `You are a language learning assistant helping someone learn ${tgt.name}. You create short passages in ${src.name} that depict everyday scenarios from ${tgt.name}-speaking cultures. The goal is for the learner to translate these from ${src.name} into ${tgt.name}, so the ${src.name} should feel like a natural ${src.name} version of a ${tgt.name}-speaking conversation.

CRITICAL RULES:
- Write how normal people actually talk — real casual conversation, not a movie script
- Do NOT use forced slang, excessive idioms, or "creative" vocabulary
- Keep it simple, direct, and natural
- Do NOT repeat or closely paraphrase any previously generated passages
- You MUST output EXACTLY the requested number of lines — no more, no less
- Do NOT include any ${tgt.name} text — write ONLY in ${src.name}
- Do NOT add parenthetical translations, brackets, or any explanation`;

  const user = `Generate a ${difficulty}-level passage in ${src.name} about "${topic}" for someone learning ${tgt.name}.

The passage should depict a scenario from ${tgt.scenarioHint}

IMPORTANT: The passage MUST be written entirely in ${src.name}. Even though the scenario is set in a ${tgt.name}-speaking culture, do NOT use any ${tgt.name} words — write only in ${src.name}.

Write in ${src.name} using this style: ${src.cultureHint}

IMPORTANT: Output EXACTLY ${lineCount} line${lineCount > 1 ? 's' : ''}, no more, no less.

Requirements:
- EXACTLY ${lineCount} line${lineCount > 1 ? 's' : ''} — this is mandatory, do not write more or fewer
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

  return callLLMStream(system, user, contextMessages);
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
- In "corrected", put how a native ${tgt.name} speaker would naturally say it
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

  const system = `You are a professional translator. You translate passages from ${src.name} to ${tgt.name}.

STRICT RULES:
- Translate each line of the source passage into ${tgt.name}
- Keep the same number of lines
- Do NOT add commentary, greetings, or extra content
- Do NOT add exclamations or opinions
- Output ONLY the translated text, one line per source line`;

  const user = `Translate this ${src.name} passage into ${tgt.name}. ${tgt.cultureHint}

Source:
${englishPassage}

Output ONLY the translated lines, one per line. Same number of lines as the source.`;

  const result = await callLLM(system, user);
  return result.trim();
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

  const dontUnderstand = targetLang === 'ja' ? 'Wakaranai, mou ichido itte?'
    : targetLang === 'de' ? 'Ich habe nicht verstanden, kannst du das wiederholen?'
    : targetLang === 'hi' || targetLang === 'hin' ? 'Samajh nahi aaya, phir se bolo?'
    : targetLang === 'zhp' ? 'Wǒ méi tīng dǒng, nǐ néng zài shuō yīcì ma?'
    : targetLang === 'en' ? 'I didn\'t quite get that, could you say that again?'
    : 'No entendí, ¿puedes repetir?';

  const system = `You are a ${personalityHint} native ${tgt.name} ${targetGender} having a casual conversation with a language learner.
${genderHint}
${learnerHint}

RULES:
- Always respond ONLY in ${tgt.name}, never any other language
- Keep responses short and natural — 1-2 sentences max
- ${tgt.cultureHint}
- Be ${personalityHint}

FORMAT: Always respond in exactly this format:
[corrected] ... [/corrected] [reply] ... [/reply]

The [corrected] section: If the learner's previous message had mistakes, briefly fix them. If it was correct, just repeat what they said. If it makes no sense at all, say "${dontUnderstand}"
The [reply] section: Continue the conversation naturally.

Example when learner makes a mistake:
[corrected] (corrected version of what they said) [/corrected] [reply] (your natural reply) [/reply]

Example when learner is correct:
[corrected] (repeat what they said) [/corrected] [reply] (your natural reply) [/reply]`;

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

  const dontUnderstand = targetLang === 'ja' ? 'Wakaranai, mou ichido itte?'
    : targetLang === 'de' ? 'Ich habe nicht verstanden, kannst du das wiederholen?'
    : targetLang === 'hi' || targetLang === 'hin' ? 'Samajh nahi aaya, phir se bolo?'
    : targetLang === 'zhp' ? 'Wǒ méi tīng dǒng, nǐ néng zài shuō yīcì ma?'
    : targetLang === 'en' ? 'I didn\'t quite get that, could you say that again?'
    : 'No entendí, ¿puedes repetir?';

  const system = `You are a ${personalityHint} native ${tgt.name} ${targetGender} having a casual conversation with a language learner.
${genderHint}
${learnerHint}

RULES:
- Always respond ONLY in ${tgt.name}, never any other language
- Keep responses short and natural — 1-2 sentences max
- ${tgt.cultureHint}
- Be ${personalityHint}

FORMAT: Always respond in exactly this format:
[corrected] ... [/corrected] [reply] ... [/reply]

The [corrected] section: Look at what the learner just said.
- If they made mistakes, briefly write the corrected version of their sentence
- If they were correct, repeat what they said
- If it makes no sense at all or is incomprehensible, say "${dontUnderstand}"

The [reply] section: Continue the conversation naturally.

Example when learner makes a mistake:
[corrected] (corrected version of what they said) [/corrected] [reply] (your natural reply) [/reply]

Example when learner is correct:
[corrected] (repeat what they said) [/corrected] [reply] (your natural reply) [/reply]

Example when learner says something incomprehensible:
[corrected] ${dontUnderstand} [/corrected] [reply] (gently ask them to try again) [/reply]`;

  const user = `Continue the conversation. The learner just said: "${messages[messages.length - 1].content}"`;

  const chatMessages = messages.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const text = await callLLM(system, user, chatMessages);
  return text.trim();
}

export function continueConversationStream(messages, targetLang, difficulty, topic, userGender, targetGender, personality) {
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

  const dontUnderstand = targetLang === 'ja' ? 'Wakaranai, mou ichido itte?'
    : targetLang === 'de' ? 'Ich habe nicht verstanden, kannst du das wiederholen?'
    : targetLang === 'hi' || targetLang === 'hin' ? 'Samajh nahi aaya, phir se bolo?'
    : targetLang === 'zhp' ? 'Wǒ méi tīng dǒng, nǐ néng zài shuō yīcì ma?'
    : targetLang === 'en' ? 'I didn\'t quite get that, could you say that again?'
    : 'No entendí, ¿puedes repetir?';

  const system = `You are a ${personalityHint} native ${tgt.name} ${targetGender} having a casual conversation with a language learner.
${genderHint}
${learnerHint}

RULES:
- Always respond ONLY in ${tgt.name}, never any other language
- Keep responses short and natural — 1-2 sentences max
- ${tgt.cultureHint}
- Be ${personalityHint}

FORMAT: Always respond in exactly this format:
[corrected] ... [/corrected] [reply] ... [/reply]

The [corrected] section: Look at what the learner just said.
- If they made mistakes, briefly write the corrected version of their sentence
- If they were correct, repeat what they said
- If it makes no sense at all or is incomprehensible, say "${dontUnderstand}"

The [reply] section: Continue the conversation naturally.

Example when learner makes a mistake:
[corrected] (corrected version of what they said) [/corrected] [reply] (your natural reply) [/reply]

Example when learner is correct:
[corrected] (repeat what they said) [/corrected] [reply] (your natural reply) [/reply]

Example when learner says something incomprehensible:
[corrected] ${dontUnderstand} [/corrected] [reply] (gently ask them to try again) [/reply]`;

  const user = `Continue the conversation. The learner just said: "${messages[messages.length - 1].content}"`;

  const chatMessages = messages.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return callLLMStream(system, user, chatMessages);
}

export async function translateToSource(text, targetLang, sourceLang) {
  const tgtInfo = LANG_INFO[targetLang];
  const srcInfo = LANG_INFO[sourceLang];

  const system = `You are a professional translator. You translate from ${tgtInfo.name} to ${srcInfo.name}.

STRICT RULES:
- Translate the text accurately and naturally
- Do NOT add commentary, greetings, or extra content
- Do NOT add exclamations or opinions
- Output ONLY the translation, nothing else`;

  const user = `Translate the following ${tgtInfo.name} text to ${srcInfo.name}. ${srcInfo.cultureHint}\n\n${text}`;

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