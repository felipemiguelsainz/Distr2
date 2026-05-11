export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-[#1a2d4a] rounded-lg ${className}`} />
  );
}

export function KpiSkeleton() {
  return (
    <div className="space-y-6">
      <div className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1a2d4a]">
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="p-4 space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 items-center py-1">
              <Skeleton className="h-3 w-20 shrink-0" />
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="h-3 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
