'use client';

import { useCallback, useState } from 'react';

interface DropZoneProps {
  label: string;
  accept?: string;
  onFile: (file: File) => void;
  loading?: boolean;
  hint?: string;
}

export function DropZone({ label, accept = '.xlsx,.xlsb,.xls', onFile, loading, hint }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      onFile(file);
    },
    [onFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => document.getElementById(`input-${label}`)?.click()}
      className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer select-none ${
        dragging
          ? 'border-[#0c5cab] bg-[#0c5cab]/[0.06]'
          : 'border-[#e4e4e7] bg-[rgba(0,0,0,0.01)] hover:border-[#0c5cab]/40 hover:bg-[#0c5cab]/[0.03]'
      }`}
    >
      <input
        id={`input-${label}`}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />

      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#0c5cab] border-t-transparent rounded-full animate-spin" />
          <p className="text-[13px] text-[#0c5cab] font-medium">Procesando...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className={`w-10 h-10 rounded-[12px] flex items-center justify-center ${
            dragging ? 'bg-[#0c5cab]' : 'bg-[rgba(0,0,0,0.04)]'
          } transition-colors`}>
            <svg width="18" height="18" fill={dragging ? 'white' : '#71717a'} viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 1a.75.75 0 01.75.75v7.586l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V1.75A.75.75 0 0110 1zM3.5 14A1.5 1.5 0 002 15.5v1A1.5 1.5 0 003.5 18h13a1.5 1.5 0 001.5-1.5v-1A1.5 1.5 0 0016.5 14H3.5z" clipRule="evenodd"/>
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-medium text-[#09090b]">
              {fileName ?? 'Arrastrá el archivo o hacé clic para seleccionar'}
            </p>
            {fileName && <p className="text-[12px] text-[#0c5cab] mt-0.5 truncate max-w-xs mx-auto">{fileName}</p>}
            {hint && <p className="mt-1.5 text-[12px] text-[#71717a]">{hint}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
