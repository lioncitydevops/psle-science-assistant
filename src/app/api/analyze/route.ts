import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { queryVectorStore } from "@/lib/vector-store";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return new OpenAI({ apiKey });
}

export async function POST(request: NextRequest) {
  try {
    const { image } = await request.json();

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    const openai = getOpenAIClient();

    // Step 1: Extract question from image using GPT-4 Vision
    const extractionResponse = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "You are an expert at reading PSLE Science exam questions. Extract the complete question text from this image. If there are multiple parts (a, b, c, etc.), include all of them. Only return the question text, nothing else.",
            },
            {
              type: "image_url",
              image_url: {
                url: image,
              },
            },
          ],
        },
      ],
      max_tokens: 1000,
    });

    const extractedQuestion = extractionResponse.choices[0]?.message?.content || "";

    if (!extractedQuestion) {
      return NextResponse.json(
        { error: "Could not extract question from image" },
        { status: 400 }
      );
    }

    // Step 2: Search for relevant content in the knowledge base
    const relevantContext = await queryVectorStore(extractedQuestion);

    // Step 3: Generate comprehensive answer with all required components
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

    // Parse the JSON response
    let parsedResult;
    try {
      // Clean up the response in case it has markdown code blocks
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
      // If JSON parsing fails, create a structured response from the text
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

    // Add source references if not present
    if (!parsedResult.sourceReferences || parsedResult.sourceReferences.length === 0) {
      parsedResult.sourceReferences = relevantContext.sources;
    }

    return NextResponse.json(parsedResult);
  } catch (error) {
    console.error("Error analyzing question:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to analyze question" },
      { status: 500 }
    );
  }
}
