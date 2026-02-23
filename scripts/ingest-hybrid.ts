/**
 * Hybrid Graph-Vector Document Ingestion
 * Based on: "The Nadaraya-Watson Interpretation of Graph-Vector Mutual Containment"
 * 
 * This script:
 * 1. Reads PDF documents and splits into chunks
 * 2. Generates embeddings for each chunk
 * 3. Builds k-NN graph structure (D- map: vectors to graph)
 * 4. Stores both vectors and graph edges in Pinecone
 */

import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import pdf from "pdf-parse";

import "dotenv/config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const GRAPH_NEIGHBORS = 5;  // k for k-NN graph construction
const CHUNK_SIZE = 800;     // Smaller chunks for finer graph granularity
const CHUNK_OVERLAP = 150;

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

/**
 * D- Map: Build k-NN graph from embeddings (Theorem 4.2)
 */
function buildKNNGraph(
  embeddings: number[][],
  k: number
): Map<number, number[]> {
  console.log(`Building k-NN graph with k=${k}...`);
  const adjacency = new Map<number, number[]>();
  
  for (let i = 0; i < embeddings.length; i++) {
    const similarities: { idx: number; sim: number }[] = [];
    
    for (let j = 0; j < embeddings.length; j++) {
      if (i !== j) {
        const sim = cosineSimilarity(embeddings[i], embeddings[j]);
        similarities.push({ idx: j, sim });
      }
    }
    
    // Sort by similarity and take top-k
    similarities.sort((a, b) => b.sim - a.sim);
    const neighbors = similarities.slice(0, k).map(s => s.idx);
    adjacency.set(i, neighbors);
    
    if ((i + 1) % 50 === 0) {
      console.log(`  Graph: processed ${i + 1}/${embeddings.length} nodes`);
    }
  }
  
  return adjacency;
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  let currentChunk = "";
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const words = currentChunk.split(" ");
      const overlapWords = words.slice(-Math.floor(CHUNK_OVERLAP / 5));
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
  
  const pageTexts = data.text.split(/\f/);
  const result: Array<{ text: string; page: number }> = [];
  
  for (let i = 0; i < pageTexts.length; i++) {
    const pageText = pageTexts[i].trim();
    if (pageText.length > 50) {
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

async function ingestHybrid() {
  const documentsPath = process.env.DOCUMENTS_PATH || "C:\\PROJ\\PSLE_Science";
  const indexName = process.env.PINECONE_HYBRID_INDEX || "psle-science-hybrid";
  
  console.log("===========================================");
  console.log("Hybrid Graph-Vector Document Ingestion");
  console.log("Based on NW Graph-Vector Duality Framework");
  console.log("===========================================");
  console.log(`Documents path: ${documentsPath}`);
  console.log(`Hybrid index: ${indexName}`);
  console.log(`Graph neighbors (k): ${GRAPH_NEIGHBORS}`);
  console.log();
  
  // Get or create hybrid index
  const indexList = await pinecone.listIndexes();
  const indexExists = indexList.indexes?.some(idx => idx.name === indexName);
  
  if (!indexExists) {
    console.log(`Creating hybrid index: ${indexName}`);
    await pinecone.createIndex({
      name: indexName,
      dimension: 1536,
      metric: "cosine",
      spec: {
        serverless: {
          cloud: "aws",
          region: "us-east-1",
        },
      },
    });
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
    console.log(`\n--- Processing: ${pdfFile} ---`);
    
    try {
      // Step 1: Extract chunks
      const chunks = await processPDF(filePath);
      console.log(`Extracted ${chunks.length} chunks`);
      
      // Step 2: Generate embeddings
      console.log("Generating embeddings...");
      const embeddings: number[][] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        try {
          const embedding = await getEmbedding(chunks[i].text);
          embeddings.push(embedding);
          
          if ((i + 1) % 20 === 0) {
            console.log(`  Embeddings: ${i + 1}/${chunks.length}`);
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch (embeddingError) {
          console.error(`  Error embedding chunk ${i}:`, embeddingError);
          embeddings.push(new Array(1536).fill(0)); // Placeholder
        }
      }
      
      // Step 3: Build k-NN graph (D- map)
      const adjacency = buildKNNGraph(embeddings, GRAPH_NEIGHBORS);
      
      // Step 4: Calculate graph statistics
      let totalEdges = 0;
      for (const neighbors of adjacency.values()) {
        totalEdges += neighbors.length;
      }
      console.log(`Graph built: ${chunks.length} nodes, ${totalEdges} edges`);
      
      // Step 5: Upsert to Pinecone with graph structure
      console.log("Uploading to Pinecone with graph metadata...");
      const vectors = [];
      const idPrefix = pdfFile.replace(/[^a-zA-Z0-9]/g, "-");
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const nodeId = `${idPrefix}-hybrid-${i}`;
        const neighbors = adjacency.get(i) || [];
        const neighborIds = neighbors.map(n => `${idPrefix}-hybrid-${n}`);
        
        vectors.push({
          id: nodeId,
          values: embeddings[i],
          metadata: {
            text: chunk.text,
            source: pdfFile,
            page: chunk.page,
            chunk_index: i,
            neighbors: neighborIds.join(","),
            neighbor_count: neighbors.length,
            graph_type: "knn",
            k: GRAPH_NEIGHBORS,
          },
        });
        
        if (vectors.length >= 50 || i === chunks.length - 1) {
          await index.upsert(vectors);
          console.log(`  Uploaded ${i + 1}/${chunks.length} chunks`);
          vectors.length = 0;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log(`Completed: ${pdfFile}`);
      
    } catch (error) {
      console.error(`Error processing ${pdfFile}:`, error);
    }
  }
  
  console.log("\n===========================================");
  console.log("Hybrid Graph-Vector ingestion complete!");
  console.log("===========================================");
  console.log("\nThe hybrid index now contains:");
  console.log("- Vector embeddings for semantic search");
  console.log("- k-NN graph edges for message passing");
  console.log("\nUse queryHybridStore() for enhanced retrieval");
}

ingestHybrid().catch(console.error);
