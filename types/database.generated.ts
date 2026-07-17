export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_emails: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      advice_guidance: {
        Row: {
          advice_id: number
          advice_points: Json | null
          created_at: string | null
          situation: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          advice_id?: number
          advice_points?: Json | null
          created_at?: string | null
          situation?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          advice_id?: number
          advice_points?: Json | null
          created_at?: string | null
          situation?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      app_options: {
        Row: {
          created_at: string
          id: number
          name: string | null
          options: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          name?: string | null
          options?: Json | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          name?: string | null
          options?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          congregation_id: number | null
          id: string
          metadata: Json
          occurred_at: string
          request_id: string | null
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          congregation_id?: number | null
          id?: string
          metadata?: Json
          occurred_at?: string
          request_id?: string | null
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          congregation_id?: number | null
          id?: string
          metadata?: Json
          occurred_at?: string
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      bible_reading_journeys: {
        Row: {
          created_at: string | null
          current_book: string | null
          current_chapter: number | null
          end_date: string | null
          journey_id: number
          last_read_date: string | null
          plan_name: string | null
          start_date: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_book?: string | null
          current_chapter?: number | null
          end_date?: string | null
          journey_id?: number
          last_read_date?: string | null
          plan_name?: string | null
          start_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_book?: string | null
          current_chapter?: number | null
          end_date?: string | null
          journey_id?: number
          last_read_date?: string | null
          plan_name?: string | null
          start_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bible_studies: {
        Row: {
          congregation_id: number | null
          created_at: string | null
          illustration: string | null
          illustration_image_url: string | null
          illustration_prompt: string | null
          is_published: boolean | null
          status: string | null
          study_id: number
          study_method: string | null
          subtitle: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          congregation_id?: number | null
          created_at?: string | null
          illustration?: string | null
          illustration_image_url?: string | null
          illustration_prompt?: string | null
          is_published?: boolean | null
          status?: string | null
          study_id?: number
          study_method?: string | null
          subtitle?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          congregation_id?: number | null
          created_at?: string | null
          illustration?: string | null
          illustration_image_url?: string | null
          illustration_prompt?: string | null
          is_published?: boolean | null
          status?: string | null
          study_id?: number
          study_method?: string | null
          subtitle?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bible_studies_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      bible_study_lessons: {
        Row: {
          application_sidebar: Json | null
          commentary: string | null
          conclusion: Json | null
          created_at: string | null
          discussion_starters: Json | null
          introduction: Json | null
          key_verse: string | null
          lesson_aims: Json | null
          lesson_id: number
          lesson_number: number
          reflection_questions: Json | null
          scripture: string | null
          study_id: number
          study_outline: Json | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          application_sidebar?: Json | null
          commentary?: string | null
          conclusion?: Json | null
          created_at?: string | null
          discussion_starters?: Json | null
          introduction?: Json | null
          key_verse?: string | null
          lesson_aims?: Json | null
          lesson_id?: number
          lesson_number: number
          reflection_questions?: Json | null
          scripture?: string | null
          study_id?: number
          study_outline?: Json | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          application_sidebar?: Json | null
          commentary?: string | null
          conclusion?: Json | null
          created_at?: string | null
          discussion_starters?: Json | null
          introduction?: Json | null
          key_verse?: string | null
          lesson_aims?: Json | null
          lesson_id?: number
          lesson_number?: number
          reflection_questions?: Json | null
          scripture?: string | null
          study_id?: number
          study_outline?: Json | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bible_study_lessons_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "bible_studies"
            referencedColumns: ["study_id"]
          },
        ]
      }
      campuses: {
        Row: {
          congregation_id: number
          created_at: string
          id: number
          name: string
        }
        Insert: {
          congregation_id: number
          created_at?: string
          id?: number
          name: string
        }
        Update: {
          congregation_id?: number
          created_at?: string
          id?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "campuses_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      capability_overrides: {
        Row: {
          allowed: boolean
          capability: Database["public"]["Enums"]["capability"]
          created_at: string
          id: number
          membership_id: number
        }
        Insert: {
          allowed: boolean
          capability: Database["public"]["Enums"]["capability"]
          created_at?: string
          id?: number
          membership_id: number
        }
        Update: {
          allowed?: boolean
          capability?: Database["public"]["Enums"]["capability"]
          created_at?: string
          id?: number
          membership_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "capability_overrides_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: number
          image_url: string | null
          name: string | null
          scriptural_breakdown: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          image_url?: string | null
          name?: string | null
          scriptural_breakdown?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          image_url?: string | null
          name?: string | null
          scriptural_breakdown?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      check_ins: {
        Row: {
          checked_in_at: string | null
          checked_in_by: string | null
          checked_out_at: string | null
          congregation_id: number | null
          event_id: string | null
          id: string
          profile_id: string | null
          secure_code: string
          status: string | null
        }
        Insert: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          congregation_id?: number | null
          event_id?: string | null
          id?: string
          profile_id?: string | null
          secure_code: string
          status?: string | null
        }
        Update: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          congregation_id?: number | null
          event_id?: string | null
          id?: string
          profile_id?: string | null
          secure_code?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "church_crm_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
          {
            foreignKeyName: "check_ins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "church_crm_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      church_crm_profiles: {
        Row: {
          congregation_id: number | null
          created_at: string | null
          email: string | null
          first_name: string
          household_id: string | null
          household_role: string | null
          id: string
          last_name: string | null
          medical_notes: string | null
          phone: string | null
          user_id: string | null
        }
        Insert: {
          congregation_id?: number | null
          created_at?: string | null
          email?: string | null
          first_name: string
          household_id?: string | null
          household_role?: string | null
          id?: string
          last_name?: string | null
          medical_notes?: string | null
          phone?: string | null
          user_id?: string | null
        }
        Update: {
          congregation_id?: number | null
          created_at?: string | null
          email?: string | null
          first_name?: string
          household_id?: string | null
          household_role?: string | null
          id?: string
          last_name?: string | null
          medical_notes?: string | null
          phone?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "church_crm_profiles_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
          {
            foreignKeyName: "church_crm_profiles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      community_prayer_interactions: {
        Row: {
          created_at: string | null
          id: string
          prayer_id: string | null
          praying_user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          prayer_id?: string | null
          praying_user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          prayer_id?: string | null
          praying_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_prayer_interactions_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "community_prayers"
            referencedColumns: ["id"]
          },
        ]
      }
      community_prayers: {
        Row: {
          anonymized_content: string | null
          created_at: string | null
          id: string
          original_content: string
          prayer_count: number | null
          status: string | null
          user_id: string
        }
        Insert: {
          anonymized_content?: string | null
          created_at?: string | null
          id?: string
          original_content: string
          prayer_count?: number | null
          status?: string | null
          user_id: string
        }
        Update: {
          anonymized_content?: string | null
          created_at?: string | null
          id?: string
          original_content?: string
          prayer_count?: number | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      congregation_members: {
        Row: {
          activity_score: number | null
          congregation_id: number
          join_date: string | null
          last_active_date: string | null
          member_id: number
          user_id: string | null
        }
        Insert: {
          activity_score?: number | null
          congregation_id: number
          join_date?: string | null
          last_active_date?: string | null
          member_id?: number
          user_id?: string | null
        }
        Update: {
          activity_score?: number | null
          congregation_id?: number
          join_date?: string | null
          last_active_date?: string | null
          member_id?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "congregation_members_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      congregations: {
        Row: {
          congregation_id: number
          created_at: string | null
          description: string | null
          invite_token: string | null
          leader_user_id: string
          name: string
          stripe_account_id: string | null
          stripe_charges_enabled: boolean | null
          stripe_details_submitted: boolean | null
          updated_at: string | null
          youtube_channel_id: string | null
        }
        Insert: {
          congregation_id?: number
          created_at?: string | null
          description?: string | null
          invite_token?: string | null
          leader_user_id: string
          name: string
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_details_submitted?: boolean | null
          updated_at?: string | null
          youtube_channel_id?: string | null
        }
        Update: {
          congregation_id?: number
          created_at?: string | null
          description?: string | null
          invite_token?: string | null
          leader_user_id?: string
          name?: string
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_details_submitted?: boolean | null
          updated_at?: string | null
          youtube_channel_id?: string | null
        }
        Relationships: []
      }
      contact: {
        Row: {
          created_at: string
          email: string | null
          id: number
          message: string | null
          name: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: number
          message?: string | null
          name?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: number
          message?: string | null
          name?: string | null
        }
        Relationships: []
      }
      content_feedback: {
        Row: {
          content_id: string
          content_type: string
          created_at: string
          id: string
          rating: number | null
          user_id: string
          what_didnt_work: string | null
          what_worked: string | null
        }
        Insert: {
          content_id: string
          content_type: string
          created_at?: string
          id?: string
          rating?: number | null
          user_id: string
          what_didnt_work?: string | null
          what_worked?: string | null
        }
        Update: {
          content_id?: string
          content_type?: string
          created_at?: string
          id?: string
          rating?: number | null
          user_id?: string
          what_didnt_work?: string | null
          what_worked?: string | null
        }
        Relationships: []
      }
      counseling_sessions: {
        Row: {
          client_name: string | null
          counselor_user_id: number
          created_at: string | null
          notes: string | null
          session_date: string | null
          session_id: number
          updated_at: string | null
        }
        Insert: {
          client_name?: string | null
          counselor_user_id: number
          created_at?: string | null
          notes?: string | null
          session_date?: string | null
          session_id?: number
          updated_at?: string | null
        }
        Update: {
          client_name?: string | null
          counselor_user_id?: number
          created_at?: string | null
          notes?: string | null
          session_date?: string | null
          session_id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      curated_tracks: {
        Row: {
          activities: string[] | null
          artist: string | null
          created_at: string | null
          focus_areas: string[] | null
          id: string
          improvement_areas: string[] | null
          is_active: boolean | null
          thumbnail_url: string | null
          title: string
          video_id: string
        }
        Insert: {
          activities?: string[] | null
          artist?: string | null
          created_at?: string | null
          focus_areas?: string[] | null
          id?: string
          improvement_areas?: string[] | null
          is_active?: boolean | null
          thumbnail_url?: string | null
          title: string
          video_id: string
        }
        Update: {
          activities?: string[] | null
          artist?: string | null
          created_at?: string | null
          focus_areas?: string[] | null
          id?: string
          improvement_areas?: string[] | null
          is_active?: boolean | null
          thumbnail_url?: string | null
          title?: string
          video_id?: string
        }
        Relationships: []
      }
      daily_devotionals: {
        Row: {
          content: string | null
          created_at: string | null
          devotional_id: number
          scripture: string | null
          short_form: Json | null
          song_channel: string | null
          song_thumbnail: string | null
          song_title: string | null
          song_url: string | null
          song_video_id: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          devotional_id?: number
          scripture?: string | null
          short_form?: Json | null
          song_channel?: string | null
          song_thumbnail?: string | null
          song_title?: string | null
          song_url?: string | null
          song_video_id?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          devotional_id?: number
          scripture?: string | null
          short_form?: Json | null
          song_channel?: string | null
          song_thumbnail?: string | null
          song_title?: string | null
          song_url?: string | null
          song_video_id?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      daily_news_synopses: {
        Row: {
          created_at: string
          id: number
          prayer: string | null
          scripture: string | null
          synopsis: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          prayer?: string | null
          scripture?: string | null
          synopsis?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          prayer?: string | null
          scripture?: string | null
          synopsis?: string | null
        }
        Relationships: []
      }
      daily_prayers: {
        Row: {
          created_at: string | null
          date: string
          generated_prayer: string | null
          prayer_id: number
          status: string | null
          updated_at: string | null
          user_id: string | null
          went_through_guided_prayer: boolean | null
        }
        Insert: {
          created_at?: string | null
          date: string
          generated_prayer?: string | null
          prayer_id?: number
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          went_through_guided_prayer?: boolean | null
        }
        Update: {
          created_at?: string | null
          date?: string
          generated_prayer?: string | null
          prayer_id?: number
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
          went_through_guided_prayer?: boolean | null
        }
        Relationships: []
      }
      devotional_themes: {
        Row: {
          is_used: boolean | null
          scripture_focus: string | null
          theme_title: string
          week_number: number
        }
        Insert: {
          is_used?: boolean | null
          scripture_focus?: string | null
          theme_title: string
          week_number: number
        }
        Update: {
          is_used?: boolean | null
          scripture_focus?: string | null
          theme_title?: string
          week_number?: number
        }
        Relationships: []
      }
      event_volunteers: {
        Row: {
          created_at: string | null
          event_id: string | null
          id: string
          notified_at: string | null
          role_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_id?: string | null
          id?: string
          notified_at?: string | null
          role_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_id?: string | null
          id?: string
          notified_at?: string | null
          role_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_volunteers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_volunteers_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "volunteer_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          congregation_id: number | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          end_time: string | null
          event_date: string
          event_type: string | null
          id: string
          is_public: boolean | null
          location: string | null
          manage_token: string | null
          organizer_id: string | null
          status: string | null
          title: string
        }
        Insert: {
          congregation_id?: number | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string | null
          event_date: string
          event_type?: string | null
          id?: string
          is_public?: boolean | null
          location?: string | null
          manage_token?: string | null
          organizer_id?: string | null
          status?: string | null
          title: string
        }
        Update: {
          congregation_id?: number | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string | null
          event_date?: string
          event_type?: string | null
          id?: string
          is_public?: boolean | null
          location?: string | null
          manage_token?: string | null
          organizer_id?: string | null
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string | null
          id: number
          item_id: string
          item_type: Database["public"]["Enums"]["content_type"]
          preview: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          item_id: string
          item_type: Database["public"]["Enums"]["content_type"]
          preview?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          item_id?: string
          item_type?: Database["public"]["Enums"]["content_type"]
          preview?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      friends: {
        Row: {
          created_at: string | null
          friend_user_id: number
          friendship_id: number
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          friend_user_id: number
          friendship_id?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          friend_user_id?: number
          friendship_id?: number
          user_id?: string | null
        }
        Relationships: []
      }
      general_devotionals: {
        Row: {
          content: string
          created_at: string
          date: string
          id: number
          prayer: string
          scripture_reference: string
          scripture_text: string
          short_form: Json | null
          title: string
          topics: string[] | null
        }
        Insert: {
          content: string
          created_at?: string
          date: string
          id?: never
          prayer: string
          scripture_reference: string
          scripture_text: string
          short_form?: Json | null
          title: string
          topics?: string[] | null
        }
        Update: {
          content?: string
          created_at?: string
          date?: string
          id?: never
          prayer?: string
          scripture_reference?: string
          scripture_text?: string
          short_form?: Json | null
          title?: string
          topics?: string[] | null
        }
        Relationships: []
      }
      guardian_relationships: {
        Row: {
          child_profile_id: string
          congregation_id: number
          created_at: string
          guardian_profile_id: string
          id: number
          pickup_authorized: boolean
          relationship: string
          verified_at: string | null
        }
        Insert: {
          child_profile_id: string
          congregation_id: number
          created_at?: string
          guardian_profile_id: string
          id?: number
          pickup_authorized?: boolean
          relationship: string
          verified_at?: string | null
        }
        Update: {
          child_profile_id?: string
          congregation_id?: number
          created_at?: string
          guardian_profile_id?: string
          id?: number
          pickup_authorized?: boolean
          relationship?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardian_relationships_child_profile_id_fkey"
            columns: ["child_profile_id"]
            isOneToOne: false
            referencedRelation: "church_crm_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_relationships_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
          {
            foreignKeyName: "guardian_relationships_guardian_profile_id_fkey"
            columns: ["guardian_profile_id"]
            isOneToOne: false
            referencedRelation: "church_crm_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          congregation_id: number | null
          created_at: string | null
          id: string
          name: string
          primary_phone: string | null
        }
        Insert: {
          congregation_id?: number | null
          created_at?: string | null
          id?: string
          name: string
          primary_phone?: string | null
        }
        Update: {
          congregation_id?: number | null
          created_at?: string | null
          id?: string
          name?: string
          primary_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "households_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      kiosk_sessions: {
        Row: {
          congregation_id: number
          created_at: string
          event_id: string | null
          expires_at: string
          id: string
          locked_at: string | null
          opened_by: string
        }
        Insert: {
          congregation_id: number
          created_at?: string
          event_id?: string | null
          expires_at: string
          id?: string
          locked_at?: string | null
          opened_by: string
        }
        Update: {
          congregation_id?: number
          created_at?: string
          event_id?: string | null
          expires_at?: string
          id?: string
          locked_at?: string | null
          opened_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_sessions_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
          {
            foreignKeyName: "kiosk_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_alerts: {
        Row: {
          active: boolean
          alert_type: string
          child_profile_id: string
          congregation_id: number
          created_at: string
          description: string
          id: number
        }
        Insert: {
          active?: boolean
          alert_type: string
          child_profile_id: string
          congregation_id: number
          created_at?: string
          description: string
          id?: number
        }
        Update: {
          active?: boolean
          alert_type?: string
          child_profile_id?: string
          congregation_id?: number
          created_at?: string
          description?: string
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "medical_alerts_child_profile_id_fkey"
            columns: ["child_profile_id"]
            isOneToOne: false
            referencedRelation: "church_crm_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_alerts_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          active: boolean
          campus_id: number | null
          congregation_id: number
          created_at: string
          id: number
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          campus_id?: number | null
          congregation_id: number
          created_at?: string
          id?: number
          role: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          campus_id?: number | null
          congregation_id?: number
          created_at?: string
          id?: number
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      outlook_categories: {
        Row: {
          category_id: number | null
          created_at: string
          id: number
          outlook_id: number | null
        }
        Insert: {
          category_id?: number | null
          created_at?: string
          id?: number
          outlook_id?: number | null
        }
        Update: {
          category_id?: number | null
          created_at?: string
          id?: number
          outlook_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outlook_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_categories_outlook_id_fkey"
            columns: ["outlook_id"]
            isOneToOne: false
            referencedRelation: "scriptural_outlooks"
            referencedColumns: ["id"]
          },
        ]
      }
      outlook_topics: {
        Row: {
          created_at: string
          id: number
          outlook_id: number | null
          topic_id: number | null
        }
        Insert: {
          created_at?: string
          id?: number
          outlook_id?: number | null
          topic_id?: number | null
        }
        Update: {
          created_at?: string
          id?: number
          outlook_id?: number | null
          topic_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outlook_topics_outlook_id_fkey"
            columns: ["outlook_id"]
            isOneToOne: false
            referencedRelation: "scriptural_outlooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      pastoral_messages: {
        Row: {
          congregation_id: number | null
          created_at: string | null
          is_published: boolean | null
          message_body: string | null
          message_id: number
          message_type: string | null
          thumbnail_url: string | null
          title: string | null
          video_asset_id: string | null
          video_playback_id: string | null
        }
        Insert: {
          congregation_id?: number | null
          created_at?: string | null
          is_published?: boolean | null
          message_body?: string | null
          message_id?: never
          message_type?: string | null
          thumbnail_url?: string | null
          title?: string | null
          video_asset_id?: string | null
          video_playback_id?: string | null
        }
        Update: {
          congregation_id?: number | null
          created_at?: string | null
          is_published?: boolean | null
          message_body?: string | null
          message_id?: never
          message_type?: string | null
          thumbnail_url?: string | null
          title?: string | null
          video_asset_id?: string | null
          video_playback_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pastoral_messages_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      pastoral_notes: {
        Row: {
          author_id: string | null
          created_at: string | null
          crm_profile_id: string | null
          id: string
          note_text: string
        }
        Insert: {
          author_id?: string | null
          created_at?: string | null
          crm_profile_id?: string | null
          id?: string
          note_text: string
        }
        Update: {
          author_id?: string | null
          created_at?: string | null
          crm_profile_id?: string | null
          id?: string
          note_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "pastoral_notes_crm_profile_id_fkey"
            columns: ["crm_profile_id"]
            isOneToOne: false
            referencedRelation: "church_crm_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_credentials: {
        Row: {
          check_in_id: string
          congregation_id: number
          credential_hash: string
          expires_at: string
          id: string
          override_reason: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          check_in_id: string
          congregation_id: number
          credential_hash: string
          expires_at: string
          id?: string
          override_reason?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          check_in_id?: string
          congregation_id?: number
          credential_hash?: string
          expires_at?: string
          id?: string
          override_reason?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_credentials_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: true
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_credentials_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      prayer_requests: {
        Row: {
          congregation_id: number | null
          created_at: string | null
          id: string
          request_text: string
          user_id: string | null
          visibility: string | null
        }
        Insert: {
          congregation_id?: number | null
          created_at?: string | null
          id?: string
          request_text: string
          user_id?: string | null
          visibility?: string | null
        }
        Update: {
          congregation_id?: number | null
          created_at?: string | null
          id?: string
          request_text?: string
          user_id?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prayer_requests_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      prompt_evaluations: {
        Row: {
          created_at: string | null
          generated_content: string
          id: number
          original_prompt: string
          prompt_critique: string | null
          prompt_grade: string | null
          prompt_key: string
          quality_critique: string | null
          quality_grade: string | null
          source_id: string
          source_table: string
          suggested_prompt_update: string | null
        }
        Insert: {
          created_at?: string | null
          generated_content: string
          id?: number
          original_prompt: string
          prompt_critique?: string | null
          prompt_grade?: string | null
          prompt_key: string
          quality_critique?: string | null
          quality_grade?: string | null
          source_id: string
          source_table: string
          suggested_prompt_update?: string | null
        }
        Update: {
          created_at?: string | null
          generated_content?: string
          id?: number
          original_prompt?: string
          prompt_critique?: string | null
          prompt_grade?: string | null
          prompt_key?: string
          quality_critique?: string | null
          quality_grade?: string | null
          source_id?: string
          source_table?: string
          suggested_prompt_update?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_evaluations_prompt_key_fkey"
            columns: ["prompt_key"]
            isOneToOne: false
            referencedRelation: "system_prompts"
            referencedColumns: ["key"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string | null
          id: number
          subscription: Json
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          subscription: Json
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          subscription?: Json
          user_id?: string
        }
        Relationships: []
      }
      recommended_videos: {
        Row: {
          channel_id: string | null
          channel_name: string | null
          created_at: string | null
          focus_areas: string[] | null
          id: string
          improvement_areas: string[] | null
          is_active: boolean | null
          thumbnail_url: string | null
          title: string
          transcript: string | null
          video_id: string
          video_url: string
          view_count: number | null
        }
        Insert: {
          channel_id?: string | null
          channel_name?: string | null
          created_at?: string | null
          focus_areas?: string[] | null
          id?: string
          improvement_areas?: string[] | null
          is_active?: boolean | null
          thumbnail_url?: string | null
          title: string
          transcript?: string | null
          video_id: string
          video_url: string
          view_count?: number | null
        }
        Update: {
          channel_id?: string | null
          channel_name?: string | null
          created_at?: string | null
          focus_areas?: string[] | null
          id?: string
          improvement_areas?: string[] | null
          is_active?: boolean | null
          thumbnail_url?: string | null
          title?: string
          transcript?: string | null
          video_id?: string
          video_url?: string
          view_count?: number | null
        }
        Relationships: []
      }
      role_capabilities: {
        Row: {
          capability: Database["public"]["Enums"]["capability"]
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          capability: Database["public"]["Enums"]["capability"]
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          capability?: Database["public"]["Enums"]["capability"]
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: []
      }
      role_members: {
        Row: {
          id: string
          joined_at: string | null
          role_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          id?: string
          joined_at?: string | null
          role_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string
          joined_at?: string | null
          role_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "volunteer_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      scriptural_outlooks: {
        Row: {
          ai_outlook: Json | null
          article_body: string | null
          article_thumbnail_url: string | null
          article_title: string | null
          article_url: string | null
          created_at: string
          id: number
          news_impact_score: number | null
          news_impact_summary: string | null
          publish_date: string | null
          slug: string | null
        }
        Insert: {
          ai_outlook?: Json | null
          article_body?: string | null
          article_thumbnail_url?: string | null
          article_title?: string | null
          article_url?: string | null
          created_at?: string
          id?: number
          news_impact_score?: number | null
          news_impact_summary?: string | null
          publish_date?: string | null
          slug?: string | null
        }
        Update: {
          ai_outlook?: Json | null
          article_body?: string | null
          article_thumbnail_url?: string | null
          article_title?: string | null
          article_url?: string | null
          created_at?: string
          id?: number
          news_impact_score?: number | null
          news_impact_summary?: string | null
          publish_date?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      sermon_preferences: {
        Row: {
          created_at: string
          id: number
          key: string | null
          name: string | null
          onboarding_choices: Json | null
          onboarding_subtitle: string | null
          onboarding_title: string | null
          onboarding_type: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          key?: string | null
          name?: string | null
          onboarding_choices?: Json | null
          onboarding_subtitle?: string | null
          onboarding_title?: string | null
          onboarding_type?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          key?: string | null
          name?: string | null
          onboarding_choices?: Json | null
          onboarding_subtitle?: string | null
          onboarding_title?: string | null
          onboarding_type?: string | null
        }
        Relationships: []
      }
      sermon_series: {
        Row: {
          created_at: string | null
          description: string | null
          end_date: string | null
          series_format: string
          series_id: number
          series_name: string | null
          start_date: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          series_format?: string
          series_id?: number
          series_name?: string | null
          start_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          series_format?: string
          series_id?: number
          series_name?: string | null
          start_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      sermons: {
        Row: {
          actual_duration_min: number | null
          content_format: string
          created_at: string | null
          date_preached: string | null
          distribution_channel: string
          illustration: string | null
          illustration_image_url: string | null
          illustration_prompt: string | null
          key_takeaways: Json | null
          scripture: string | null
          series_id: number | null
          sermon_body: string | null
          sermon_id: number
          sermon_outline: Json | null
          status: string | null
          tags: string[] | null
          target_duration_min: number | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          actual_duration_min?: number | null
          content_format?: string
          created_at?: string | null
          date_preached?: string | null
          distribution_channel?: string
          illustration?: string | null
          illustration_image_url?: string | null
          illustration_prompt?: string | null
          key_takeaways?: Json | null
          scripture?: string | null
          series_id?: number | null
          sermon_body?: string | null
          sermon_id?: number
          sermon_outline?: Json | null
          status?: string | null
          tags?: string[] | null
          target_duration_min?: number | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          actual_duration_min?: number | null
          content_format?: string
          created_at?: string | null
          date_preached?: string | null
          distribution_channel?: string
          illustration?: string | null
          illustration_image_url?: string | null
          illustration_prompt?: string | null
          key_takeaways?: Json | null
          scripture?: string | null
          series_id?: number | null
          sermon_body?: string | null
          sermon_id?: number
          sermon_outline?: Json | null
          status?: string | null
          tags?: string[] | null
          target_duration_min?: number | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sermons_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "sermon_series"
            referencedColumns: ["series_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string
          ended_at: string | null
          id: string
          price_id: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          ended_at?: string | null
          id: string
          price_id?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          ended_at?: string | null
          id?: string
          price_id?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          action: string | null
          created_at: string | null
          details: Json | null
          duration_ms: number | null
          id: number
          is_local: boolean | null
          level: string
          message: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          id?: number
          is_local?: boolean | null
          level: string
          message?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          details?: Json | null
          duration_ms?: number | null
          id?: number
          is_local?: boolean | null
          level?: string
          message?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      system_prompts: {
        Row: {
          content: string
          description: string | null
          key: string
          updated_at: string | null
        }
        Insert: {
          content: string
          description?: string | null
          key: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          description?: string | null
          key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      topics: {
        Row: {
          created_at: string
          description: string | null
          id: number
          image_url: string | null
          name: string | null
          scriptural_breakdown: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          image_url?: string | null
          name?: string | null
          scriptural_breakdown?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          image_url?: string | null
          name?: string | null
          scriptural_breakdown?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_activities: {
        Row: {
          activity_date: string
          activity_id: string | null
          activity_type: string
          created_at: string
          description: string | null
          id: number
          user_id: string | null
        }
        Insert: {
          activity_date: string
          activity_id?: string | null
          activity_type: string
          created_at?: string
          description?: string | null
          id?: number
          user_id?: string | null
        }
        Update: {
          activity_date?: string
          activity_id?: string | null
          activity_type?: string
          created_at?: string
          description?: string | null
          id?: number
          user_id?: string | null
        }
        Relationships: []
      }
      user_followed_categories: {
        Row: {
          category_id: string
          user_id: string
        }
        Insert: {
          category_id: string
          user_id: string
        }
        Update: {
          category_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_followed_topics: {
        Row: {
          topic_id: string
          user_id: string
        }
        Insert: {
          topic_id: string
          user_id: string
        }
        Update: {
          topic_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          advice_reset_date: string | null
          advice_usage_count: number | null
          ai_tuning_notes: string | null
          avatar_url: string | null
          community_requests_count: number | null
          community_requests_reset_date: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          expo_push_token: string | null
          first_name: string | null
          last_name: string | null
          role: string | null
          sermon_preferences: Json | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_tier: string
          tier: string | null
          updated_at: string | null
          user_id: string
          user_preferences: Json | null
        }
        Insert: {
          advice_reset_date?: string | null
          advice_usage_count?: number | null
          ai_tuning_notes?: string | null
          avatar_url?: string | null
          community_requests_count?: number | null
          community_requests_reset_date?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          expo_push_token?: string | null
          first_name?: string | null
          last_name?: string | null
          role?: string | null
          sermon_preferences?: Json | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: string
          tier?: string | null
          updated_at?: string | null
          user_id: string
          user_preferences?: Json | null
        }
        Update: {
          advice_reset_date?: string | null
          advice_usage_count?: number | null
          ai_tuning_notes?: string | null
          avatar_url?: string | null
          community_requests_count?: number | null
          community_requests_reset_date?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          expo_push_token?: string | null
          first_name?: string | null
          last_name?: string | null
          role?: string | null
          sermon_preferences?: Json | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: string
          tier?: string | null
          updated_at?: string | null
          user_id?: string
          user_preferences?: Json | null
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          password: string
          role: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          password: string
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          password?: string
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      volunteer_roles: {
        Row: {
          color_code: string | null
          congregation_id: number | null
          description: string | null
          id: string
          join_policy: string | null
          name: string
        }
        Insert: {
          color_code?: string | null
          congregation_id?: number | null
          description?: string | null
          id?: string
          join_policy?: string | null
          name: string
        }
        Update: {
          color_code?: string | null
          congregation_id?: number | null
          description?: string | null
          id?: string
          join_policy?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_roles_congregation_id_fkey"
            columns: ["congregation_id"]
            isOneToOne: false
            referencedRelation: "congregations"
            referencedColumns: ["congregation_id"]
          },
        ]
      }
      whitelist: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      youtube_channels: {
        Row: {
          channel_id: string
          channel_name: string
          created_at: string | null
          handle: string | null
          id: string
          is_active: boolean | null
          subscriber_count: number | null
          video_count: number | null
          view_count: number | null
        }
        Insert: {
          channel_id: string
          channel_name: string
          created_at?: string | null
          handle?: string | null
          id?: string
          is_active?: boolean | null
          subscriber_count?: number | null
          video_count?: number | null
          view_count?: number | null
        }
        Update: {
          channel_id?: string
          channel_name?: string
          created_at?: string | null
          handle?: string | null
          id?: string
          is_active?: boolean | null
          subscriber_count?: number | null
          video_count?: number | null
          view_count?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_congregation_capability: {
        Args: {
          requested_campus_id?: number
          requested_capability: string
          requested_congregation_id: number
          requested_user_id?: string
        }
        Returns: boolean
      }
    }
    Enums: {
      capability:
        | "people.read"
        | "people.write"
        | "care.read"
        | "care.confidential"
        | "care.write"
        | "finance.read"
        | "finance.write"
        | "check_in.read"
        | "check_in.write"
        | "check_in.override"
        | "events.read"
        | "events.write"
        | "volunteers.read"
        | "volunteers.write"
        | "communications.read"
        | "communications.write"
        | "content.read"
        | "content.write"
        | "staff.manage"
        | "audit.read"
        | "organization.export"
      church_role:
        | "Dont Attend"
        | "Layperson"
        | "Hold Church Office"
        | "Committee Leader"
        | "Minister"
        | "Pastor"
      content_type: "devotional" | "prayer" | "advice" | "news"
      staff_role:
        | "lead_pastor"
        | "care"
        | "ministry"
        | "finance"
        | "check_in"
        | "content"
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
  public: {
    Enums: {
      capability: [
        "people.read",
        "people.write",
        "care.read",
        "care.confidential",
        "care.write",
        "finance.read",
        "finance.write",
        "check_in.read",
        "check_in.write",
        "check_in.override",
        "events.read",
        "events.write",
        "volunteers.read",
        "volunteers.write",
        "communications.read",
        "communications.write",
        "content.read",
        "content.write",
        "staff.manage",
        "audit.read",
        "organization.export",
      ],
      church_role: [
        "Dont Attend",
        "Layperson",
        "Hold Church Office",
        "Committee Leader",
        "Minister",
        "Pastor",
      ],
      content_type: ["devotional", "prayer", "advice", "news"],
      staff_role: [
        "lead_pastor",
        "care",
        "ministry",
        "finance",
        "check_in",
        "content",
      ],
    },
  },
} as const
