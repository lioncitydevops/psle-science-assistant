/**
 * Hybrid Graph-Vector Store Implementation
 * Based on: "The Nadaraya-Watson Interpretation of Graph-Vector Mutual Containment"
 * 
 * Key concepts from the paper:
 * - Every weighted graph is a kernel matrix (Aij = K(xi, xj))
 * - Graph message passing = NW regression (Theorem 3.1)
 * - D+ map: Graph to Vector via Kernel PCA
 * - D- map: Vector to Graph via NW kernel thresholding
 * - Bandwidth h controls graph density (sparse ↔ dense)
 */

import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

interface HybridQueryResult {
  context: string;
  sources: string[];
  graphEnhanced: boolean;
  messagePassingIterations: number;
}

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

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(x: number[], y: number[]): number {
  let dot = 0, normX = 0, normY = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i] * y[i];
    normX += x[i] * x[i];
    normY += y[i] * y[i];
  }
  return dot / (Math.sqrt(normX) * Math.sqrt(normY) + 1e-10);
}

/**
 * Build weighted k-NN graph from embeddings
 * Returns adjacency with similarity weights (not just neighbor IDs)
 */
function buildWeightedKNNGraph(
  nodes: { id: string; embedding: number[] }[],
  k: number = 5
): Map<string, { neighborId: string; weight: number }[]> {
  const adjacency = new Map<string, { neighborId: string; weight: number }[]>();
  
  for (const node of nodes) {
    const similarities: { id: string; sim: number }[] = [];
    
    for (const other of nodes) {
      if (other.id !== node.id) {
        const sim = cosineSimilarity(node.embedding, other.embedding);
        similarities.push({ id: other.id, sim });
      }
    }
    
    // Sort by similarity and take top-k with weights
    similarities.sort((a, b) => b.sim - a.sim);
    const neighbors = similarities.slice(0, k).map(s => ({
      neighborId: s.id,
      weight: Math.max(0, s.sim), // Ensure non-negative
    }));
    adjacency.set(node.id, neighbors);
  }
  
  return adjacency;
}

/**
 * NW Message Passing with weighted edges (Theorem 3.1)
 * f'_i = (f_i + Σ_j w_ij * f_j) / (1 + Σ_j w_ij)
 * 
 * This propagates high scores to related neighbors while preserving original ranking
 */
function nwMessagePassingWeighted(
  nodeScores: Map<string, number>,
  adjacency: Map<string, { neighborId: string; weight: number }[]>,
  iterations: number = 1,
  selfWeight: number = 2.0  // Higher self-weight preserves original ranking
): Map<string, number> {
  let currentScores = new Map(nodeScores);
  
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();
    
    for (const [nodeId, neighbors] of adjacency.entries()) {
      const selfScore = currentScores.get(nodeId) || 0;
      let weightedSum = selfScore * selfWeight;
      let totalWeight = selfWeight;
      
      for (const { neighborId, weight } of neighbors) {
        const neighborScore = currentScores.get(neighborId) || 0;
        weightedSum += weight * neighborScore;
        totalWeight += weight;
      }
      
      // NW weighted average
      newScores.set(nodeId, weightedSum / totalWeight);
    }
    
    currentScores = newScores;
  }
  
  return currentScores;
}

/**
 * Normalize scores to [0, 1] range
 */
function normalizeScores(scores: Map<string, number>): Map<string, number> {
  const values = Array.from(scores.values());
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  
  const normalized = new Map<string, number>();
  for (const [id, score] of scores.entries()) {
    normalized.set(id, (score - min) / range);
  }
  return normalized;
}

async function getEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Hybrid Query: Combines vector similarity with graph-based message passing
 * 
 * Algorithm:
 * 1. Query Pinecone for initial vector matches (standard ANN)
 * 2. Build weighted k-NN graph from retrieved nodes (D- map)
 * 3. Apply weighted NW message passing to propagate relevance (Theorem 3.1)
 * 4. Re-rank results based on combined scores
 */
