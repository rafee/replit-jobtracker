import { GoogleGenAI } from "@google/genai";

export interface ResumeGenerationInput {
  fullName: string;
  sourceResume: string;
  linkedinNotes: string;
  promptPreferences: string;
  userPrompt: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
}

export async function generateTailoredResume(
  input: ResumeGenerationInput,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini is not configured. Add GEMINI_API_KEY in Secrets.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Create a tailored resume draft for the candidate and role below.",
              "Use only facts explicitly present in the source resume or profile notes. Never invent employers, dates, degrees, certifications, skills, metrics, or accomplishments.",
              "Keep the candidate's experience truthful. Reorder and emphasize relevant evidence, and make wording clearer without changing facts.",
              "Follow the user's focus prompt where consistent with the source material.",
              "Return only the resume draft text, with clear section headings. Do not include commentary.",
              `Candidate: ${input.fullName || "Not provided"}`,
              `User's standing preferences: ${input.promptPreferences || "None provided"}`,
              `User's instructions for this version: ${input.userPrompt}`,
              `Target role: ${input.jobTitle} at ${input.company}`,
              `Role description:\n${input.jobDescription}`,
              `Source resume:\n${input.sourceResume}`,
              `LinkedIn profile notes:\n${input.linkedinNotes || "None provided"}`,
            ].join("\n\n"),
          },
        ],
      },
    ],
    config: { maxOutputTokens: 8192 },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini returned an empty resume draft.");
  }
  return text;
}
