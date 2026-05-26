import { useState, useCallback, useEffect, useRef } from 'react';
import { generatePassage, generatePassageStream, evaluateTranslation, getCorrectTranslation, setModel as setLLMModel, clearHistory, addConversationEntry, startConversation, continueConversation, continueConversationStream, translateToSource, suggestResponse } from './api/llm';
import { speakWithLang, getVoiceLang, getTTSSettings, saveTTSSettings } from './api/tts';
import './App.css';

function renderSimpleMarkdown(text) {
  if (!text) return text;
  const parts = [];
  const regex = /(\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*.+?\*)|([^*]+)/g;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    const s = match[0];
    if (s.startsWith('***') && s.endsWith('***')) {
      parts.push(<strong key={key++}><em>{s.slice(3, -3)}</em></strong>);
    } else if (s.startsWith('**') && s.endsWith('**')) {
      parts.push(<strong key={key++}>{s.slice(2, -2)}</strong>);
    } else if (s.startsWith('*') && s.endsWith('*')) {
      parts.push(<em key={key++}>{s.slice(1, -1)}</em>);
    } else {
      parts.push(s);
    }
  }
  return parts.length > 0 ? parts : text;
}

const MODELS = [
  { id: 'ministral-3:3b-cloud', label: 'Ministral 3 (Fast)', voice: false },
  { id: 'deepseek-v4-flash:cloud', label: 'DeepSeek V4 Flash', voice: false },
  { id: 'minimax-m2.7:cloud', label: 'MiniMax M2.7', voice: false },
  { id: 'gemini-3-flash-preview:cloud', label: 'Gemini 3 Flash', voice: false },
];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const TOPICS = ['greetings', 'food', 'daily', 'travel', 'work'];
const GENDERS = [
  { key: 'man', label: 'Man' },
  { key: 'woman', label: 'Woman' },
];
const PERSONALITIES = [
  { key: 'friendly', label: 'Friendly' },
  { key: 'professional', label: 'Professional' },
  { key: 'funny', label: 'Funny' },
  { key: 'patient', label: 'Patient' },
  { key: 'encouraging', label: 'Encouraging' },
  { key: 'therapist', label: 'Therapist' },
];
const LANGUAGES = [
  { key: 'es', label: 'Spanish' },
  { key: 'de', label: 'German' },
  { key: 'hi', label: 'Hindi (Hinglish)' },
  { key: 'hin', label: 'Hindi (Devanagari)' },
  { key: 'ja', label: 'Japanese (Romaji)' },
  { key: 'zhp', label: 'Mandarin (Pinyin)' },
  { key: 'en', label: 'English' },
];
const MODES = [
  { key: 'translate', label: 'Translate' },
  { key: 'converse', label: 'Converse' },
];

function usePersistedState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? JSON.parse(saved) : defaultValue;
    } catch { return defaultValue; }
  });
  const persist = useCallback((v) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);
  return [value, persist];
}

