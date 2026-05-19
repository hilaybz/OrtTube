# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project Overview

**OrtTube** is an educational video learning platform. Users paste a YouTube URL, watch the video, and receive AI-generated quizzes at 25%, 50%, and 75% progress. After each quiz, an AI tutor (Claude) can answer follow-up questions about the content. The app is entirely TypeScript/Next.js — there is no Python backend.

## Commands

```bash
npm run dev       # Start dev server (localhost:3000)
npm run build     # Production build
npm run start     # Serve production build
npm run lint      # ESLint
```

No test runner is configured yet.

## Architecture

### Data Flow

```
app/page.tsx (URLInput)
  → extracts videoId via lib/youtube.ts
  → navigates to /watch/[videoId]

app/watch/[videoId]/page.tsx
  → renders VideoPlayer component
  → VideoPlayer calls GET /api/quizzes?videoId=...

app/api/quizzes/route.ts
  → lib/transcript.ts: fetchTranscript(videoId) via youtube-transcript npm pkg
  → lib/transcript.ts: buildCheckpoints(segments) → calls Claude to generate 2 questions per checkpoint (25%, 50%, 75%)
  → falls back to lib/demoQuiz.ts if transcript unavailable

VideoPlayer (components/VideoPlayer.tsx)
  → tracks YouTube player progress via react-youtube onStateChange
  → triggers QuizModal at each checkpoint threshold

QuizModal (components/QuizModal.tsx)
  → shows generated questions with multiple-choice answers
  → "Ask AI" button streams from POST /api/ask

app/api/ask/route.ts
  → Claude streaming endpoint for follow-up Q&A
  → receives { question, quizContext, transcriptContext? }
```

### Key Design Decisions

- **Quiz generation at request time**: Quizzes are generated on-demand when `/api/quizzes` is called, not pre-cached. Claude Haiku (`claude-haiku-4-5-20251001`) is used for both quiz generation and tutoring.
- **Demo fallback**: `lib/demoQuiz.ts` provides static quiz data when transcript extraction fails — useful for development without network access.
- **Transcript source**: Uses the `youtube-transcript` npm package (not the Python `youtube_transcript_api`). Hebrew support requires `'he'` and `'iw'` language codes (older videos use `'iw'`).
- **Streaming AI responses**: `/api/ask` uses Claude's streaming API; `QuizModal` reads the response as a `ReadableStream`.

## Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...   # Required — Claude API key
```

Copy `.env.local.example` to `.env.local` for local development.

## Stack

- **Next.js 16** (App Router, TypeScript strict mode)
- **Tailwind CSS 4** (via `@tailwindcss/postcss`)
- **@anthropic-ai/sdk** — Claude API (quiz generation + streaming tutor)
- **react-youtube** — YouTube player embed
- **youtube-transcript** — Fetches YouTube captions server-side

## Path Alias

`@/*` maps to the repo root. Use `@/lib/...`, `@/components/...` etc.
