# PSLE Science Exam Assistant

A smart exam assistant that helps students with PSLE Science questions. Upload a photo of your exam question and get:

- **Suggested Answer** - Complete model answer for full marks
- **Required Keywords** - Essential terms that must appear in your answer
- **Marking Scheme** - How marks are allocated
- **Related Concepts** - Underlying science concepts being tested

## Features

- 📷 **Image Upload** - Take a photo of your exam question
- 🤖 **AI Vision** - Automatically reads and extracts the question
- 📚 **RAG Knowledge Base** - Searches through PSLE Science study materials
- ✅ **Structured Answers** - Get complete answers with marking guidance

## Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **AI**: OpenAI GPT-4o (Vision + Text)
- **Vector Database**: Pinecone
- **Deployment**: Vercel

## Setup Instructions

### 1. Prerequisites

- Node.js 18+ installed
- OpenAI API key (with GPT-4 Vision access)
- Pinecone account (free tier works)

### 2. Get API Keys

#### OpenAI API Key
1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Make sure your account has access to GPT-4o

#### Pinecone API Key
1. Go to https://www.pinecone.io/
2. Sign up for a free account
3. Create a new project
4. Copy your API key from the dashboard

### 3. Install Dependencies

```bash
cd psle-science-assistant
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Required
OPENAI_API_KEY=sk-your-openai-api-key
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX=psle-science

# Optional (defaults shown)
OPENAI_MODEL=gpt-4o
EMBEDDING_MODEL=text-embedding-3-small
DOCUMENTS_PATH=C:\PROJ\PSLE_Science
```

### 5. Ingest Documents into Vector Database

Before using the assistant, you need to process your PSLE Science PDF documents:

```bash
npm run ingest
```

This will:
- Read all PDFs from the DOCUMENTS_PATH
- Split them into chunks
- Create embeddings using OpenAI
- Store them in Pinecone

### 6. Run Locally

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## Deploying to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/psle-science-assistant.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Add environment variables:
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX`
4. Click "Deploy"

### 3. Important Notes for Production

- The document ingestion (`npm run ingest`) must be run locally before deployment
- The Pinecone index must already contain your documents
- Vercel's serverless functions have a 60-second timeout (configured in vercel.json)

## Project Structure

```
psle-science-assistant/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── analyze/
│   │   │       └── route.ts    # API endpoint for question analysis
│   │   ├── globals.css         # Tailwind styles
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Main UI with image upload
│   └── lib/
│       └── vector-store.ts     # Pinecone integration
├── scripts/
│   └── ingest-documents.ts     # PDF ingestion script
├── package.json
├── vercel.json                 # Vercel configuration
└── README.md
```

## How It Works

1. **Image Upload**: User uploads a photo of their exam question
2. **Vision AI**: GPT-4o extracts the question text from the image
3. **RAG Search**: The question is embedded and used to search Pinecone for relevant study material
4. **Answer Generation**: GPT-4o generates a comprehensive response using the retrieved context
5. **Structured Output**: The response includes answer, keywords, marking scheme, and related concepts

## Troubleshooting

### "Could not extract question from image"
- Ensure the image is clear and well-lit
- Try cropping to just the question area
- Make sure the question text is readable

### "Unable to retrieve relevant context"
- Check that you've run `npm run ingest` successfully
- Verify your Pinecone index exists and has documents
- Check your PINECONE_API_KEY and PINECONE_INDEX values

### API errors
- Verify your OPENAI_API_KEY is valid and has credits
- Check that your account has access to GPT-4o
- Review the browser console and server logs for details

## License

MIT
