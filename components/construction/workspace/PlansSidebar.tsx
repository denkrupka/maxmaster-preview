import React, { useState, useRef } from 'react';
import {
  Search, Upload, ChevronRight, FileImage, FolderPlus,
  MoreVertical, Eye, Trash2, Copy, History, BarChart3,
  Sparkles, BookOpen, AlertTriangle, CheckCircle2, GripVertical,
  File, FileType2, Image, FileText, X, Download
} from 'lucide-react';
import type { FileStatus } from './WorkspaceTypes';

interface SidebarFile {
  id: string;
  name: string;
  originalFilename?: string;
  format: string;
  status: FileStatus;
  version: number;
  folderId?: string;
  hasAnalysis?: boolean;
  hasAi?: boolean;
  hasBoq?: boolean;
  fileUrl?: string;
  fileSize?: number;
  apsUrn?: string | null;
}

interface SidebarFolder {
  id: string;
  name: string;
  files: SidebarFile[];
  isExpanded: boolean;
}

interface PlansSidebarProps {
  folders: SidebarFolder[];
  activeFileId: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectFile: (fileId: string) => void;
  onImport: () => void;
  onCreateFolder: (name: string) => void;
  onFileAction: (fileId: string, action: string) => void;
  onToggleFolder: (folderId: string) => void;
  onDragDrop?: (fileId: string, targetId: string) => void;
}

const STATUS_BADGE: Record<FileStatus, { color: string; label: string }> = {
  uploaded: { color: 'bg-slate-400', label: 'Przeslany' },
  converting: { color: 'bg-amber-400 animate-pulse', label: 'Konwersja...' },
  converted: { color: 'bg-blue-400', label: 'Skonwertowany' },
  analysis_ready: { color: 'bg-indigo-400', label: 'Analiza gotowa' },
  ai_ready: { color: 'bg-purple-400', label: 'AI gotowe' },
  boq_ready: { color: 'bg-green-400', label: 'BOQ gotowy' },
  failed: { color: 'bg-red-400', label: 'Blad' },
};

const FORMAT_ICON: Record<string, React.ReactNode> = {
  dwg: <FileType2 className="w-4 h-4 text-blue-500" />,
  dxf: <FileType2 className="w-4 h-4 text-cyan-500" />,
  pdf: <FileText className="w-4 h-4 text-red-500" />,
  ifc: <File className="w-4 h-4 text-indigo-500" />,
  rvt: <File className="w-4 h-4 text-violet-500" />,
  image: <Image className="w-4 h-4 text-emerald-500" />,
  cad: <FileType2 className="w-4 h-4 text-orange-500" />,
  zip: <File className="w-4 h-4 text-amber-500" />,
  other: <File className="w-4 h-4 text-slate-400" />,
};

