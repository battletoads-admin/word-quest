"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Groq from "groq-sdk";

interface WordPair {
  safe: string;
  leap: string;
}

type Phase =
  | "key-entry"     // user needs to provide API key
  | "waiting"       // initial dark screen
  | "choosing"      // two words visible, user picks
  | "dissolving"    // unchosen fades, chosen settles
  | "complete"      // sentence finished, resting
  ;

function getGroqClient(apiKey: string) {
  return new Groq({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

async function generatePair(
  groq: Groq,
  words: string[],
  position: string
): Promise<WordPair | null> {
  const currentSentence = words.join(" ");
  const wordCount = words.length;
  const targetLength = position === "first" ? 10 : Math.max(0, 10 - wordCount);

  let prompt: string;

  if (position === "first") {
    prompt = `You are helping create a poetic sentence, one word at a time. The user will choose between two opening words.

Generate two possible FIRST words for a poetic sentence (8-12 words long).

Rules:
- One word should feel "safe" — familiar, grounding, gentle (like: "the", "sometimes", "morning", "we", "there")
- One word should feel like a "leap" — unexpected, evocative, slightly strange (like: "beneath", "unraveling", "almost", "forgetting", "elsewhere")
- Both must work as valid opening words of a sentence
- Lowercase only
- Single words only, no punctuation

Respond with ONLY valid JSON: {"safe": "word", "leap": "word"}`;
  } else if (targetLength <= 2) {
    prompt = `You are helping create a poetic sentence, one word at a time.

The sentence so far: "${currentSentence}"

This is near the END of the sentence (${wordCount} words so far, aiming for 8-12 total). Generate two possible NEXT words that could gracefully END or NEARLY END this sentence.

Rules:
- One word should feel "safe" — a natural, expected ending
- One word should feel like a "leap" — a surprising, haunting, or unusual ending
- Both must be grammatically valid continuations
- Think about creating a complete, resonant poetic thought
- Lowercase only, single words only
- If the word would end the sentence, add a period after it

Respond with ONLY valid JSON: {"safe": "word", "leap": "word"}`;
  } else {
    prompt = `You are helping create a poetic sentence, one word at a time.

The sentence so far: "${currentSentence}"

Generate two possible NEXT words to continue this sentence. The sentence will be ${wordCount + targetLength} words total, and we're at word ${wordCount + 1}.

Rules:
- One word should feel "safe" — the expected, natural continuation
- One word should feel like a "leap" — unexpected, poetic, slightly destabilizing
- Both MUST be grammatically valid continuations of the existing sentence
- Think about rhythm and sound, not just meaning
- Lowercase only, single words only, no punctuation

Respond with ONLY valid JSON: {"safe": "word", "leap": "word"}`;
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9,
      max_tokens: 60,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const pair: WordPair = JSON.parse(content);
    if (!pair.safe || !pair.leap) return null;
    return pair;
  } catch {
    return null;
  }
}

export default function Home() {
  const [words, setWords] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("key-entry");
  const [currentPair, setCurrentPair] = useState<WordPair | null>(null);
  const [prefetchedPair, setPrefetchedPair] = useState<WordPair | null>(null);
  const [chosenSide, setChosenSide] = useState<"safe" | "leap" | null>(null);
  const [targetLength] = useState(() => 8 + Math.floor(Math.random() * 5)); // 8-12
  const [isLoading, setIsLoading] = useState(false);
  const [sentenceCount, setSentenceCount] = useState(0);
  const [apiKey, setApiKey] = useState<string>("");
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState(false);
  const prefetchRef = useRef(false);
  const groqRef = useRef<Groq | null>(null);

  // Load API key from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("groq-api-key");
    if (stored) {
      setApiKey(stored);
      groqRef.current = getGroqClient(stored);
      setPhase("waiting");
    }
  }, []);

  const fetchPair = useCallback(
    async (currentWords: string[]): Promise<WordPair | null> => {
      if (!groqRef.current) return null;
      return generatePair(
        groqRef.current,
        currentWords,
        currentWords.length === 0 ? "first" : "middle"
      );
    },
    []
  );

  // Prefetch the next pair while user hesitates
  const prefetchNext = useCallback(
    async (currentWords: string[], chosenWord: string) => {
      if (prefetchRef.current) return;
      prefetchRef.current = true;
      const nextWords = [...currentWords, chosenWord];
      const pair = await fetchPair(nextWords);
      setPrefetchedPair(pair);
      prefetchRef.current = false;
    },
    [fetchPair]
  );

  // Start a new sentence
  const beginSentence = useCallback(async () => {
    setWords([]);
    setPhase("waiting");
    setChosenSide(null);
    setPrefetchedPair(null);
    setIsLoading(true);

    const pair = await fetchPair([]);
    if (pair) {
      setCurrentPair(pair);
      setPhase("choosing");
    } else {
      // API call failed — likely bad key
      setKeyError(true);
      setPhase("key-entry");
    }
    setIsLoading(false);
  }, [fetchPair]);

  // Begin on mount (once we have a key)
  useEffect(() => {
    if (apiKey && phase === "waiting") {
      beginSentence();
    }
  }, [apiKey, phase, beginSentence]);

  // Handle API key submission
  const submitKey = useCallback(async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setKeyError(false);
    localStorage.setItem("groq-api-key", trimmed);
    setApiKey(trimmed);
    groqRef.current = getGroqClient(trimmed);
    setPhase("waiting");
  }, [keyInput]);

  // Handle word choice
  const chooseWord = useCallback(
    async (side: "safe" | "leap") => {
      if (phase !== "choosing" || !currentPair) return;

      const chosen = currentPair[side];
      setChosenSide(side);
      setPhase("dissolving");

      // Start prefetching for the next step immediately
      const nextWords = [...words, chosen];
      if (nextWords.length < targetLength) {
        prefetchNext(words, chosen);
      }

      // Let the dissolve animation play
      await new Promise((r) => setTimeout(r, 800));

      const newWords = [...words, chosen];
      setWords(newWords);

      // Check if sentence is done
      const endsWithPeriod = chosen.endsWith(".");
      if (newWords.length >= targetLength || endsWithPeriod) {
        // Sentence complete
        if (!endsWithPeriod) {
          // Add period to last word
          newWords[newWords.length - 1] = chosen + ".";
          setWords([...newWords]);
        }
        setPhase("complete");
        setSentenceCount((c) => c + 1);
        return;
      }

      // Load next pair
      setChosenSide(null);
      if (prefetchedPair) {
        setCurrentPair(prefetchedPair);
        setPrefetchedPair(null);
        setPhase("choosing");
      } else {
        setIsLoading(true);
        const pair = await fetchPair(newWords);
        if (pair) {
          setCurrentPair(pair);
          setPhase("choosing");
        }
        setIsLoading(false);
      }
    },
    [phase, currentPair, words, targetLength, prefetchNext, prefetchedPair, fetchPair]
  );

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase === "choosing") {
        if (e.key === "ArrowLeft" || e.key === "1") chooseWord("safe");
        if (e.key === "ArrowRight" || e.key === "2") chooseWord("leap");
      }
      if (phase === "complete" && (e.key === " " || e.key === "Enter")) {
        beginSentence();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, chooseWord, beginSentence]);

  // Clear key handler
  const clearKey = useCallback(() => {
    localStorage.removeItem("groq-api-key");
    setApiKey("");
    setKeyInput("");
    groqRef.current = null;
    setPhase("key-entry");
  }, []);

  // --- API key entry screen ---
  if (phase === "key-entry") {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0a0a0a]">
        <div
          className="pointer-events-none fixed inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)",
          }}
        />
        <div className="animate-fade-in relative z-10 flex flex-col items-center gap-8 px-8">
          <p
            className="font-serif text-2xl tracking-wide text-[#e8e0d4]/60 sm:text-3xl"
            style={{ fontWeight: 300 }}
          >
            before we begin
          </p>
          <p
            className="max-w-md text-center font-serif text-sm leading-relaxed tracking-wide text-[#6b6560]/60"
            style={{ fontWeight: 300 }}
          >
            this needs a Groq API key to dream up words.
            <br />
            free at{" "}
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#6b6560]/80 underline decoration-[#6b6560]/20 underline-offset-4 transition-colors hover:text-[#e8e0d4]/60"
            >
              console.groq.com
            </a>
            . stored only in your browser.
          </p>
          {keyError && (
            <p
              className="font-serif text-xs tracking-wide text-red-400/60"
              style={{ fontWeight: 300 }}
            >
              that key didn&apos;t work — try another?
            </p>
          )}
          <div className="flex w-full max-w-sm flex-col items-center gap-4">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitKey()}
              placeholder="gsk_..."
              className="w-full border-b border-[#6b6560]/20 bg-transparent px-2 py-3 text-center font-serif text-lg tracking-widest text-[#e8e0d4]/80 outline-none transition-colors placeholder:text-[#6b6560]/20 focus:border-[#6b6560]/50"
              style={{ fontWeight: 300 }}
              autoFocus
            />
            <button
              onClick={submitKey}
              disabled={!keyInput.trim()}
              className="font-serif text-sm tracking-[0.25em] text-[#6b6560]/40 transition-all duration-700 hover:tracking-[0.35em] hover:text-[#6b6560]/70 disabled:cursor-default disabled:opacity-30 disabled:hover:tracking-[0.25em]"
              style={{ fontWeight: 300, background: "none", border: "none" }}
            >
              enter
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0a0a0a]">
      {/* Subtle vignette overlay */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      <main className="relative z-10 flex w-full max-w-3xl flex-col items-center justify-center px-8">
        {/* The growing sentence */}
        <div className="mb-20 min-h-[120px] w-full text-center">
          {words.length > 0 && (
            <p
              className={`font-serif text-3xl leading-relaxed tracking-wide text-[#e8e0d4] sm:text-4xl md:text-5xl ${
                phase === "complete"
                  ? "animate-sentence-land"
                  : ""
              }`}
              style={{ fontWeight: 300 }}
            >
              {words.map((word, i) => (
                <span
                  key={`${sentenceCount}-${i}`}
                  className="animate-settle inline-block"
                  style={{
                    animationDelay: `${i * 0.05}s`,
                  }}
                >
                  {i === 0
                    ? word.charAt(0).toUpperCase() + word.slice(1)
                    : word}
                  {i < words.length - 1 ? "\u00A0" : ""}
                </span>
              ))}
            </p>
          )}
        </div>

        {/* The choice — two words from darkness */}
        {(phase === "choosing" || phase === "dissolving") && currentPair && (
          <div className="flex items-center gap-16 sm:gap-24">
            {/* Safe word (left) */}
            <button
              onClick={() => chooseWord("safe")}
              disabled={phase === "dissolving"}
              className={`group relative font-serif text-3xl transition-all duration-500 sm:text-4xl md:text-5xl ${
                phase === "dissolving" && chosenSide === "safe"
                  ? "animate-settle text-[#e8e0d4]"
                  : phase === "dissolving" && chosenSide === "leap"
                    ? "animate-dissolve text-[#e8e0d4]"
                    : "animate-fade-in-up cursor-pointer text-[#e8e0d4]/80 hover:text-[#e8e0d4]"
              }`}
              style={{ fontWeight: 300, background: "none", border: "none" }}
            >
              {currentPair.safe}
              {phase === "choosing" && (
                <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-sans text-[10px] tracking-[0.3em] text-[#6b6560]/0 transition-all duration-500 group-hover:text-[#6b6560]/60">
                  safe
                </span>
              )}
            </button>

            {/* Divider — a ghostly or */}
            {phase === "choosing" && (
              <span
                className="animate-gentle-pulse select-none font-serif text-lg italic text-[#6b6560]/30"
                style={{ fontWeight: 300 }}
              >
                or
              </span>
            )}

            {/* Leap word (right) */}
            <button
              onClick={() => chooseWord("leap")}
              disabled={phase === "dissolving"}
              className={`group relative font-serif text-3xl italic transition-all duration-500 sm:text-4xl md:text-5xl ${
                phase === "dissolving" && chosenSide === "leap"
                  ? "animate-settle text-[#e8e0d4]"
                  : phase === "dissolving" && chosenSide === "safe"
                    ? "animate-dissolve text-[#e8e0d4]"
                    : "animate-fade-in-up cursor-pointer text-[#e8e0d4]/80 hover:text-[#e8e0d4]"
              }`}
              style={{
                fontWeight: 300,
                background: "none",
                border: "none",
                animationDelay: "0.15s",
              }}
            >
              {currentPair.leap}
              {phase === "choosing" && (
                <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-sans text-[10px] tracking-[0.3em] text-[#6b6560]/0 transition-all duration-500 group-hover:text-[#6b6560]/60">
                  leap
                </span>
              )}
            </button>
          </div>
        )}

        {/* Loading state — a quiet ellipsis */}
        {isLoading && (
          <div className="flex items-center gap-2">
            <span className="animate-gentle-pulse font-serif text-2xl text-[#6b6560]/40">
              ...
            </span>
          </div>
        )}

        {/* Completion state */}
        {phase === "complete" && (
          <div className="animate-fade-in mt-8 flex flex-col items-center gap-6" style={{ animationDelay: "1.5s", opacity: 0 }}>
            <div className="h-px w-12 bg-[#6b6560]/20" />
            <button
              onClick={beginSentence}
              className="group font-serif text-sm tracking-[0.25em] text-[#6b6560]/40 transition-all duration-700 hover:tracking-[0.35em] hover:text-[#6b6560]/70"
              style={{ fontWeight: 300, background: "none", border: "none" }}
            >
              begin again
            </button>
          </div>
        )}
      </main>

      {/* Quiet instruction at the bottom */}
      {phase === "choosing" && words.length === 0 && (
        <div
          className="animate-fade-in absolute bottom-12 font-serif text-xs tracking-[0.3em] text-[#6b6560]/25"
          style={{ fontWeight: 300, animationDelay: "2s", opacity: 0 }}
        >
          choose a word
        </div>
      )}

      {/* Subtle key management — bottom right */}
      {apiKey && (
        <button
          onClick={clearKey}
          className="absolute bottom-4 right-4 font-sans text-[9px] tracking-[0.2em] text-[#6b6560]/15 transition-colors duration-700 hover:text-[#6b6560]/40"
          style={{ background: "none", border: "none" }}
        >
          forget key
        </button>
      )}
    </div>
  );
}
