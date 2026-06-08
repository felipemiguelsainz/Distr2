export function Loader({
  label = 'Cargando…',
  fullScreen = false,
}: {
  label?: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      className={
        fullScreen
          ? 'fixed inset-0 z-50 flex items-center justify-center bg-[#fafafa]'
          : 'flex items-center justify-center py-16'
      }
    >
      <div className="flex items-center gap-2.5 text-[13px] text-[#71717a]">
        <span className="w-5 h-5 rounded-full border-2 border-[#e4e4e7] border-t-[#0c5cab] animate-spin" />
        {label}
      </div>
    </div>
  );
}
