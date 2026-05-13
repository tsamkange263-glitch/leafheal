export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      app_config: {
        Row: {
          id: string;
          key: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          value: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          key?: string;
          value?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      archived_remedies: {
        Row: {
          created_at: string;
          id: string;
          notes: string | null;
          scan_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notes?: string | null;
          scan_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          notes?: string | null;
          scan_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'archived_remedies_scan_id_fkey';
            columns: ['scan_id'];
            isOneToOne: false;
            referencedRelation: 'scans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'archived_remedies_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      payments: {
        Row: {
          amount_usd: number;
          created_at: string;
          ecocash_number: string | null;
          id: string;
          payment_method: string | null;
          paynow_reference: string | null;
          scans_added: number;
          status: string;
          user_id: string;
        };
        Insert: {
          amount_usd: number;
          created_at?: string;
          ecocash_number?: string | null;
          id?: string;
          payment_method?: string | null;
          paynow_reference?: string | null;
          scans_added: number;
          status?: string;
          user_id: string;
        };
        Update: {
          amount_usd?: number;
          created_at?: string;
          ecocash_number?: string | null;
          id?: string;
          payment_method?: string | null;
          paynow_reference?: string | null;
          scans_added?: number;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      scans: {
        Row: {
          confidence: number | null;
          created_at: string;
          disease_results: Json | null;
          id: string;
          image_url: string | null;
          overview: string | null;
          plant_name: string | null;
          plant_health: Json | null;
          precautions: string | null;
          remedies: Json | null;
          scientific_name: string | null;
          user_id: string;
        };
        Insert: {
          confidence?: number | null;
          created_at?: string;
          disease_results?: Json | null;
          id?: string;
          image_url?: string | null;
          overview?: string | null;
          plant_name?: string | null;
          plant_health?: Json | null;
          precautions?: string | null;
          remedies?: Json | null;
          scientific_name?: string | null;
          user_id: string;
        };
        Update: {
          confidence?: number | null;
          created_at?: string;
          disease_results?: Json | null;
          id?: string;
          image_url?: string | null;
          overview?: string | null;
          plant_name?: string | null;
          plant_health?: Json | null;
          precautions?: string | null;
          remedies?: Json | null;
          scientific_name?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scans_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          country: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          phone: string | null;
          scan_credits: number;
        };
        Insert: {
          created_at?: string;
          country?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          scan_credits?: number;
        };
        Update: {
          created_at?: string;
          country?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          scan_credits?: number;
        };
        Relationships: [];
      };
      user_country_stats: {
        Row: {
          id: string;
          country: string;
          signed_up_count: number;
          paid_members_count: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          country: string;
          signed_up_count?: number;
          paid_members_count?: number;
          updated_at?: string;
        };
        Update: {
          id?: string;
          country?: string;
          signed_up_count?: number;
          paid_members_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      herbal_pdf_cache: {
        Row: {
          id: string;
          file_name: string;
          extracted_text: string;
          file_size: number | null;
          extracted_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          file_name: string;
          extracted_text: string;
          file_size?: number | null;
          extracted_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          file_name?: string;
          extracted_text?: string;
          file_size?: number | null;
          extracted_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pricing_config: {
        Row: {
          id: string;
          price_usd: number;
          scan_quantity: number;
          currency: string;
          is_active: boolean;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          price_usd?: number;
          scan_quantity?: number;
          currency?: string;
          is_active?: boolean;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          price_usd?: number;
          scan_quantity?: number;
          currency?: string;
          is_active?: boolean;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

export interface RemedyData {
  uses: string;
  preparation: string;
  dosage: string;
  benefits: string;
  traditional_uses?: string;
}

export interface PlantHealthData {
  is_healthy: boolean;
  condition_name: string;
  symptoms: string;
  cause: string;
  cause_category: 'fungal' | 'bacterial' | 'viral' | 'nutrient_deficiency' | 'pest_damage' | 'environmental_stress' | 'healthy' | 'unknown';
  severity: 'none' | 'mild' | 'moderate' | 'severe';
  treatments: {
    organic: string;
    chemical: string;
  };
  prevention_tips: string;
  general_care_tips?: string;
}

export interface ScanResult {
  plant_name: string;
  scientific_name: string;
  confidence: number;
  overview: string;
  remedies: RemedyData;
  precautions: string;
  plant_health: PlantHealthData;
}
