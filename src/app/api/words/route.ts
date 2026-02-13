import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

interface WordPair {
  safe: string;
  leap: string;
}

export async function POST(request: NextRequest) {
  try {
    const { words, position } = await request.json();
    const currentSentence = (words as string[]).join(" ");
    const wordCount = (words as string[]).length;
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

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.9,
      max_tokens: 60,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "No response from model" },
        { status: 500 }
      );
    }

    const pair: WordPair = JSON.parse(content);

    if (!pair.safe || !pair.leap) {
      return NextResponse.json(
        { error: "Invalid word pair format" },
        { status: 500 }
      );
    }

    return NextResponse.json(pair);
  } catch (error) {
    console.error("Word generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate words" },
      { status: 500 }
    );
  }
}
