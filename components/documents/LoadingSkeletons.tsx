import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div className={`animate-pulse bg-slate-200 rounded ${className}`} />
);

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export const SkeletonText: React.FC<SkeletonTextProps> = ({ lines = 3, className = '' }) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton 
        key={i} 
        className={`h-4 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`} 
      />
    ))}
  </div>
);

interface SkeletonCardProps {
  className?: string;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({ className = '' }) => (
  <div className={`bg-white rounded-xl border border-slate-200 p-4 ${className}`}>
    <Skeleton className="h-6 w-1/3 mb-4" />
    <SkeletonText lines={3} />
  </div>
);

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export const SkeletonTable: React.FC<SkeletonTableProps> = ({ 
  rows = 5, 
  columns = 4,
  className = '' 
}) => (
  <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${className}`}>
    {/* Header */}
    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
    </div>
    {/* Rows */}
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="px-4 py-4 flex gap-4 items-center">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton 
              key={colIdx} 
              className={`h-4 ${colIdx === 0 ? 'w-1/4' : colIdx === columns - 1 ? 'w-20' : 'flex-1'}`} 
            />
          ))}
        </div>
      ))}
    </div>
  </div>
);

interface SkeletonListProps {
  items?: number;
  className?: string;
}

export const SkeletonList: React.FC<SkeletonListProps> = ({ items = 5, className = '' }) => (
  <div className={`space-y-3 ${className}`}>
    {Array.from({ length: items }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-1/3 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="w-16 h-8" />
      </div>
    ))}
  </div>
);

interface SkeletonWizardProps {
  steps?: number;
  className?: string;
}

export const SkeletonWizard: React.FC<SkeletonWizardProps> = ({ steps = 3, className = '' }) => (
  <div className={`bg-white rounded-xl border border-slate-200 p-6 ${className}`}>
    {/* Progress */}
    <div className="flex gap-2 mb-8">
      {Array.from({ length: steps }).map((_, i) => (
        <Skeleton key={i} className="h-2 flex-1 rounded-full" />
      ))}
    </div>
    {/* Content */}
    <SkeletonText lines={4} className="mb-6" />
    <div className="grid grid-cols-2 gap-4 mb-6">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
    <SkeletonText lines={2} />
    {/* Footer */}
    <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-slate-200">
      <Skeleton className="h-10 w-24" />
      <Skeleton className="h-10 w-32" />
    </div>
  </div>
);

interface SkeletonStatsProps {
  cards?: number;
  className?: string;
}

export const SkeletonStats: React.FC<SkeletonStatsProps> = ({ cards = 6, className = '' }) => (
  <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 ${className}`}>
    {Array.from({ length: cards }).map((_, i) => (
      <div key={i} className="bg-slate-50 rounded-lg p-4">
        <Skeleton className="h-8 w-16 mb-2" />
        <Skeleton className="h-3 w-20" />
      </div>
    ))}
  </div>
);

export default {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonTable,
  SkeletonList,
  SkeletonWizard,
  SkeletonStats,
};