export const PlansSidebar: React.FC<PlansSidebarProps> = ({
  folders, activeFileId, searchQuery, onSearchChange,
  onSelectFile, onImport, onCreateFolder, onFileAction, onToggleFolder, onDragDrop,
}) => {
  const [contextMenu, setContextMenu] = useState<{ fileId: string; x: number; y: number } | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const filteredFolders = folders.map(f => ({
    ...f,
    files: f.files.filter(file =>
      !searchQuery ||
      file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (file.originalFilename || '').toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(f => f.files.length > 0 || !searchQuery);

  const handleContextMenu = (e: React.MouseEvent, fileId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ fileId, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200" onClick={() => setContextMenu(null)}>
      {/* Header */}
      <div className="p-3 border-b border-slate-200 space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pliki projektu</h3>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowNewFolder(true)}
              className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600" title="Nowy folder">
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Szukaj pliku..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Import button */}
        <button onClick={onImport}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition">
          <Upload className="w-3.5 h-3.5" /> Importuj plik
        </button>
      </div>

      {/* New folder input */}
      {showNewFolder && (
        <div className="px-3 py-2 border-b border-slate-200 bg-blue-50 flex items-center gap-2">
          <input
            type="text"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newFolderName.trim()) { onCreateFolder(newFolderName.trim()); setNewFolderName(''); setShowNewFolder(false); }
              if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
            }}
            placeholder="Nazwa folderu..."
            className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button onClick={() => { if (newFolderName.trim()) { onCreateFolder(newFolderName.trim()); setNewFolderName(''); setShowNewFolder(false); } }}
            className="text-xs text-blue-600 font-medium hover:text-blue-800">OK</button>
          <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
            className="text-xs text-slate-400 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {filteredFolders.length === 0 ? (
          <div className="text-center py-10 px-4">
            <FileImage className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-xs text-slate-400">Brak plikow. Kliknij "Importuj plik" aby dodac.</p>
          </div>
        ) : filteredFolders.map(folder => (
          <div key={folder.id}>
            {/* Folder header */}
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-slate-100 bg-slate-50 hover:bg-slate-100 transition"
              onClick={() => onToggleFolder(folder.id)}
            >
              <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${folder.isExpanded ? 'rotate-90' : ''}`} />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex-1 truncate">{folder.name}</span>
              <span className="text-[10px] text-slate-400">{folder.files.length}</span>
            </div>

            {/* Files */}
            {folder.isExpanded && folder.files.map(file => (
              <div
                key={file.id}
                draggable
                onDragStart={() => setDraggedId(file.id)}
                onDragOver={e => { e.preventDefault(); setDragOverId(file.id); }}
                onDragLeave={() => setDragOverId(null)}
                onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                onDrop={() => { if (draggedId && onDragDrop) onDragDrop(draggedId, file.id); }}
                onContextMenu={e => handleContextMenu(e, file.id)}
                className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-slate-50 transition-colors ${
                  activeFileId === file.id
                    ? 'bg-slate-800 text-white'
                    : dragOverId === file.id
                    ? 'bg-blue-50 border-l-4 border-l-blue-400'
                    : 'hover:bg-slate-50 bg-white'
                }`}
                onClick={() => onSelectFile(file.id)}
              >
                <GripVertical className={`w-3 h-3 cursor-grab flex-shrink-0 ${activeFileId === file.id ? 'opacity-40' : 'opacity-20'}`} />
                <div className="flex-shrink-0">{FORMAT_ICON[file.format] || <File className="w-4 h-4 text-slate-400" />}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${activeFileId === file.id ? 'text-white' : 'text-slate-800'}`}>{file.name}</p>
                  <p className={`text-[10px] truncate ${activeFileId === file.id ? 'text-slate-300' : 'text-slate-400'}`}>
                    {file.originalFilename || file.name}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Status badges */}
                  <div className={`w-2 h-2 rounded-full ${STATUS_BADGE[file.status]?.color || 'bg-slate-400'}`}
                    title={STATUS_BADGE[file.status]?.label} />
                  {file.hasAnalysis && <span title="Analiza"><BarChart3 className={`w-3 h-3 ${activeFileId === file.id ? 'text-blue-300' : 'text-blue-400'}`} /></span>}
                  {file.hasAi && <span title="AI"><Sparkles className={`w-3 h-3 ${activeFileId === file.id ? 'text-purple-300' : 'text-purple-400'}`} /></span>}
                  {file.hasBoq && <span title="BOQ"><BookOpen className={`w-3 h-3 ${activeFileId === file.id ? 'text-green-300' : 'text-green-400'}`} /></span>}
                  {file.version > 1 && (
                    <span className={`text-[9px] font-medium px-1 rounded ${activeFileId === file.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      v{file.version}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[98]" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-[99] w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-1"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {[
              { action: 'open', icon: Eye, label: 'Otworz' },
              { action: 'rename', icon: FileText, label: 'Zmien nazwe' },
              { action: 'duplicate', icon: Copy, label: 'Duplikuj' },
              { action: 'newVersion', icon: History, label: 'Nowa wersja' },
              { action: 'compare', icon: BarChart3, label: 'Porownaj z poprzednia' },
              { action: 'reanalyze', icon: Sparkles, label: 'Powtorz analize' },
              { action: 'exportMetadata', icon: Download, label: 'Eksportuj metadane' },
              { action: 'delete', icon: Trash2, label: 'Usun', danger: true },
            ].map(item => (
              <button
                key={item.action}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs ${
                  (item as any).danger ? 'text-red-500 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => { onFileAction(contextMenu.fileId, item.action); setContextMenu(null); }}
              >
                <item.icon className="w-3.5 h-3.5" /> {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default PlansSidebar;
