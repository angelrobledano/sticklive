import { describe, expect, it } from 'vitest';
import {
  CompetitionDetailSkeleton,
  CompetitionsSkeleton,
  FeedSkeleton,
  MatchDetailSkeleton,
  PlayerDetailSkeleton,
  SearchSkeleton,
  Skeleton,
  SkeletonCard,
  SkeletonCircle,
  StandingsSkeleton,
  TeamDetailSkeleton,
} from './Skeleton';

describe('Skeleton components', () => {
  it('exports all specialized screen skeleton components', () => {
    expect(typeof Skeleton).toBe('function');
    expect(typeof SkeletonCircle).toBe('function');
    expect(typeof SkeletonCard).toBe('function');
    expect(typeof MatchDetailSkeleton).toBe('function');
    expect(typeof PlayerDetailSkeleton).toBe('function');
    expect(typeof TeamDetailSkeleton).toBe('function');
    expect(typeof CompetitionDetailSkeleton).toBe('function');
    expect(typeof CompetitionsSkeleton).toBe('function');
    expect(typeof StandingsSkeleton).toBe('function');
    expect(typeof SearchSkeleton).toBe('function');
    expect(typeof FeedSkeleton).toBe('function');
  });
});
