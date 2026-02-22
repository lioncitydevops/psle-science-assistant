import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import pdf from "pdf-parse";

// Load environment variables
import "dotenv/config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

function splitIntoChunks(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  let currentChunk = "";
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Keep overlap from the end of the previous chunk
      const words = currentChunk.split(" ");
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

async function processPDF(filePath: string): Promise<Array<{ text: string; page: number }>> {
  console.log(`Processing PDF: ${filePath}`);
  
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  
  // Split by pages (approximate based on form feeds or page breaks)
  const pageTexts = data.text.split(/\f/);
  const result: Array<{ text: string; page: number }> = [];
  
  for (let i = 0; i < pageTexts.length; i++) {
    const pageText = pageTexts[i].trim();
    if (pageText.length > 50) { // Skip very short pages
      const chunks = splitIntoChunks(pageText);
      for (const chunk of chunks) {
        result.push({
          text: chunk,
          page: i + 1,
        });
      }
    }
  }
  
  return result;
}

async function ingestDocuments() {
  const documentsPath = process.env.DOCUMENTS_PATH || "C:\\PROJ\\PSLE_Science";
  const indexName = process.env.PINECONE_INDEX || "psle-science";
  
  console.log("Starting document ingestion...");
  console.log(`Documents path: ${documentsPath}`);
  console.log(`Pinecone index: ${indexName}`);
  
  // Get or create index
  const indexList = await pinecone.listIndexes();
  const indexExists = indexList.indexes?.some(idx => idx.name === indexName);
  
  if (!indexExists) {
    console.log(`Creating index: ${indexName}`);
    await pinecone.createIndex({
      name: indexName,
      dimension: 1536, // text-embedding-3-small dimension
      metric: "cosine",
      spec: {
        serverless: {
          cloud: "aws",
          region: "us-east-1",
        },
      },
    });
    // Wait for index to be ready
    console.log("Waiting for index to be ready...");
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
  
  const index = pinecone.index(indexName);
  
  // Find all PDF files
  const files = fs.readdirSync(documentsPath);
  const pdfFiles = files.filter(f => f.toLowerCase().endsWith(".pdf"));
  
  console.log(`Found ${pdfFiles.length} PDF file(s)`);
  
  for (const pdfFile of pdfFiles) {
    const filePath = path.join(documentsPath, pdfFile);
    console.log(`\nProcessing: ${pdfFile}`);
    
    try {
      const chunks = await processPDF(filePath);
      console.log(`Extracted ${chunks.length} chunks`);
      
      const vectors = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        try {
          const embedding = await getEmbedding(chunk.text);
          
          vectors.push({
            id: `${pdfFile.replace(/[^a-zA-Z0-9]/g, "-")}-chunk-${i}`,
            values: embedding,
            metadata: {
              text: chunk.text,
              source: pdfFile,
              page: chunk.page,
            },
          });
          
          // Upsert in batches
          if (vectors.length >= 50) {
            await index.upsert(vectors);
            console.log(`  Uploaded ${i + 1}/${chunks.length} chunks`);
            vectors.length = 0;
            
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (embeddingError) {
          console.error(`  Error embedding chunk ${i}:`, embeddingError);
          // Continue with next chunk
        }
      }
      
      // Upload remaining vectors
      if (vectors.length > 0) {
        await index.upsert(vectors);
        console.log(`  Uploaded final batch (${vectors.length} chunks)`);
      }
      
      console.log(`Completed: ${pdfFile}`);
    } catch (error) {
      console.error(`Error processing ${pdfFile}:`, error);
    }
  }
  
  console.log("\nDocument ingestion complete!");
}

// Run the ingestion
ingestDocuments().catch(console.error);