function useVoiceInput(voiceLang, onResult) {
  const [listening, setListening] = useState(false);
  const [audioURL, setAudioURL] = useState(null);
  const recognitionRef = useRef(null);
  const stoppedRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    stoppedRef.current = false;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = voiceLang || 'en-US';
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript + ' ';
      }
      if (transcript.trim()) {
        onResult((prev) => (prev ? prev + ' ' + transcript.trim() : transcript.trim()));
      }
    };

    recognition.onerror = () => {};
    recognition.onend = () => {
      if (!stoppedRef.current) {
        setTimeout(() => {
          if (!stoppedRef.current) {
            try { recognition.start(); } catch { setListening(false); }
          }
        }, 200);
      } else {
        setListening(false);
        recognitionRef.current = null;
      }
    };

    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        if (stoppedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        try {
          const recorder = new MediaRecorder(stream);
          chunksRef.current = [];
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
          recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
            if (blob.size > 0) { setAudioURL(URL.createObjectURL(blob)); }
            stream.getTracks().forEach((t) => t.stop());
          };
          recorder.start();
          mediaRecorderRef.current = recorder;
        } catch { stream.getTracks().forEach((t) => t.stop()); }
      }).catch(() => {});
    }
  }, [voiceLang, onResult]);

  const stopListening = useCallback(() => {
    stoppedRef.current = true;
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') { mediaRecorderRef.current.stop(); mediaRecorderRef.current = null; }
    setListening(false);
  }, []);

  const playAudio = useCallback(() => {
    if (!audioURL) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const a = new Audio(audioURL); a.onended = () => setPlaying(false); a.play(); audioRef.current = a; setPlaying(true);
  }, [audioURL]);

  const stopAudio = useCallback(() => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } setPlaying(false); }, []);

  const clearAudio = useCallback(() => { stopAudio(); if (audioURL) URL.revokeObjectURL(audioURL); setAudioURL(null); }, [audioURL, stopAudio]);

  return { listening, startListening, stopListening, audioURL, playing, playAudio, stopAudio, clearAudio };
}

