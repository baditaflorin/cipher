import type { DecryptedChatRecord } from "../chat/types";

export type SummaryResult = {
  summary: string;
  engine: "transformers.js" | "extractive-fallback";
};

export async function summarizeThread(
  messages: DecryptedChatRecord[]
): Promise<SummaryResult> {
  const text = messages
    .filter((message) => message.kind !== "system")
    .slice(-80)
    .map((message) => `${message.senderName}: ${message.body}`)
    .join("\n");

  if (text.trim().length < 120) {
    return {
      summary: text || "No messages to summarize yet.",
      engine: "extractive-fallback"
    };
  }

  try {
    const transformers = await import("@huggingface/transformers");
    const summarizer = await transformers.pipeline(
      "summarization",
      "Xenova/distilbart-cnn-6-6"
    );
    const result = await summarizer(text.slice(0, 6000), {
      max_new_tokens: 96,
      min_length: 20
    });
    const first = Array.isArray(result) ? result[0] : result;
    const summary =
      typeof first === "object" && first && "summary_text" in first
        ? String(first.summary_text)
        : JSON.stringify(first);

    return { summary, engine: "transformers.js" };
  } catch {
    return {
      summary: extractiveSummary(messages),
      engine: "extractive-fallback"
    };
  }
}

export async function transcribeAudio(file: File): Promise<SummaryResult> {
  try {
    const transformers = await import("@huggingface/transformers");
    const transcriber = await transformers.pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny.en"
    );
    const url = URL.createObjectURL(file);
    try {
      const result = await transcriber(url);
      const text =
        typeof result === "object" && result && "text" in result
          ? String(result.text)
          : JSON.stringify(result);
      return { summary: text, engine: "transformers.js" };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return {
      summary:
        "Whisper could not initialize in this browser. The audio never left this device.",
      engine: "extractive-fallback"
    };
  }
}

function extractiveSummary(messages: DecryptedChatRecord[]): string {
  const recent = messages.filter((message) => message.kind !== "system").slice(-12);
  const speakers = new Set(recent.map((message) => message.senderName));
  const highlights = recent
    .filter((message) => message.body.length > 24)
    .slice(-5)
    .map((message) => `${message.senderName}: ${message.body}`)
    .join("\n");

  return [
    `${recent.length} recent messages from ${speakers.size || 0} participant${
      speakers.size === 1 ? "" : "s"
    }.`,
    highlights || "No substantial messages yet."
  ].join("\n");
}
