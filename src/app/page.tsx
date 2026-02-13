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

const SYSTEM_PROMPT = `You are a poet's subconscious. You help build single sentences — one word at a time — that feel like quiet revelations. Each sentence should read like a line from a poem someone almost remembered.

The kinds of sentences you help create:
- "the morning forgot itself and became something like forgiveness."
- "we carried the silence between us like an undelivered letter."
- "somewhere a door is closing that was never really open."
- "even the rain seemed to hesitate before touching the ground."
- "she kept the word folded inside her coat like a secret."
- "nothing was missing except the feeling that nothing was missing."
- "the trees remembered a wind that hadn't arrived yet."

You produce TWO word choices. The "safe" word is the natural, expected next word — what a reader would predict. The "leap" word is stranger, more poetic, more alive — it pulls the sentence somewhere unexpected but still grammatically sound.

CRITICAL RULES:
- Both words MUST be grammatically correct continuations. Read the sentence aloud with each word appended — it must sound like natural English.
- NEVER offer a word that already appears in the sentence. No repeats.
- Always respond with ONLY valid JSON: {"safe": "word", "leap": "word"}
- All lowercase, single words only.`;

async function generatePair(
  groq: Groq,
  words: string[],
  targetLen: number
): Promise<WordPair | null> {
  const currentSentence = words.join(" ");
  const wordCount = words.length;
  const remaining = targetLen - wordCount;

  const usedWords = new Set(words.map((w) => w.replace(/\.$/, "").toLowerCase()));
  let userPrompt: string;

  if (wordCount === 0) {
    userPrompt = `Generate two opening words for a new sentence (it will be ${targetLen} words long).

The "safe" word should ground the reader — a warm, familiar opening (like: the, sometimes, we, morning, even, she, there, after, once).
The "leap" word should unsettle slightly — something that immediately creates tension or mystery (like: beneath, almost, forgetting, nowhere, unraveling, somebody, whatever).

No punctuation. JSON only: {"safe": "word", "leap": "word"}`;
  } else if (remaining <= 1) {
    userPrompt = `Sentence so far: "${currentSentence}"
Words already used (DO NOT repeat any): [${[...usedWords].join(", ")}]

This is the LAST word (word ${wordCount + 1} of ${targetLen}). End the sentence with resonance — it should land with weight, like the final note of a song.

Both words MUST complete the sentence grammatically. Add a period after each word.
The "safe" word closes the thought naturally.
The "leap" word reframes everything — a surprising final word that makes the reader re-read the whole sentence.

JSON only: {"safe": "word.", "leap": "word."}`;
  } else if (remaining <= 3) {
    userPrompt = `Sentence so far: "${currentSentence}"
Words already used (DO NOT repeat any): [${[...usedWords].join(", ")}]

We're near the end — word ${wordCount + 1} of ${targetLen}. The sentence needs to start landing. Begin steering toward a conclusion that feels inevitable but surprising.

Both words must be grammatically valid continuations.
The "safe" word moves toward a natural closing.
The "leap" word introduces a late turn — something that shifts the sentence's meaning just before it ends.

No punctuation. JSON only: {"safe": "word", "leap": "word"}`;
  } else {
    userPrompt = `Sentence so far: "${currentSentence}"
Words already used (DO NOT repeat any): [${[...usedWords].join(", ")}]

This is word ${wordCount + 1} of ${targetLen}. The sentence is still unfolding — keep building momentum and meaning.

Both words must be grammatically valid continuations that a fluent English speaker would accept.
The "safe" word continues the sentence's natural trajectory — what the reader expects next.
The "leap" word bends the sentence in an unexpected direction while remaining grammatical — a more vivid, strange, or emotionally charged choice.

No punctuation. JSON only: {"safe": "word", "leap": "word"}`;
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 60,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const pair: WordPair = JSON.parse(content);
    if (!pair.safe || !pair.leap) return null;

    // Hard filter: strip periods for comparison, reject duplicates
    const safeClean = pair.safe.replace(/\.$/, "").toLowerCase();
    const leapClean = pair.leap.replace(/\.$/, "").toLowerCase();
    if (usedWords.has(safeClean) && usedWords.has(leapClean)) return null;
    if (usedWords.has(safeClean)) pair.safe = pair.leap;
    if (usedWords.has(leapClean)) pair.leap = pair.safe;

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
      return generatePair(groqRef.current, currentWords, targetLength);
    },
    [targetLength]
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
