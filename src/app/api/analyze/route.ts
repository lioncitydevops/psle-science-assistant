import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { queryVectorStore } from "@/lib/vector-store";
import { queryHybridStore } from "@/lib/hybrid-graph-vector-store";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return new OpenAI({ apiKey });
}

interface RetrievalContext {
  context: string;
  sources: string[];
}

async function generateAnswer(
  openai: OpenAI,
  extractedQuestion: string,
  relevantContext: RetrievalContext,
  retrievalMethod: string
) {
  const analysisResponse = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expert PSLE Science tutor. Your role is to help students understand and answer PSLE Science exam questions correctly.

You must provide responses in a specific JSON format that includes:
1. The suggested answer (complete, exam-ready answer)
2. Required keywords (words/phrases that MUST appear in the answer to score marks)
3. Marking scheme (how marks are allocated, what points earn marks)
4. Related concepts (the underlying science concepts being tested)

Use the following context from PSLE Science study materials to inform your answer:

---
${relevantContext.context}
---

Always base your answers on Singapore PSLE Science curriculum standards. Use proper scientific terminology appropriate for Primary 6 level.`,
      },
      {
        role: "user",
        content: `Please analyze this PSLE Science question and provide a comprehensive response:

Question: ${extractedQuestion}

Respond in the following JSON format ONLY (no markdown, no code blocks, just pure JSON):
{
  "question": "the extracted question",
  "suggestedAnswer": "the complete model answer that would score full marks",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "markingScheme": [
    "1 mark: for stating...",
    "1 mark: for explaining..."
  ],
  "relatedConcepts": [
    {
      "concept": "Concept Name",
      "explanation": "Brief explanation of the concept and how it relates to this question"
    }
  ],
  "sourceReferences": ["Reference from study materials used"]
}`,
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  });

  const analysisContent = analysisResponse.choices[0]?.message?.content || "";

  let parsedResult;
  try {
    let cleanedContent = analysisContent.trim();
    if (cleanedContent.startsWith("```json")) {
      cleanedContent = cleanedContent.slice(7);
    }
    if (cleanedContent.startsWith("```")) {
      cleanedContent = cleanedContent.slice(3);
    }
    if (cleanedContent.endsWith("```")) {
      cleanedContent = cleanedContent.slice(0, -3);
    }
    parsedResult = JSON.parse(cleanedContent.trim());
  } catch {
    parsedResult = {
      question: extractedQuestion,
      suggestedAnswer: analysisContent,
      keywords: [],
      markingScheme: ["Unable to determine marking scheme"],
      relatedConcepts: [
        {
          concept: "General Science",
          explanation: "Please review the answer for relevant concepts",
        },
      ],
      sourceReferences: relevantContext.sources,
    };
  }

  if (!parsedResult.sourceReferences || parsedResult.sourceReferences.length === 0) {
    parsedResult.sourceReferences = relevantContext.sources;
  }

  parsedResult.retrievalMethod = retrievalMethod;

  return parsedResult;
}

export async function POST(request: NextRequest) {
  try {
    const { image, compareMode = true } = await request.json();

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    const openai = getOpenAIClient();

    // Step 1: Extract question from image using GPT-4 Vision with enhanced OCR
    const extractionResponse = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert OCR system specialized in reading Singapore PSLE Science exam questions. Your task is to accurately extract and transcribe ALL text from exam question images.

CRITICAL INSTRUCTIONS:
1. Read EVERY word carefully, character by character
2. Preserve the exact wording - do not paraphrase or summarize
3. Include question numbers (e.g., "Question 5", "Q3", "1.", "(a)", "(b)")
4. Include all parts of multi-part questions
5. Include mark allocations if shown (e.g., "[2 marks]", "(2m)")
6. Describe any diagrams, tables, or figures in [brackets]
7. For tables, preserve the structure using simple formatting
8. If text is unclear, indicate with [unclear] but try your best guess
9. Handle both printed text AND handwritten text
10. Read left-to-right, top-to-bottom

OUTPUT FORMAT:
- Return ONLY the extracted question text
- Preserve line breaks for readability
- Do not add any commentary or explanations`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the complete question text from this exam paper image. Read every word carefully and accurately. Include any diagrams descriptions, tables, and all question parts.",
            },
            {
              type: "image_url",
              image_url: {
                url: image,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
    });

    const extractedQuestion = extractionResponse.choices[0]?.message?.content || "";

    if (!extractedQuestion) {
      return NextResponse.json(
        { error: "Could not extract question from image" },
        { status: 400 }
      );
    }

    if (compareMode) {
      // Run both retrievals in parallel
      const [standardContext, hybridResult] = await Promise.all([
        queryVectorStore(extractedQuestion),
        queryHybridStore(extractedQuestion, 5, 2, 3).catch(() => ({
          context: "",
          sources: [],
          graphEnhanced: false,
          messagePassingIterations: 0,
        })),
      ]);

      const hybridContext: RetrievalContext = {
        context: hybridResult.context,
        sources: hybridResult.sources,
      };

      // Generate answers for both methods in parallel
      const [standardResult, hybridResultFinal] = await Promise.all([
        generateAnswer(openai, extractedQuestion, standardContext, "Standard Vector Search"),
        generateAnswer(
          openai,
          extractedQuestion,
          hybridContext,
          hybridResult.graphEnhanced
            ? `Hybrid Graph-Vector (${hybridResult.messagePassingIterations} NW iterations)`
            : "Hybrid (fallback)"
        ),
      ]);

      return NextResponse.json({
        compareMode: true,
        question: extractedQuestion,
        standard: standardResult,
        hybrid: hybridResultFinal,
      });
    } else {
      // Single mode - just standard
      const relevantContext = await queryVectorStore(extractedQuestion);
      const result = await generateAnswer(openai, extractedQuestion, relevantContext, "Standard Vector Search");
      return NextResponse.json(result);
    }
  } catch (error) {
    console.error("Error analyzing question:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to analyze question" },
      { status: 500 }
    );
  }
}
