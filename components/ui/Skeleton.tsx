export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`animate-pulse bg-[#e4e4e7] rounded-lg ${className}`} style={style} />
  );
}

export function KpiSkeleton() {
  return (
    <div className="space-y-6">
      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e4e4e7]">
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
