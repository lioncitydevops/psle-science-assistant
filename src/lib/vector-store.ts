import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

let openaiClient: OpenAI | null = null;
let pineconeClient: Pinecone | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
  }
  return pineconeClient;
}

async function getEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

export async function queryVectorStore(
  query: string,
  topK: number = 5
): Promise<{ context: string; sources: string[] }> {
  try {
    const pinecone = getPineconeClient();
    const index = pinecone.index(process.env.PINECONE_INDEX || "psle-science");

    const queryEmbedding = await getEmbedding(query);

    const results = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });

    const contexts: string[] = [];
    const sources: string[] = [];

    for (const match of results.matches || []) {
      if (match.metadata) {
        const text = match.metadata.text as string;
        const source = match.metadata.source as string;
        const page = match.metadata.page as number;

        if (text) {
          contexts.push(text);
        }
        if (source && page !== undefined) {
          const sourceRef = `${source} (Page ${page})`;
          if (!sources.includes(sourceRef)) {
            sources.push(sourceRef);
          }
        }
      }
    }

    return {
      context: contexts.join("\n\n---\n\n"),
      sources,
    };
  } catch (error) {
    console.error("Error querying vector store:", error);
    return {
      context: "Unable to retrieve relevant context from knowledge base.",
      sources: [],
    };
  }
}

export async function addDocuments(
  documents: Array<{
    text: string;
    source: string;
    page: number;
  }>
): Promise<void> {
  const pinecone = getPineconeClient();
  const index = pinecone.index(process.env.PINECONE_INDEX || "psle-science");

  const vectors = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const embedding = await getEmbedding(doc.text);

    vectors.push({
      id: `doc-${Date.now()}-${i}`,
      values: embedding,
      metadata: {
        text: doc.text,
        source: doc.source,
        page: doc.page,
      },
    });

    // Process in batches to avoid rate limits
    if (vectors.length >= 100 || i === documents.length - 1) {
      await index.upsert(vectors);
      vectors.length = 0;
      console.log(`Processed ${i + 1}/${documents.length} documents`);
    }
  }
}