function App() {
  const [mode, setMode] = usePersistedState('ll-mode', 'converse');
  const [difficulty, setDifficulty] = usePersistedState('ll-difficulty', 'easy');
  const [topic, setTopic] = usePersistedState('ll-topic', 'daily');
  const [lineCount, setLineCount] = usePersistedState('ll-lines', 1);
  const [sourceLang, setSourceLang] = usePersistedState('ll-srcLang', 'es');
  const [targetLang, setTargetLang] = usePersistedState('ll-tgtLang', 'en');
  const [selectedModel, setSelectedModel] = usePersistedState('ll-model', MODELS[0].id);
  const [ttsSettings, setTtsSettings] = useState(getTTSSettings);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userGender, setUserGender] = usePersistedState('ll-userGender', 'man');
  const [targetGender, setTargetGender] = usePersistedState('ll-targetGender', 'woman');
  const [personality, setPersonality] = usePersistedState('ll-personality', 'friendly');
  const [customTopic, setCustomTopic] = usePersistedState('ll-customTopic', '');
  const [passage, setPassage] = useState(null);
  const [passageText, setPassageText] = useState('');
  const [userInput, setUserInput] = useState('');
  const [result, setResult] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [autoAnswer, setAutoAnswer] = usePersistedState('ll-autoAnswer', false);
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [started, setStarted] = useState(false);

  // Conversation mode state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [translations, setTranslations] = useState({});
  const [loadingTranslation, setLoadingTranslation] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState(null);
  const [passageSpeaking, setPassageSpeaking] = useState(false);

  const chatEndRef = useRef(null);

  const resetSession = useCallback(() => {
    setStarted(false);
    setPassage(null);
    setPassageText('');
    setUserInput('');
    setResult(null);
    setAnswer(null);
    setShowAnswer(false);
    setChatMessages([]);
    setChatInput('');
    setTranslations({});
    setSpeakingIdx(null);
    setPassageSpeaking(false);
  }, []);

  const currentModel = MODELS.find((m) => m.id === selectedModel);
  const voiceSupported = currentModel?.voice && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => { setLLMModel(selectedModel); }, [selectedModel]);
  useEffect(() => { if (sourceLang === targetLang) { const other = LANGUAGES.find((l) => l.key !== sourceLang); if (other) setTargetLang(other.key); } }, [sourceLang]);

  useEffect(() => {
    const update = () => {
      try {
        const h = JSON.parse(localStorage.getItem('ll-convos') || '{}');
        const total = Object.values(h).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
        setHistoryCount(total);
      } catch { setHistoryCount(0); }
    };
    update();
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);

  useEffect(() => { setHistoryCount((c) => c); }, [passage]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const handleUserInput = useCallback((valOrUpdater) => {
    if (typeof valOrUpdater === 'function') {
      setUserInput((prev) => { const next = valOrUpdater(prev); setResult(null); return next; });
    } else {
      setUserInput(valOrUpdater); setResult(null);
    }
  }, []);

  const voiceLang = getVoiceLang(mode === 'converse' ? targetLang : targetLang);
  const effectiveTopic = customTopic.trim() || topic;
  const { listening, startListening, stopListening, audioURL, playing, playAudio, stopAudio, clearAudio } = useVoiceInput(voiceLang, handleUserInput);

  const handleGenerate = useCallback(async () => {
    setLoading('generate');
    setError(null);
    setUserInput(''); setResult(null); setAnswer(null); setShowAnswer(false);
    setPassage(['Generating...']);
    setPassageText('');
    if (!started) setStarted(true);
    try {
      const stream = generatePassageStream(difficulty, effectiveTopic, lineCount, sourceLang, targetLang);
      let rawText = '';
      let firstChunk = true;

      for await (const chunk of stream) {
        rawText += chunk;
        const lines = rawText.split('\n').map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean).slice(0, lineCount);
        setPassage(lines);
        setPassageText(lines.join('\n'));
        firstChunk = false;
      }

      const lines = rawText.split('\n').map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean).slice(0, lineCount);
      if (lines.length === 0) lines.push('No passage generated. Try again.');
      const finalText = lines.join('\n');
      setPassage(lines);
      setPassageText(finalText);
      addConversationEntry(effectiveTopic, finalText);

      if (autoAnswer) {
        setLoading('answer');
        const ans = await getCorrectTranslation(finalText, sourceLang, targetLang);
        setPassage(lines);
        setAnswer(ans);
        setShowAnswer(true);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }, [difficulty, effectiveTopic, lineCount, sourceLang, targetLang, autoAnswer, started]);

  const handleEvaluate = useCallback(async () => {
    if (!passage) return;
    setLoading('evaluate');
    setError(null);
    try {
      const [evalRes, ansRes] = await Promise.all([
        evaluateTranslation(passageText, userInput, sourceLang, targetLang),
        answer ? Promise.resolve(answer) : getCorrectTranslation(passageText, sourceLang, targetLang),
      ]);
      setResult(evalRes);
      if (!answer) setAnswer(ansRes);
    } catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }, [passage, passageText, userInput, sourceLang, targetLang, answer]);

  const handleShowAnswer = useCallback(async () => {
    if (answer) { setShowAnswer(!showAnswer); return; }
    setLoading('answer'); setError(null);
    try { const res = await getCorrectTranslation(passageText, sourceLang, targetLang); setAnswer(res); setShowAnswer(true); }
    catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }, [passageText, sourceLang, targetLang, answer, showAnswer]);

  const handleVoiceToggle = useCallback(() => { if (listening) stopListening(); else startListening(); }, [listening, startListening, stopListening]);
  const handleClearHistory = useCallback(() => { clearHistory(); setHistoryCount(0); }, []);

  const renderCorrectedLine = (line) => {
    if (!line.changes || line.changes.length === 0) {
      return <span className="line-correct">{line.original}</span>;
    }
    let parts = [];
    let remaining = line.original;
    for (const change of line.changes) {
      const idx = remaining.toLowerCase().indexOf(change.wrong.toLowerCase());
      if (idx === -1) continue;
      if (idx > 0) parts.push(<span key={parts.length} className="line-correct">{remaining.slice(0, idx)}</span>);
      parts.push(<span key={parts.length} className="line-wrong"><span className="wrong-text">{remaining.slice(idx, idx + change.wrong.length)}</span><span className="right-text"> {change.right}</span></span>);
      remaining = remaining.slice(idx + change.wrong.length);
    }
    if (remaining) parts.push(<span key={parts.length} className="line-correct">{remaining}</span>);
    return parts;
  };

  // Conversation handlers
  const parseConvoResponse = (text) => {
    const correctedMatch = text.match(/\[corrected\]\s*([\s\S]*?)\s*\[\/corrected\]/);
    const replyMatch = text.match(/\[reply\]\s*([\s\S]*?)\s*\[\/reply\]/);
    let reply = replyMatch ? replyMatch[1].trim() : '';
    if (!reply) {
      reply = text.replace(/\[corrected\][\s\S]*?\[\/corrected\]/g, '').trim();
    }
    reply = reply.replace(/\[\/?corrected\]/g, '').replace(/\[\/?reply\]/g, '').trim();
    return {
      corrected: correctedMatch ? correctedMatch[1].trim() : '',
      reply,
    };
  };

  const handleStartConvo = useCallback(async () => {
    setLoading('convo'); setError(null); setChatMessages([]); setTranslations({});
    try {
      const text = await startConversation(difficulty, effectiveTopic, targetLang, userGender, targetGender, personality);
      const parsed = parseConvoResponse(text);
      setChatMessages([{ role: 'assistant', content: parsed.reply || text }]);
      if (!started) setStarted(true);
    } catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }, [difficulty, effectiveTopic, targetLang, userGender, targetGender, personality, started]);

  const handleSendChat = useCallback(async () => {
    const input = chatInput.trim();
    if (!input) return;
    setChatInput('');
    setLoading('convo'); setError(null);

    const userMsg = { role: 'user', content: input };
    setChatMessages((prev) => {
      return [...prev, userMsg, { role: 'assistant', content: '' }];
    });

    try {
      const stream = continueConversationStream([...chatMessages, userMsg], targetLang, difficulty, effectiveTopic, userGender, targetGender, personality);
      let rawText = '';
      const assistantIdx = chatMessages.length + 1;

      for await (const chunk of stream) {
        rawText += chunk;
        const parsed = parseConvoResponse(rawText);
        setChatMessages((prev) => {
          const updated = [...prev];
          if (updated.length > assistantIdx) {
            updated[assistantIdx] = { role: 'assistant', content: parsed.reply || rawText };
          }
          return updated;
        });
      }

      const parsed = parseConvoResponse(rawText);
      setChatMessages((prev) => {
        const updated = [...prev];
        if (updated.length > assistantIdx - 1 && parsed.corrected) {
          updated[assistantIdx - 1] = { ...updated[assistantIdx - 1], corrected: parsed.corrected };
        }
        if (updated.length > assistantIdx) {
          updated[assistantIdx] = { role: 'assistant', content: parsed.reply || rawText };
        }
        return updated;
      });
    } catch (e) { setError(e.message); }
    finally { setLoading(null); }
  }, [chatInput, chatMessages, targetLang, difficulty, effectiveTopic, userGender, targetGender, personality]);

  const handleTranslate = useCallback(async (text, msgIndex) => {
    if (translations[msgIndex]) { setTranslations((t) => { const n = {...t}; delete n[msgIndex]; return n; }); return; }
    setLoadingTranslation(msgIndex);
    try {
      const en = await translateToSource(text, targetLang, sourceLang);
      setTranslations((t) => ({ ...t, [msgIndex]: en }));
    } catch (e) { setError(e.message); }
    finally { setLoadingTranslation(null); }
  }, [sourceLang, targetLang, translations]);

  const handleConvoVoice = useCallback((val) => { setChatInput(val); }, []);

  const handleSuggest = useCallback(async () => {
    if (chatMessages.length === 0 || suggesting) return;
    setSuggesting(true);
    try {
      const suggestion = await suggestResponse(chatMessages, targetLang, difficulty);
      setChatInput(suggestion);
    } catch (e) { setError(e.message); }
    finally { setSuggesting(false); }
  }, [chatMessages, targetLang, difficulty, suggesting]);

  const handleSpeak = useCallback(async (text, idx) => {
    if (speakingIdx === idx) { window.speechSynthesis.cancel(); setSpeakingIdx(null); return; }
    window.speechSynthesis.cancel();
    setSpeakingIdx(idx);
    await speakWithLang(text, targetLang, ttsSettings);
    setSpeakingIdx(null);
  }, [speakingIdx, targetLang]);

  const handleSpeakPassage = useCallback(async () => {
    if (!passage) return;
    if (passageSpeaking) { window.speechSynthesis.cancel(); setPassageSpeaking(false); return; }
    window.speechSynthesis.cancel();
    setPassageSpeaking(true);
    await speakWithLang(passage.join('. '), sourceLang, ttsSettings);
    setPassageSpeaking(false);
  }, [passageSpeaking, passage, sourceLang]);

  const srcLabel = LANGUAGES.find((l) => l.key === sourceLang).label;
  const tgtLabel = LANGUAGES.find((l) => l.key === targetLang).label;

  return (
    <div className={`app${mode === 'converse' && started ? ' convo-layout' : ''}`}>
      <div className="app-header">
        <button className="settings-toggle" onClick={() => setSidebarOpen(true)} title="Settings">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div>
          <h1>Learn Language</h1>
          <p className="subtitle">AI-powered conversational translation practice</p>
        </div>
      </div>

      <div className="app-body">
        <div className="main-area">
          {error && <div className="error">{error}</div>}

          {!started && mode === 'translate' && (
            <div className="start-area">
              <p className="start-text">Practice translating from {srcLabel} into {tgtLabel}</p>
              <button className="start-btn" onClick={handleGenerate} disabled={loading === 'generate'}>
                {loading === 'generate' ? 'Starting...' : 'Start Practice'}
              </button>
            </div>
          )}

          {!started && mode === 'converse' && (
            <div className="start-area">
              <p className="start-text">Have a real conversation in {tgtLabel}</p>
              <button className="start-btn" onClick={handleStartConvo} disabled={loading === 'convo'}>
                {loading === 'convo' ? 'Starting...' : 'Start Conversation'}
              </button>
            </div>
          )}

          {started && mode === 'translate' && (
            <div className="practice-area">
              <div className="passage-box">
                <div className="passage-header">
                  <h2>{srcLabel} Passage</h2>
                  {passage && (
                    <button className={`icon-btn speak-btn ${passageSpeaking ? 'speaking' : ''}`} onClick={handleSpeakPassage} title={passageSpeaking ? 'Stop' : 'Listen'}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                    </button>
                  )}
                </div>
                {passage ? passage.map((line, i) => (
                  <p key={i} className="passage-line">{line}</p>
                )) : (
                  <div className="passage-loading">
                    {loading === 'generate' ? 'Generating passage...' : 'Click "Next" for a new passage'}
                  </div>
                )}
              </div>
              <div className="next-row">
                {mode === 'translate' && (
                  <button className={`auto-answer-btn ${autoAnswer ? 'active' : ''}`} onClick={() => setAutoAnswer(!autoAnswer)} title="Auto-show answer with each passage">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    Auto
                  </button>
                )}
                <button className="next-btn" onClick={handleGenerate} disabled={loading === 'generate'}>
                  {loading === 'generate' ? 'Generating...' : '\u2192 Next'}
                </button>
              </div>
              {passage && (
                <>
                  <div className="tab-card">
                    <div className="tab-body">
                      <div className="tab-content">
                        {!autoAnswer && (
                          <>
                            <div className={`textarea-wrapper ${listening ? 'recording' : ''}`}>
                              <textarea value={userInput} onChange={(e) => handleUserInput(e.target.value)} placeholder={listening ? 'Listening... speak now' : `Type or speak your ${tgtLabel} translation here...`} rows={5} />
                              {listening && <div className="recording-bar"><span className="recording-dot" /> Recording...</div>}
                            </div>
                            <div className="action-btns">
                              <button className="eval-btn" onClick={handleEvaluate} disabled={!userInput.trim() || loading === 'evaluate'}>
                                {loading === 'evaluate' ? 'Evaluating...' : 'Evaluate'}
                              </button>
                              <button className="answer-btn" onClick={handleShowAnswer} disabled={loading === 'answer' || loading === 'evaluate'}>
                                {showAnswer ? 'Hide Answer' : answer ? 'Show Answer' : loading === 'answer' ? 'Loading...' : 'Show Answer'}
                              </button>
                              {voiceSupported && (
                                <>
                                  <button className={`voice-btn ${listening ? 'voice-active' : ''}`} onClick={handleVoiceToggle}>
                                    {listening ? '\u25cf Stop Recording' : '\uD83C\uDF99 Start Recording'}
                                  </button>
                                  {audioURL && !listening && (
                                    <div className="playback-controls">
                                      <button className="playback-btn" onClick={playing ? stopAudio : playAudio}>{playing ? '\u25a0 Stop' : '\u25b6 Hear Yourself'}</button>
                                      <button className="playback-clear-btn" onClick={clearAudio} title="Discard recording">✕</button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            {result && (
                              <div className="result-box">
                                <div className="score-row">
                                  <div className="score-circle" data-level={result.score >= 75 ? 'high' : result.score >= 40 ? 'mid' : 'low'}>
                                    <span className="score-num">{result.score}</span>
                                    <span className="score-pct">/100</span>
                                  </div>
                                  <p className="feedback">{result.feedback}</p>
                                </div>
                                {result.correctedLines && result.correctedLines.length > 0 && passage && (
                                  <div className="corrections">
                                    {result.correctedLines.map((line, i) => (
                                      <div key={i} className="correction-group">
                                        <div className="correction-en">{passage[i]}</div>
                                        <div className="correction-yours">{renderCorrectedLine(line)}</div>
                                        {line.original !== line.corrected && <div className="correction-answer">{line.corrected}</div>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                        {showAnswer && answer && passage && (
                          <div className="result-box">
                            {passage.map((enLine, i) => (
                              <div key={i} className="answer-pair">
                                <div className="answer-en">{enLine}</div>
                                <div className="answer-translation">{answer.split('\n').filter(Boolean)[i] || ''}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {started && mode === 'converse' && (
            <div className="convo-area">
              <div className="convo-messages">
                {chatMessages.length === 0 && (
                  <div className="convo-empty">Start the conversation below</div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`convo-msg ${msg.role}`}>
                    <div className="convo-bubble">{renderSimpleMarkdown(msg.content)}</div>
                    {msg.role === 'user' && msg.corrected && (
                      <div className="convo-corrected">{msg.corrected}</div>
                    )}
                    {msg.role === 'assistant' && (
                      <div className="convo-actions">
                        <button className={`icon-btn speak-btn ${speakingIdx === i ? 'speaking' : ''}`} onClick={() => handleSpeak(msg.content, i)} title={speakingIdx === i ? 'Stop' : 'Listen'}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                        </button>
                        <button className="translate-btn" onClick={() => handleTranslate(msg.content, i)} disabled={loadingTranslation === i}>
                          {translations[i] ? `Hide ${srcLabel}` : loadingTranslation === i ? '...' : `Show ${srcLabel}`}
                        </button>
                      </div>
                    )}
                    {translations[i] && (
                      <div className="convo-translation">{translations[i]}</div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="convo-input-area">
                <div className="convo-input-inner">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && chatInput.trim() && loading !== 'convo') { e.preventDefault(); handleSendChat(); } }}
                    placeholder={`Type in ${tgtLabel}...`}
                    rows={2}
                  />
                  <div className="convo-input-actions">
                    <button className={`icon-btn suggest-icon-btn${suggesting ? ' suggesting' : ''}`} onClick={handleSuggest} disabled={suggesting || chatMessages.length === 0} title={suggesting ? 'Getting suggestion...' : 'Suggest a response'}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
                    </button>
                    <button className="icon-btn send-icon-btn" onClick={handleSendChat} disabled={!chatInput.trim() || loading === 'convo'} title="Send">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="settings">
            <div className="settings-header">
              <span>Settings</span>
              <button className="settings-close" onClick={() => setSidebarOpen(false)} title="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="setting-group">
              <label>Mode</label>
              <div className="btn-group">
                {MODES.map((m) => (
                  <button key={m.key} className={mode === m.key ? 'active' : ''} onClick={() => { setMode(m.key); resetSession(); }}>{m.label}</button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <label>Model</label>
              <select className="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}{m.voice ? ' (+voice)' : ''}</option>
                ))}
              </select>
            </div>
            <div className="setting-group">
              <label>Difficulty</label>
              <div className="btn-group">
                {DIFFICULTIES.map((d) => (
                  <button key={d} className={difficulty === d ? 'active' : ''} onClick={() => { setDifficulty(d); resetSession(); }}>{d}</button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <label>Topic</label>
              <div className="btn-group">
                {TOPICS.map((t) => (
                  <button key={t} className={topic === t && !customTopic.trim() ? 'active' : ''} onClick={() => { setTopic(t); setCustomTopic(''); resetSession(); }}>{t}</button>
                ))}
              </div>
              {import.meta.env.DEV && (
                <input className="model-input topic-input" type="text" placeholder="Or type a custom topic..." value={customTopic} onChange={(e) => { setCustomTopic(e.target.value); resetSession(); }} />
              )}
            </div>
            <div className="setting-group">
              <label>You are</label>
              <div className="btn-group">
                {GENDERS.map((g) => (
                  <button key={g.key} className={userGender === g.key ? 'active' : ''} onClick={() => { setUserGender(g.key); resetSession(); }}>{g.label}</button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <label>Chat partner is</label>
              <div className="btn-group">
                {GENDERS.map((g) => (
                  <button key={g.key} className={targetGender === g.key ? 'active' : ''} onClick={() => { setTargetGender(g.key); resetSession(); }}>{g.label}</button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <label>Partner personality</label>
              <div className="btn-group">
                {PERSONALITIES.map((p) => (
                  <button key={p.key} className={personality === p.key ? 'active' : ''} onClick={() => { setPersonality(p.key); resetSession(); }}>{p.label}</button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <label>I speak (source)</label>
              <div className="btn-group">
                {LANGUAGES.map((l) => (
                  <button key={l.key} className={sourceLang === l.key ? 'active' : ''} onClick={() => { setSourceLang(l.key); resetSession(); }}>{l.label}</button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <label>I'm learning (target)</label>
              <div className="btn-group">
                {LANGUAGES.filter((l) => l.key !== sourceLang).map((l) => (
                  <button key={l.key} className={targetLang === l.key ? 'active' : ''} onClick={() => { setTargetLang(l.key); resetSession(); }}>{l.label}</button>
                ))}
              </div>
            </div>
            {mode === 'translate' && (
              <div className="setting-group">
                <label>Lines: {lineCount}</label>
                <input type="range" min={1} max={7} value={lineCount} onChange={(e) => setLineCount(Number(e.target.value))} />
              </div>
            )}
            <div className="setting-group">
              <label>Voice Speed: {ttsSettings.speed.toFixed(1)}x</label>
              <input type="range" min={0.3} max={2.0} step={0.1} value={ttsSettings.speed} onChange={(e) => { const s = { ...ttsSettings, speed: parseFloat(e.target.value) }; setTtsSettings(s); saveTTSSettings(s); }} />
            </div>
            {historyCount > 0 && (
              <button className="clear-btn" onClick={handleClearHistory}>Clear History ({historyCount})</button>
            )}
          </div>
        </div>
      </div>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}

export default App;