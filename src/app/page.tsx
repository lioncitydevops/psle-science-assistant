"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Camera, BookOpen, Lightbulb, CheckCircle, Loader2, X, FileText, Zap, Database } from "lucide-react";

interface AnalysisResult {
  question: string;
  suggestedAnswer: string;
  keywords: string[];
  markingScheme: string[];
  relatedConcepts: {
    concept: string;
    explanation: string;
  }[];
  sourceReferences: string[];
  retrievalMethod: string;
}

interface CompareResult {
  compareMode: true;
  question: string;
  standard: AnalysisResult;
  hybrid: AnalysisResult;
}

function ResultCard({ result, title, icon: Icon, accentColor }: {
  result: AnalysisResult;
  title: string;
  icon: React.ElementType;
  accentColor: string;
}) {
  const colors = {
    blue: {
      bg: "bg-blue-50",
      border: "border-blue-200",
      header: "bg-blue-600",
      text: "text-blue-600",
      light: "bg-blue-100",
      badge: "bg-blue-100 text-blue-800",
    },
    purple: {
      bg: "bg-purple-50",
      border: "border-purple-200",
      header: "bg-purple-600",
      text: "text-purple-600",
      light: "bg-purple-100",
      badge: "bg-purple-100 text-purple-800",
    },
  }[accentColor] || {
    bg: "bg-gray-50",
    border: "border-gray-200",
    header: "bg-gray-600",
    text: "text-gray-600",
    light: "bg-gray-100",
    badge: "bg-gray-100 text-gray-800",
  };

  return (
    <div className={`rounded-2xl border-2 ${colors.border} overflow-hidden`}>
      <div className={`${colors.header} text-white px-4 py-3 flex items-center gap-2`}>
        <Icon className="w-5 h-5" />
        <span className="font-semibold">{title}</span>
        <span className="ml-auto text-xs opacity-80">{result.retrievalMethod}</span>
      </div>
      
      <div className="p-4 space-y-4 bg-white">
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <CheckCircle className={`w-4 h-4 ${colors.text}`} />
            Suggested Answer
          </h4>
          <div className={`text-sm text-gray-700 ${colors.bg} p-3 rounded-lg whitespace-pre-wrap`}>
            {result.suggestedAnswer}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Required Keywords</h4>
          <div className="flex flex-wrap gap-1">
            {result.keywords.map((keyword, index) => (
              <span
                key={index}
                className={`px-2 py-0.5 ${colors.badge} rounded-full text-xs font-medium`}
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Marking Scheme</h4>
          <ul className="space-y-1 text-sm">
            {result.markingScheme.map((point, index) => (
              <li key={index} className="flex items-start gap-1 text-gray-600">
                <CheckCircle className={`w-3 h-3 ${colors.text} mt-1 flex-shrink-0`} />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Related Concepts</h4>
          <div className="space-y-2">
            {result.relatedConcepts.map((item, index) => (
              <div key={index} className={`${colors.light} p-2 rounded-lg`}>
                <h5 className="font-medium text-gray-800 text-sm">{item.concept}</h5>
                <p className="text-xs text-gray-600">{item.explanation}</p>
              </div>
            ))}
          </div>
        </div>

        {result.sourceReferences && result.sourceReferences.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Sources</h4>
            <ul className="text-xs text-gray-500 space-y-0.5">
              {result.sourceReferences.slice(0, 3).map((ref, index) => (
                <li key={index}>• {ref}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
      };
      reader.readAsDataURL(file);
      setCompareResult(null);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
    },
    maxFiles: 1,
  });

  const analyzeQuestion = async () => {
    if (!image) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image, compareMode: true }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to analyze question");
      }

      const data = await response.json();
      setCompareResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearImage = () => {
    setImage(null);
    setCompareResult(null);
    setError(null);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <header className="bg-white shadow-sm border-b border-green-100">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">PSLE Science Assistant</h1>
              <p className="text-sm text-gray-500">Compare Standard vs Graph-Vector Hybrid RAG</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Camera className="w-5 h-5 text-green-600" />
            Upload Question Image
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              {!image ? (
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${
                    isDragActive
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300 hover:border-green-400 hover:bg-green-50/50"
                  }`}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-10 h-10 mx-auto text-gray-400 mb-3" />
                  <p className="text-gray-600 font-medium text-sm">
                    {isDragActive
                      ? "Drop the image here..."
                      : "Drag & drop an image, or click to select"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Supports PNG, JPG, JPEG, GIF, WEBP
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <img
                      src={image}
                      alt="Uploaded question"
                      className="w-full rounded-lg border border-gray-200 max-h-64 object-contain"
                    />
                    <button
                      onClick={clearImage}
                      className="absolute top-2 right-2 w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    onClick={analyzeQuestion}
                    disabled={isAnalyzing}
                    className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Analyzing with Both Methods...
                      </>
                    ) : (
                      <>
                        <Lightbulb className="w-5 h-5" />
                        Compare Retrieval Methods
                      </>
                    )}
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}
            </div>

            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4">
              <h3 className="font-semibold text-gray-900 mb-3 text-sm">Comparison Mode</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-blue-200">
                  <Database className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-blue-900 text-sm">Standard Vector Search</h4>
                    <p className="text-xs text-gray-600">Native Pinecone cosine similarity search</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-purple-200">
                  <Zap className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-purple-900 text-sm">Graph-Vector Hybrid</h4>
                    <p className="text-xs text-gray-600">NW-Duality framework with k-NN graph + message passing</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {isAnalyzing && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 text-center">
            <Loader2 className="w-12 h-12 text-green-600 animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Analyzing Your Question</h3>
            <p className="text-gray-500 text-sm">
              Running both Standard and Hybrid retrieval methods in parallel...
            </p>
          </div>
        )}

        {compareResult && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <FileText className="w-5 h-5 text-green-600" />
                Detected Question
              </h3>
              <p className="text-gray-700 bg-green-50 p-3 rounded-lg text-sm">{compareResult.question}</p>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <ResultCard
                result={compareResult.standard}
                title="Standard Vector Search"
                icon={Database}
                accentColor="blue"
              />
              <ResultCard
                result={compareResult.hybrid}
                title="Graph-Vector Hybrid (NW-Duality)"
                icon={Zap}
                accentColor="purple"
              />
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-4 border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-2 text-center">Method Comparison</h3>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="bg-white rounded-lg p-3 border border-blue-200">
                  <h4 className="font-medium text-blue-800 mb-1">Standard (Left)</h4>
                  <p className="text-gray-600 text-xs">
                    Uses direct cosine similarity matching in vector space. Fast but may miss semantically related content.
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-purple-200">
                  <h4 className="font-medium text-purple-800 mb-1">Hybrid (Right)</h4>
                  <p className="text-gray-600 text-xs">
                    Builds k-NN graph and applies Nadaraya-Watson message passing to propagate relevance through related chunks.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!compareResult && !isAnalyzing && (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Results Yet</h3>
            <p className="text-gray-500 text-sm">
              Upload an image of your exam question to compare retrieval methods
            </p>
          </div>
        )}
      </div>

      <footer className="bg-white border-t border-gray-100 mt-8">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          PSLE Science Assistant - Comparing Standard RAG vs NW-Duality Graph-Vector Hybrid
        </div>
      </footer>
    </main>
  );
}