export async function queryHybridStore(
  query: string,
  topK: number = 5,
  messagePassingIterations: number = 2,
  graphNeighbors: number = 3
): Promise<HybridQueryResult> {
  try {
    const pinecone = getPineconeClient();
    
    // Try hybrid index first, fall back to standard index
    const hybridIndexName = process.env.PINECONE_HYBRID_INDEX || "psle-science-hybrid";
    const standardIndexName = process.env.PINECONE_INDEX || "psle-science";
    
    let index;
    let usingHybridIndex = true;
    
    try {
      index = pinecone.index(hybridIndexName);
      // Test if index has data
      const testQuery = await index.describeIndexStats();
      if (!testQuery.totalRecordCount || testQuery.totalRecordCount === 0) {
        console.log("Hybrid index empty, falling back to standard index");
        index = pinecone.index(standardIndexName);
        usingHybridIndex = false;
      }
    } catch {
      console.log("Hybrid index not found, using standard index");
      index = pinecone.index(standardIndexName);
      usingHybridIndex = false;
    }

    // Step 1: Get query embedding
    const queryEmbedding = await getEmbedding(query);

    // Step 2: Initial vector retrieval (over-fetch for graph construction)
    const overFetchK = Math.min(topK * 4, 40);
    const results = await index.query({
      vector: queryEmbedding,
      topK: overFetchK,
      includeMetadata: true,
      includeValues: true,
    });

    if (!results.matches || results.matches.length === 0) {
      return {
        context: "No relevant content found.",
        sources: [],
        graphEnhanced: false,
        messagePassingIterations: 0,
      };
    }

    // Step 3: Build local weighted graph from retrieved nodes
    const nodes = results.matches
      .filter(m => m.values && m.values.length > 0 && m.metadata?.text)
      .map(m => ({
        id: m.id,
        embedding: m.values as number[],
        text: m.metadata?.text as string,
        source: m.metadata?.source as string,
        page: m.metadata?.page as number,
        originalScore: m.score || 0,
      }));

    if (nodes.length === 0) {
      return {
        context: "No content with embeddings found.",
        sources: [],
        graphEnhanced: false,
        messagePassingIterations: 0,
      };
    }

    // Build weighted k-NN adjacency
    const adjacency = buildWeightedKNNGraph(
      nodes.map(n => ({ id: n.id, embedding: n.embedding })),
      Math.min(graphNeighbors, nodes.length - 1)
    );

    // Step 4: Initialize scores from vector similarity
    const initialScores = new Map<string, number>();
    for (const node of nodes) {
      initialScores.set(node.id, node.originalScore);
    }

    // Step 5: Apply weighted NW message passing
    const smoothedScores = nwMessagePassingWeighted(
      initialScores,
      adjacency,
      messagePassingIterations,
      3.0  // Strong self-weight to preserve good initial matches
    );

    // Normalize smoothed scores
    const normalizedSmoothed = normalizeScores(smoothedScores);

    // Step 6: Combine original and smoothed scores
    // Use higher weight for original to not hurt good initial matches
    const rankedNodes = nodes
      .map(n => {
        const smoothed = normalizedSmoothed.get(n.id) || 0;
        // Boost score if neighbors also have high relevance
        const graphBoost = smoothed > 0.5 ? 0.1 : 0;
        return {
          ...n,
          smoothedScore: smoothed,
          finalScore: n.originalScore + graphBoost,
        };
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, topK);

    // Prepare results
    const contexts: string[] = [];
    const sources: string[] = [];

    for (const node of rankedNodes) {
      if (node.text) {
        contexts.push(node.text);
      }
      if (node.source && node.page !== undefined) {
        const sourceRef = `${node.source} (Page ${node.page})`;
        if (!sources.includes(sourceRef)) {
          sources.push(sourceRef);
        }
      }
    }

    return {
      context: contexts.join("\n\n---\n\n"),
      sources,
      graphEnhanced: usingHybridIndex,
      messagePassingIterations,
    };
  } catch (error) {
    console.error("Error in hybrid query:", error);
    return {
      context: "Hybrid retrieval encountered an error.",
      sources: [],
      graphEnhanced: false,
      messagePassingIterations: 0,
    };
  }
}

/**
 * Add documents with graph structure
 */
export async function addDocumentsWithGraph(
  documents: Array<{
    text: string;
    source: string;
    page: number;
  }>,
  graphNeighbors: number = 5
): Promise<void> {
  const pinecone = getPineconeClient();
  const indexName = process.env.PINECONE_HYBRID_INDEX || "psle-science-hybrid";
  
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
  
  console.log("Generating embeddings...");
  const embeddings: number[][] = [];
  for (let i = 0; i < documents.length; i++) {
    const embedding = await getEmbedding(documents[i].text);
    embeddings.push(embedding);
    
    if ((i + 1) % 10 === 0) {
      console.log(`  Embedded ${i + 1}/${documents.length}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  console.log("Uploading to Pinecone...");
  const vectors = [];
  
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    
    vectors.push({
      id: `hybrid-${Date.now()}-${i}`,
      values: embeddings[i],
      metadata: {
        text: doc.text,
        source: doc.source,
        page: doc.page,
      },
    });
    
    if (vectors.length >= 50 || i === documents.length - 1) {
      await index.upsert(vectors);
      console.log(`  Uploaded ${i + 1}/${documents.length}`);
      vectors.length = 0;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log("Hybrid index created!");
}
