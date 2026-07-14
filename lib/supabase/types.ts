export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      answer_selections: {
        Row: {
          answer_id: string
          option_id: string
        }
        Insert: {
          answer_id: string
          option_id: string
        }
        Update: {
          answer_id?: string
          option_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answer_selections_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_selections_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "question_options"
            referencedColumns: ["id"]
          },
        ]
      }
      answers: {
        Row: {
          answered_at: string
          attempt_id: string
          id: string
          question_id: string
          was_correct: boolean
        }
        Insert: {
          answered_at?: string
          attempt_id: string
          id?: string
          question_id: string
          was_correct: boolean
        }
        Update: {
          answered_at?: string
          attempt_id?: string
          id?: string
          question_id?: string
          was_correct?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_questions: {
        Row: {
          attempt_id: string
          order_index: number | null
          question_id: string
        }
        Insert: {
          attempt_id: string
          order_index?: number | null
          question_id: string
        }
        Update: {
          attempt_id?: string
          order_index?: number | null
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attempt_questions_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempt_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      attempts: {
        Row: {
          attempt_no: number
          class_id: string
          completed_at: string | null
          id: string
          num_correct: number | null
          num_questions: number | null
          quiz_id: string
          started_at: string
          student_id: string | null
        }
        Insert: {
          attempt_no?: number
          class_id: string
          completed_at?: string | null
          id?: string
          num_correct?: number | null
          num_questions?: number | null
          quiz_id: string
          started_at?: string
          student_id?: string | null
        }
        Update: {
          attempt_no?: number
          class_id?: string
          completed_at?: string | null
          id?: string
          num_correct?: number | null
          num_questions?: number | null
          quiz_id?: string
          started_at?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempts_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_invites: {
        Row: {
          class_id: string
          created_at: string
          email: string
          id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_invites_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      class_members: {
        Row: {
          class_id: string
          joined_at: string
          student_id: string
          student_role: string
        }
        Insert: {
          class_id: string
          joined_at?: string
          student_id: string
          student_role?: string
        }
        Update: {
          class_id?: string
          joined_at?: string
          student_id?: string
          student_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_members_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_members_student_id_student_role_fkey"
            columns: ["student_id", "student_role"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "role"]
          },
        ]
      }
      class_quizzes: {
        Row: {
          assigned_at: string
          class_id: string
          max_attempts: number | null
          quiz_id: string
          tutor_mode: string
        }
        Insert: {
          assigned_at?: string
          class_id: string
          max_attempts?: number | null
          quiz_id: string
          tutor_mode?: string
        }
        Update: {
          assigned_at?: string
          class_id?: string
          max_attempts?: number | null
          quiz_id?: string
          tutor_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_quizzes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_quizzes_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          created_at: string
          id: string
          language: string
          name: string
          school_id: string
          teacher_id: string
          teacher_role: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string
          name: string
          school_id: string
          teacher_id: string
          teacher_role?: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string
          name?: string
          school_id?: string
          teacher_id?: string
          teacher_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_teacher_id_school_id_fkey"
            columns: ["teacher_id", "school_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "classes_teacher_id_teacher_role_fkey"
            columns: ["teacher_id", "teacher_role"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "role"]
          },
        ]
      }
      option_translations: {
        Row: {
          language: string
          option_id: string
          text: string
        }
        Insert: {
          language: string
          option_id: string
          text: string
        }
        Update: {
          language?: string
          option_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_translations_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "question_options"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deactivated_at: string | null
          display_name: string | null
          email: string
          id: string
          preferred_language: string | null
          role: string
          school_id: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          display_name?: string | null
          email: string
          id: string
          preferred_language?: string | null
          role: string
          school_id: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          display_name?: string | null
          email?: string
          id?: string
          preferred_language?: string | null
          role?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      question_options: {
        Row: {
          deleted_at: string | null
          id: string
          is_correct: boolean
          order_index: number
          question_id: string
        }
        Insert: {
          deleted_at?: string | null
          id?: string
          is_correct?: boolean
          order_index?: number
          question_id: string
        }
        Update: {
          deleted_at?: string | null
          id?: string
          is_correct?: boolean
          order_index?: number
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_translations: {
        Row: {
          explanation: string | null
          language: string
          prompt: string
          question_id: string
          source: string
        }
        Insert: {
          explanation?: string | null
          language: string
          prompt: string
          question_id: string
          source?: string
        }
        Update: {
          explanation?: string | null
          language?: string
          prompt?: string
          question_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_translations_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          deleted_at: string | null
          id: string
          kind: string
          order_index: number
          position_seconds: number
          quiz_id: string
        }
        Insert: {
          deleted_at?: string | null
          id?: string
          kind?: string
          order_index?: number
          position_seconds: number
          quiz_id: string
        }
        Update: {
          deleted_at?: string | null
          id?: string
          kind?: string
          order_index?: number
          position_seconds?: number
          quiz_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          author_id: string
          base_language: string
          cloned_from_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          school_id: string
          title: string | null
          video_id: string
          visibility: string
        }
        Insert: {
          author_id: string
          base_language?: string
          cloned_from_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          school_id: string
          title?: string | null
          video_id: string
          visibility?: string
        }
        Update: {
          author_id?: string
          base_language?: string
          cloned_from_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          school_id?: string
          title?: string | null
          video_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_cloned_from_id_fkey"
            columns: ["cloned_from_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      translation_jobs: {
        Row: {
          completed_at: string | null
          language: string
          quiz_id: string
          started_at: string | null
        }
        Insert: {
          completed_at?: string | null
          language: string
          quiz_id: string
          started_at?: string | null
        }
        Update: {
          completed_at?: string | null
          language?: string
          quiz_id?: string
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "translation_jobs_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_questions: {
        Row: {
          ai_response: string | null
          attempt_id: string | null
          class_id: string
          created_at: string
          id: string
          position_seconds: number | null
          prompt: string
          question_id: string | null
          quiz_id: string
          student_id: string | null
          video_id: string
        }
        Insert: {
          ai_response?: string | null
          attempt_id?: string | null
          class_id: string
          created_at?: string
          id?: string
          position_seconds?: number | null
          prompt: string
          question_id?: string | null
          quiz_id: string
          student_id?: string | null
          video_id: string
        }
        Update: {
          ai_response?: string | null
          attempt_id?: string | null
          class_id?: string
          created_at?: string
          id?: string
          position_seconds?: number | null
          prompt?: string
          question_id?: string | null
          quiz_id?: string
          student_id?: string | null
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_questions_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_questions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_questions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_questions_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          created_at: string
          duration_seconds: number | null
          fetched_at: string | null
          id: string
          title: string | null
          transcript_fetch_started_at: string | null
          transcript_status: string
          youtube_video_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          fetched_at?: string | null
          id?: string
          title?: string | null
          transcript_fetch_started_at?: string | null
          transcript_status?: string
          youtube_video_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          fetched_at?: string | null
          id?: string
          title?: string | null
          transcript_fetch_started_at?: string | null
          transcript_status?: string
          youtube_video_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _assert_class_owner: {
        Args: { p_class_id: string }
        Returns: {
          created_at: string
          id: string
          language: string
          name: string
          school_id: string
          teacher_id: string
          teacher_role: string
        }
        SetofOptions: {
          from: "*"
          to: "classes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _assert_quiz_owner: {
        Args: { p_quiz_id: string }
        Returns: {
          author_id: string
          base_language: string
          cloned_from_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          school_id: string
          title: string | null
          video_id: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "quizzes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_student_to_class: {
        Args: { p_class_id: string; p_email: string }
        Returns: Json
      }
      assign_quiz_to_class: {
        Args: {
          p_class_id: string
          p_max_attempts?: number
          p_quiz_id: string
          p_tutor_mode?: string
        }
        Returns: Json
      }
      claim_translation_job: {
        Args: { p_language: string; p_quiz_id: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      class_stats: { Args: { p_class_id: string }; Returns: Json }
      clone_quiz: { Args: { p_source_quiz_id: string }; Returns: string }
      complete_attempt: { Args: { p_attempt_id: string }; Returns: Json }
      create_quiz_for_video: {
        Args: {
          p_base_language: string
          p_duration_seconds: number
          p_quiz_title: string
          p_video_title: string
          p_youtube_id: string
        }
        Returns: Json
      }
      current_school_id: { Args: never; Returns: string }
      deactivate_teacher: { Args: { p_teacher_id: string }; Returns: Json }
      gc_orphan_videos: {
        Args: { p_grace_minutes: number }
        Returns: {
          id: string
          youtube_video_id: string
        }[]
      }
      get_attempt_review: { Args: { p_attempt_id: string }; Returns: Json }
      get_quiz_for_student: {
        Args: { p_class_id: string; p_quiz_id: string }
        Returns: Json
      }
      get_tutor_mode: {
        Args: { p_class_id: string; p_quiz_id: string }
        Returns: Json
      }
      is_active_teacher: { Args: never; Returns: boolean }
      is_member_of_class: { Args: { cid: string }; Returns: boolean }
      is_teacher_of_class: { Args: { cid: string }; Returns: boolean }
      lifecycle_lock_key: { Args: { p_teacher_id: string }; Returns: number }
      list_assigned_for_student: { Args: never; Returns: Json }
      list_class_quizzes: { Args: { p_class_id: string }; Returns: Json }
      list_class_roster: { Args: { p_class_id: string }; Returns: Json }
      list_my_quizzes: {
        Args: never
        Returns: {
          base_language: string
          created_at: string
          question_count: number
          quiz_id: string
          title: string
          transcript_status: string
          video_id: string
          video_title: string
          visibility: string
          youtube_video_id: string
        }[]
      }
      list_orphan_auth_users: {
        Args: { p_older_than_minutes: number }
        Returns: {
          created_at: string
          id: string
        }[]
      }
      list_shared_quizzes: {
        Args: never
        Returns: {
          author_id: string
          author_name: string
          base_language: string
          created_at: string
          is_own: boolean
          question_count: number
          quiz_id: string
          title: string
          transcript_status: string
          video_id: string
          video_title: string
          visibility: string
          youtube_video_id: string
        }[]
      }
      purge_soft_deleted_quizzes: {
        Args: { p_retention_days: number }
        Returns: Json
      }
      question_stats: { Args: { p_quiz_id: string }; Returns: Json }
      quiz_stats: { Args: { p_quiz_id: string }; Returns: Json }
      reassign_ownership: {
        Args: { p_from_teacher: string; p_to_teacher: string }
        Returns: Json
      }
      release_translation_job: {
        Args: { p_language: string; p_quiz_id: string }
        Returns: undefined
      }
      remove_student_from_class: {
        Args: { p_class_id: string; p_student_id: string }
        Returns: undefined
      }
      revoke_invite: {
        Args: { p_class_id: string; p_email: string }
        Returns: undefined
      }
      soft_delete_option: { Args: { p_option_id: string }; Returns: undefined }
      soft_delete_question: {
        Args: { p_question_id: string }
        Returns: undefined
      }
      soft_delete_quiz: { Args: { p_quiz_id: string }; Returns: undefined }
      start_or_resume_attempt: {
        Args: { p_class_id: string; p_quiz_id: string }
        Returns: Json
      }
      submit_answer: {
        Args: {
          p_attempt_id: string
          p_option_ids: string[]
          p_question_id: string
        }
        Returns: Json
      }
      teacher_can_read_profile: { Args: { target: string }; Returns: boolean }
      tutor_stats: {
        Args: { p_class_id?: string; p_quiz_id?: string }
        Returns: Json
      }
      unassign_quiz: {
        Args: { p_class_id: string; p_quiz_id: string }
        Returns: undefined
      }
      update_quiz: {
        Args: {
          p_base_language?: string
          p_quiz_id: string
          p_title?: string
          p_visibility?: string
        }
        Returns: undefined
      }
      upsert_question: {
        Args: {
          p_base_explanation: string
          p_base_prompt: string
          p_kind: string
          p_options: Json
          p_order_index: number
          p_position_seconds: number
          p_question_id: string
          p_quiz_id: string
          p_source?: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

