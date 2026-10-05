import React, { useRef, useState, DragEvent } from 'react';
import { UploadCloud, FolderUp, FileUp, Sparkles } from 'lucide-react';

interface DropzoneProps {
  onFilesSelected: (files: Array<{ file: File; relativePath: string }>, isFolder: boolean, rootName: string) => void;
  disabled?: boolean;
}

export const Dropzone: React.FC<DropzoneProps> = ({ onFilesSelected, disabled = false }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (disabled) return;

    const dt = e.dataTransfer;
    if (!dt) return;

    const filesArray: Array<{ file: File; relativePath: string }> = [];

    // Check if webkitGetAsEntry is supported for dropping folders
    if (dt.items && dt.items.length > 0 && typeof dt.items[0].webkitGetAsEntry === 'function') {
      const entries: any[] = [];
      for (let i = 0; i < dt.items.length; i++) {
        const entry = dt.items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }

      let isDirectoryTransfer = false;
      let rootDirectoryName = '';

      const traverseFileTree = async (item: any, path = ''): Promise<void> => {
        if (item.isFile) {
          const file: File = await new Promise((resolve) => item.file(resolve));
          filesArray.push({
            file,
            relativePath: path ? `${path}/${file.name}` : file.name,
          });
        } else if (item.isDirectory) {
          isDirectoryTransfer = true;
          if (!rootDirectoryName) rootDirectoryName = item.name;
          const dirReader = item.createReader();
          const readEntries = async (): Promise<any[]> => {
            return new Promise((resolve) => {
              dirReader.readEntries((entries: any[]) => resolve(entries));
            });
          };

          let entries: any[];
          do {
            entries = await readEntries();
            for (const subItem of entries) {
              await traverseFileTree(subItem, path ? `${path}/${item.name}` : item.name);
            }
          } while (entries.length > 0);
        }
      };

      for (const entry of entries) {
        await traverseFileTree(entry);
      }

      if (filesArray.length > 0) {
        const rootName = isDirectoryTransfer
          ? rootDirectoryName || 'Folder'
          : filesArray.length === 1
          ? filesArray[0].file.name
          : `${filesArray.length} Files`;
        onFilesSelected(filesArray, isDirectoryTransfer, rootName);
        return;
      }
    }

    // Standard fallback files drop
    if (dt.files && dt.files.length > 0) {
      for (let i = 0; i < dt.files.length; i++) {
        const file = dt.files[i];
        filesArray.push({ file, relativePath: file.name });
      }
      const rootName = filesArray.length === 1 ? filesArray[0].file.name : `${filesArray.length} Files`;
      onFilesSelected(filesArray, false, rootName);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const selected: Array<{ file: File; relativePath: string }> = [];
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      selected.push({ file, relativePath: file.name });
    }
    const rootName = selected.length === 1 ? selected[0].file.name : `${selected.length} Files`;
    onFilesSelected(selected, false, rootName);
    e.target.value = '';
  };

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const selected: Array<{ file: File; relativePath: string }> = [];
    let rootName = 'Folder';

    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      const relPath = file.webkitRelativePath || file.name;
      selected.push({ file, relativePath: relPath });
      if (file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/');
        if (parts.length > 0) rootName = parts[0];
      }
    }

    onFilesSelected(selected, true, rootName);
    e.target.value = '';
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative rounded-2xl border-2 border-dashed transition-all duration-200 p-8 sm:p-12 text-center flex flex-col items-center justify-center ${
        isDragOver
          ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-950/40 scale-[1.01]'
          : 'border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50 hover:border-slate-400 dark:hover:border-slate-600'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      {/* Hidden inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderInputChange}
        // @ts-ignore
        webkitdirectory=""
        directory=""
        className="hidden"
      />

      {/* Visual illustration */}
      <div className="w-16 h-16 rounded-2xl bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 flex items-center justify-center mb-4 shadow-inner">
        <UploadCloud className="w-8 h-8 animate-bounce" />
      </div>

      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
        {isDragOver ? 'Drop files to send' : 'Send Files or Folders'}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
        Drag and drop anything here, or choose directly from your device storage
      </p>

      {/* Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-medium text-sm shadow-md shadow-brand-500/20 transition-all"
        >
          <FileUp className="w-4 h-4" />
          <span>Send Files</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => folderInputRef.current?.click()}
          className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-medium text-sm border border-slate-200 dark:border-slate-700 transition-all"
        >
          <FolderUp className="w-4 h-4" />
          <span>Send Folder</span>
        </button>
      </div>

      <div className="mt-4 flex items-center text-xs text-slate-400 dark:text-slate-500">
        <Sparkles className="w-3.5 h-3.5 mr-1 text-brand-500" />
        High-speed chunked LAN streaming with SHA-256 integrity
      </div>
    </div>
  );
};
