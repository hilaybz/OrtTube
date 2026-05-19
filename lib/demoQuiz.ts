export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

export interface QuizCheckpoint {
  percent: number;
  label: string;
  questions: QuizQuestion[];
  transcriptContext?: string;
}

export const QUIZ_CHECKPOINTS: QuizCheckpoint[] = [
  {
    percent: 25,
    label: "First Quarter Check",
    questions: [
      {
        id: 1,
        question: "What was the main topic introduced in the first part of the video?",
        options: [
          "A step-by-step practical tutorial",
          "A conceptual overview of the subject",
          "A historical timeline of events",
          "A comparison of competing theories",
        ],
        correct: 1,
        explanation:
          "The opening section typically establishes the conceptual framework before diving into specifics.",
      },
      {
        id: 2,
        question: "Which of the following best describes the presenter's approach so far?",
        options: [
          "Starting with advanced material and working backwards",
          "Presenting multiple viewpoints without taking a stance",
          "Building from foundational concepts toward complexity",
          "Focusing exclusively on real-world examples",
        ],
        correct: 2,
        explanation:
          "Most educational videos scaffold from foundational ideas outward to more complex applications.",
      },
    ],
  },
  {
    percent: 50,
    label: "Halfway Check",
    questions: [
      {
        id: 3,
        question: "How did the content in the second section relate to what was introduced earlier?",
        options: [
          "It contradicted the earlier claims",
          "It expanded on the foundational ideas with more detail",
          "It introduced a completely unrelated topic",
          "It summarized the first section only",
        ],
        correct: 1,
        explanation:
          "Well-structured videos build on earlier content, adding depth and examples as they progress.",
      },
      {
        id: 4,
        question: "What role did examples play in this section?",
        options: [
          "They were absent — the section was purely theoretical",
          "They illustrated abstract concepts in a concrete way",
          "They were used to confuse or challenge the viewer",
          "They replaced explanations entirely",
        ],
        correct: 1,
        explanation:
          "Examples are the bridge between theory and understanding. They make abstract ideas tangible.",
      },
    ],
  },
  {
    percent: 75,
    label: "Third Quarter Check",
    questions: [
      {
        id: 5,
        question: "What is the central argument the video has been building toward?",
        options: [
          "The topic is too complex to fully understand",
          "Understanding the core concept unlocks practical application",
          "Most real-world scenarios are exceptions to the rule",
          "The historical context is more important than current usage",
        ],
        correct: 1,
        explanation:
          "Educational content is usually structured to lead the learner toward an insight or skill they can apply.",
      },
      {
        id: 6,
        question: "At this point in the video, which statement are you most confident in?",
        options: [
          "I could explain the core concept to someone else",
          "I understand the topic but couldn't explain it yet",
          "I need to rewatch earlier sections to follow along",
          "The topic is outside what I expected to learn",
        ],
        correct: 0,
        explanation:
          "By three quarters through a well-structured video, the core idea should feel familiar and explainable.",
      },
    ],
  },
];
