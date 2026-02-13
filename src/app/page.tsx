"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface WordPair {
  safe: string;
  leap: string;
}

type Phase =
  | "waiting"       // initial dark screen
  | "choosing"      // two words visible, user picks
  | "dissolving"    // unchosen fades, chosen settles
  | "complete"      // sentence finished, resting
  ;

export default function Home() {
  const [words, setWords] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [currentPair, setCurrentPair] = useState<WordPair | null>(null);
  const [prefetchedPair, setPrefetchedPair] = useState<WordPair | null>(null);
  const [chosenSide, setChosenSide] = useState<"safe" | "leap" | null>(null);
  const [targetLength] = useState(() => 8 + Math.floor(Math.random() * 5)); // 8-12
  const [isLoading, setIsLoading] = useState(false);
  const [sentenceCount, setSentenceCount] = useState(0);
  const prefetchRef = useRef(false);

  const fetchPair = useCallback(
    async (currentWords: string[]): Promise<WordPair | null> => {
      try {
        const res = await fetch("/api/words", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            words: currentWords,
            position: currentWords.length === 0 ? "first" : "middle",
          }),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
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
    }
    setIsLoading(false);
  }, [fetchPair]);

  // Begin on mount
  useEffect(() => {
    beginSentence();
  }, [beginSentence]);

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
    </div>
  );
}
