import questionsData from './iterate-questions.json';

export type Tier =
  | 'season_leaders'
  | 'season_aggregates'
  | 'career_totals'
  | 'team_seasons'
  | 'awards'
  | 'draft'
  | 'games'
  | 'playoffs'
  | 'shot_charts'
  | 'identity'
  | 'clarification'
  | 'championships'
  | 'database_coverage';

export type ExpectedKind =
  | 'entity_exact'
  | 'numeric_exact'
  | 'numeric_with_tolerance'
  | 'entity_with_value'
  | 'comparison'
  | 'set_exact'
  | 'clarification_required'
  | 'not_available'
  | 'negative_identity_exact';

export interface ExpectedAnswer {
  canonical: string | number | string[];
  entity?: string | null;
  value?: string | number | null;
  unit?: string | null;
  aliases?: string[];
  acceptedAnswers?: (string | number)[];
  disallowedAnswers?: string[];
}

export interface ValidationConfig {
  mode:
    | 'exact_normalized'
    | 'numeric_exact'
    | 'numeric_tolerance'
    | 'contains_all'
    | 'set_match'
    | 'semantic_clarification'
    | 'not_available_policy';
  caseInsensitive?: boolean;
  normalizeDiacritics?: boolean;
  stripPunctuation?: boolean;
  tolerance?: number | null;
  precision?: number | null;
  requiresUnits?: boolean;
  mustMentionEntity?: boolean;
  mustMentionValue?: boolean;
  clarificationCriteria?: string[];
}

export interface SourceMetadata {
  name: string;
  url?: string;
  table?: string;
  sourceStatKey?: string;
  retrievedAt?: string;
}

export interface QuestionMetadata {
  status: 'verified' | 'needs_source' | 'ambiguous' | 'database_coverage_test' | 'deprecated';
  difficulty?: 'easy' | 'medium' | 'hard';
  source: SourceMetadata;
  season?: string | null;
  asOfDate?: string | null;
  asOfSeason?: string | null;
  statCategory?: string | null;
  scope:
    | 'regular_season'
    | 'playoffs'
    | 'career_regular_season'
    | 'career_playoffs'
    | 'draft'
    | 'awards'
    | 'database';
  notes?: string;
  tags?: string[];
}

export interface Question {
  id: string;
  q: string;
  tier: Tier;
  expectedKind: ExpectedKind;
  expected: ExpectedAnswer;
  validation: ValidationConfig;
  metadata: QuestionMetadata;
}

export const QUESTIONS: Question[] = questionsData as Question[];
