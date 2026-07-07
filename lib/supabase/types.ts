// Run `npx supabase gen types typescript --project-id <id> --schema public > lib/supabase/types.ts`
// to regenerate after schema changes.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      teachers: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      videos: {
        Row: {
          id: string;
          teacher_id: string;
          youtube_video_id: string;
          title: string | null;
          duration_seconds: number | null;
          share_code: string;
          transcript_status: "pending" | "ready" | "unavailable";
          transcript_lang: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          teacher_id: string;
          youtube_video_id: string;
          title?: string | null;
          duration_seconds?: number | null;
          share_code?: string;
          transcript_status?: "pending" | "ready" | "unavailable";
          transcript_lang?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          teacher_id?: string;
          youtube_video_id?: string;
          title?: string | null;
          duration_seconds?: number | null;
          share_code?: string;
          transcript_status?: "pending" | "ready" | "unavailable";
          transcript_lang?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "videos_teacher_id_fkey";
            columns: ["teacher_id"];
            referencedRelation: "teachers";
            referencedColumns: ["id"];
          }
        ];
      };
      youtube_transcripts: {
        Row: {
          youtube_video_id: string;
          language: string;
          source: string | null;
          summary: string | null;
          fetched_at: string;
        };
        Insert: {
          youtube_video_id: string;
          language: string;
          source?: string | null;
          summary?: string | null;
          fetched_at?: string;
        };
        Update: {
          youtube_video_id?: string;
          language?: string;
          source?: string | null;
          summary?: string | null;
          fetched_at?: string;
        };
        Relationships: [];
      };
      quiz_checkpoints: {
        Row: {
          id: string;
          video_id: string;
          position_seconds: number;
          label: string | null;
          order_index: number;
        };
        Insert: {
          id?: string;
          video_id: string;
          position_seconds: number;
          label?: string | null;
          order_index?: number;
        };
        Update: {
          id?: string;
          video_id?: string;
          position_seconds?: number;
          label?: string | null;
          order_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_checkpoints_video_id_fkey";
            columns: ["video_id"];
            referencedRelation: "videos";
            referencedColumns: ["id"];
          }
        ];
      };
      quiz_questions: {
        Row: {
          id: string;
          checkpoint_id: string;
          question: string;
          options: Json;
          correct_index: number;
          explanation: string | null;
          ai_generated: boolean;
          order_index: number;
        };
        Insert: {
          id?: string;
          checkpoint_id: string;
          question: string;
          options: Json;
          correct_index: number;
          explanation?: string | null;
          ai_generated?: boolean;
          order_index?: number;
        };
        Update: {
          id?: string;
          checkpoint_id?: string;
          question?: string;
          options?: Json;
          correct_index?: number;
          explanation?: string | null;
          ai_generated?: boolean;
          order_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_questions_checkpoint_id_fkey";
            columns: ["checkpoint_id"];
            referencedRelation: "quiz_checkpoints";
            referencedColumns: ["id"];
          }
        ];
      };
      student_sessions: {
        Row: {
          id: string;
          video_id: string;
          supabase_user_id: string | null;
          student_name: string | null;
          started_at: string;
          completed_at: string | null;
          final_score: number | null;
          total_questions: number | null;
        };
        Insert: {
          id?: string;
          video_id: string;
          supabase_user_id?: string | null;
          student_name?: string | null;
          started_at?: string;
          completed_at?: string | null;
          final_score?: number | null;
          total_questions?: number | null;
        };
        Update: {
          id?: string;
          video_id?: string;
          supabase_user_id?: string | null;
          student_name?: string | null;
          started_at?: string;
          completed_at?: string | null;
          final_score?: number | null;
          total_questions?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "student_sessions_video_id_fkey";
            columns: ["video_id"];
            referencedRelation: "videos";
            referencedColumns: ["id"];
          }
        ];
      };
      student_answers: {
        Row: {
          id: string;
          session_id: string;
          question_id: string;
          selected_index: number;
          is_correct: boolean;
          answered_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          question_id: string;
          selected_index: number;
          is_correct: boolean;
          answered_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          question_id?: string;
          selected_index?: number;
          is_correct?: boolean;
          answered_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_answers_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "student_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_answers_question_id_fkey";
            columns: ["question_id"];
            referencedRelation: "quiz_questions";
            referencedColumns: ["id"];
          }
        ];
      };
      student_events: {
        Row: {
          id: string;
          session_id: string;
          event_type: "confusion" | "ask_ai" | "quiz_checkpoint";
          video_timestamp_seconds: number | null;
          query: string | null;
          response: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          event_type: "confusion" | "ask_ai" | "quiz_checkpoint";
          video_timestamp_seconds?: number | null;
          query?: string | null;
          response?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          event_type?: "confusion" | "ask_ai" | "quiz_checkpoint";
          video_timestamp_seconds?: number | null;
          query?: string | null;
          response?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_events_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "student_sessions";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
