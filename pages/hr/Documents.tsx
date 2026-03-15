import React, { useState, useRef, useMemo } from 'react';
import { Upload, X, Archive, Search, Eye, CheckCircle, XCircle, AlertTriangle, FileText, FileSignature, LayoutTemplate, Code, Shield } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { Button } from '../../components/Button';
import { VerificationType, SkillStatus, UserSkill } from '../../types';
import { SKILL_STATUS_LABELS, BONUS_DOCUMENT_TYPES } from '../../constants';
import { DocumentViewerModal } from '../../components/DocumentViewerModal';
import { uploadDocument } from '../../lib/supabase';
import { BulkSigningToolbar, DocumentCheckbox, HRTemplatesManager, HRTemplate, ApiSettingsManager, IdentityVerification, VerificationHistory } from '../../components/documents';
import { t, Language, detectLanguageFromContent } from '../../lib/i18n';
import { LanguageSelector } from '../../components/LanguageSelector';

export const HRDocumentsPage = () => {
    const { state, updateUserSkillStatus, updateCandidateDocumentDetails, archiveCandidateDocument, setLanguage } = useAppContext();
    const { currentCompany, language } = state;

    // Filter users by company_id for multi-tenant isolation
    const companyUserIds = useMemo(() => {
        return new Set(state.users.filter(u => u.company_id === currentCompany?.id).map(u => u.id));
    }, [state.users, currentCompany]);
    
    // Status Popover State
    const [statusPopoverDocId, setStatusPopoverDocId] = useState<string | null>(null);

    // Modal State
    const [isDocModalOpen, setIsDocModalOpen] = useState(false);
    const [editingDocId, setEditingDocId] = useState<string | null>(null);
    const [newDocData, setNewDocData] = useState({ 
        customName: '', 
        issue_date: new Date().toISOString().split('T')[0], 
        expires_at: '', 
        indefinite: false,
        files: [] as File[]
    });

    // File Viewer
    const [fileViewer, setFileViewer] = useState<{isOpen: boolean, urls: string[], title: string, index: number}>({ isOpen: false, urls: [], title: '', index: 0 });

    // Bulk Signing State
    const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
    const [isBulkSigning, setIsBulkSigning] = useState(false);
    const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | undefined>();

    const fileInputRef = useRef<HTMLInputElement>(null);

    // 1. FILTERING: Only show PENDING documents for company users
    const pendingDocs = state.userSkills.filter(us => {
        // Filter by company users
        if (!companyUserIds.has(us.user_id)) return false;

        const skill = state.skills.find(s => s.id === us.skill_id);
        // Robust identification of what is a document record
        const isDoc = (skill?.verification_type === VerificationType.DOCUMENT) ||
                      (us.skill_id && typeof us.skill_id === 'string' && us.skill_id.startsWith('doc_')) ||
                      !!us.custom_type ||
                      !us.skill_id;

        return isDoc && us.status === SkillStatus.PENDING && !us.is_archived;
    });

    // --- Bulk Signing Actions ---

    const handleSelectAll = () => {
        const allIds = pendingDocs.map(doc => doc.id);
        setSelectedDocs(new Set(allIds));
    };

    const handleDeselectAll = () => {
        setSelectedDocs(new Set());
    };

    const handleToggleDoc = (docId: string) => {
        setSelectedDocs(prev => {
            const newSet = new Set(prev);
            if (newSet.has(docId)) {
                newSet.delete(docId);
            } else {
                newSet.add(docId);
            }
            return newSet;
        });
    };

    const handleBulkSign = async () => {
        if (selectedDocs.size === 0) return;
        
        setIsBulkSigning(true);
        const docIds = Array.from(selectedDocs);
        const total = docIds.length;
        
        for (let i = 0; i < docIds.length; i++) {
            setBulkProgress({ current: i + 1, total });
            await updateUserSkillStatus(docIds[i], SkillStatus.CONFIRMED);
            // Small delay for visual feedback
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        setSelectedDocs(new Set());
        setIsBulkSigning(false);
        setBulkProgress(undefined);
    };

    // --- Actions ---

    const handleDocStatusChange = (docId: string, newStatus: SkillStatus) => {
        updateUserSkillStatus(docId, newStatus);
        setStatusPopoverDocId(null);
    };

    const handleEditDocument = (docId: string) => {
        const doc = state.userSkills.find(us => us.id === docId);
        if(!doc) return;
        
        setEditingDocId(docId);
        setNewDocData({
            customName: doc.custom_name || doc.document_url || '',
            issue_date: doc.issue_date || new Date().toISOString().split('T')[0],
            expires_at: doc.expires_at || '',
            indefinite: doc.is_indefinite || false,
            files: [] // Can't easily repopulate File objects from URLs in this simulation
        });
        setIsDocModalOpen(true);
    };

    const handleSaveDocument = async () => {
        if (!editingDocId || !newDocData.customName) return;
        
        const doc = state.userSkills.find(us => us.id === editingDocId);
        const userId = doc?.user_id;
        if (!userId) return;

        const docPayload: any = {
            custom_name: newDocData.customName,
            issue_date: newDocData.issue_date,
            expires_at: newDocData.indefinite ? undefined : newDocData.expires_at,
            is_indefinite: newDocData.indefinite,
        };

        if (newDocData.files.length > 0) {
             const uploadedUrls: string[] = [];
             for (const file of newDocData.files) {
                 const url = await uploadDocument(file, userId);
                 if (url) uploadedUrls.push(url);
             }
             if (uploadedUrls.length > 0) {
                 docPayload.document_urls = uploadedUrls;
                 docPayload.document_url = uploadedUrls[0];
             }
        }

        try {
            await updateCandidateDocumentDetails(editingDocId, docPayload);
            setIsDocModalOpen(false);
        } catch (error) {
            console.error("Error updating document:", error);
            alert("Błąd podczas aktualizacji dokumentu.");
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(e.target.files || []);
        if (selectedFiles.length > 0) {
            setNewDocData(prev => ({ ...prev, files: [...prev.files, ...selectedFiles] }));
        }
    };

    const removeFile = (index: number) => {
        setNewDocData(prev => ({ ...prev, files: prev.files.filter((_, i) => i !== index) }));
    };

    const openFileViewer = (doc: UserSkill) => {
        // Robust URL detection
        let urls: string[] = [];
        if (Array.isArray(doc.document_urls) && doc.document_urls.length > 0) {
            urls = doc.document_urls;
        } else if (doc.document_url) {
            urls = [doc.document_url];
        }
        
        setFileViewer({ isOpen: true, urls, title: doc.custom_name || 'Dokument', index: 0 });
    };

    // --- Render Modal ---
    const renderDocumentModal = () => {
        if (!isDocModalOpen) return null;
        return (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
                <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-slate-900">Edytuj Dokument</h2>
                        <button onClick={() => setIsDocModalOpen(false)}><X size={24} className="text-slate-400 hover:text-slate-600"/></button>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Nazwa Dokumentu</label>
                            <input 
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={newDocData.customName}
                                onChange={e => setNewDocData({...newDocData, customName: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Załącz Pliki (Dodaj)</label>
                            <div className="flex items-center gap-3">
                                <input 
                                    type="file" 
                                    ref={fileInputRef}
                                    className="hidden"
                                    multiple
                                    onChange={handleFileSelect}
                                />
                                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                                    <Upload size={16} className="mr-2"/> Wybierz pliki
                                </Button>
                            </div>
                            
                            <div className="space-y-1 mt-2 max-h-32 overflow-y-auto">
                                {newDocData.files.map((file, index) => (
                                    <div key={index} className="flex justify-between items-center bg-slate-50 p-2 rounded text-xs border border-slate-100">
                                        <span className="truncate max-w-[200px]">{file.name}</span>
                                        <button onClick={() => removeFile(index)} className="text-red-500 hover:text-red-700"><X size={14}/></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Data Wydania</label>
                            <input 
                                type="date"
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={newDocData.issue_date}
                                onChange={e => setNewDocData({...newDocData, issue_date: e.target.value})}
                            />
                        </div>
                        <div className="flex items-center gap-2 mb-2 p-2 bg-slate-50 rounded">
                            <input 
                                type="checkbox" 
                                id="indefinite"
                                checked={newDocData.indefinite}
                                onChange={e => setNewDocData({...newDocData, indefinite: e.target.checked})}
                                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                            />
                            <label htmlFor="indefinite" className="text-sm text-slate-700 cursor-pointer font-medium">Dokument bezterminowy</label>
                        </div>
                        {!newDocData.indefinite && (
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Data Ważności</label>
                                <input 
                                    type="date"
                                    className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                    value={newDocData.expires_at}
                                    onChange={e => setNewDocData({...newDocData, expires_at: e.target.value})}
                                />
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                        <Button variant="ghost" onClick={() => setIsDocModalOpen(false)}>Anuluj</Button>
                        <Button onClick={handleSaveDocument} disabled={!newDocData.customName}>Zapisz</Button>
                    </div>
                </div>
            </div>
        );
    };

    // Detect language from document content
    const detectDocLanguage = (doc: UserSkill): Language => {
        const content = doc.custom_name || '';
        return detectLanguageFromContent(content);
    };

    // Tabs state
    const [activeTab, setActiveTab] = useState<'documents' | 'templates' | 'api' | 'verification'>('documents');

    // Handle template send for signing
    const handleTemplateSend = (template: HRTemplate, filledData: Record<string, any>) => {
        // Create a document from template
        const documentContent = template.content;
        // Replace all fields with filled data
        let finalContent = documentContent;
        template.fields.forEach(field => {
            const value = filledData[field.name] || field.defaultValue || '';
            finalContent = finalContent.replace(new RegExp(`{{${field.name}}}`, 'g'), value);
        });
        
        // Here you would typically save the document and send it for signing
        alert(`Dokument "${template.name}" został przygotowany do wysłania!\n\nPodgląd:\n${finalContent.substring(0, 200)}...`);
    };

    return (
        <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto" onClick={() => setStatusPopoverDocId(null)}>
             <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
                 <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t(language, 'documents.title')}</h1>
                 <LanguageSelector
                     currentLanguage={language}
                     onLanguageChange={setLanguage}
                     variant="minimal"
                 />
             </div>

             {/* Tabs */}
             <div className="flex gap-2 mb-6 border-b border-slate-200">
                 <button
                     onClick={() => setActiveTab('documents')}
                     className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                         activeTab === 'documents'
                             ? 'border-blue-600 text-blue-600'
                             : 'border-transparent text-slate-600 hover:text-slate-900'
                     }`}
                 >
                     <FileSignature size={18} />
                     Dokumenty do podpisania
                 </button>
                 <button
                     onClick={() => setActiveTab('templates')}
                     className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                         activeTab === 'templates'
                             ? 'border-blue-600 text-blue-600'
                             : 'border-transparent text-slate-600 hover:text-slate-900'
                     }`}
                 >
                     <LayoutTemplate size={18} />
                     Szablony HR
                 </button>
                 <button
                     onClick={() => setActiveTab('verification')}
                     className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                         activeTab === 'verification'
                             ? 'border-blue-600 text-blue-600'
                             : 'border-transparent text-slate-600 hover:text-slate-900'
                     }`}
                 >
                     <Shield size={18} />
                     Weryfikacja
                 </button>
                 <button
                     onClick={() => setActiveTab('api')}
                     className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                         activeTab === 'api'
                             ? 'border-blue-600 text-blue-600'
                             : 'border-transparent text-slate-600 hover:text-slate-900'
                     }`}
                 >
                     <Code size={18} />
                     API & Webhooki
                 </button>
             </div>

             {activeTab === 'templates' ? (
                 <HRTemplatesManager onSendForSigning={handleTemplateSend} />
             ) : activeTab === 'api' ? (
                 <ApiSettingsManager />
             ) : activeTab === 'verification' ? (
                 <VerificationHistory />
             ) : (
             <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {/* Bulk Signing Toolbar */}
                <BulkSigningToolbar
                    selectedCount={selectedDocs.size}
                    totalCount={pendingDocs.length}
                    onSelectAll={handleSelectAll}
                    onDeselectAll={handleDeselectAll}
                    onSignSelected={handleBulkSign}
                    isSigning={isBulkSigning}
                    progress={bulkProgress}
                />

                <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[600px]">
                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                        <tr>
                            <th className="px-2 sm:px-4 md:px-6 py-3 md:py-4 w-12"></th>
                            <th className="px-3 sm:px-4 md:px-6 py-3 md:py-4">{t(language, 'documents.employee')}</th>
                            <th className="px-3 sm:px-4 md:px-6 py-3 md:py-4">{t(language, 'documents.document')}</th>
                            <th className="px-3 sm:px-4 md:px-6 py-3 md:py-4">{t(language, 'documents.bonus')}</th>
                            <th className="px-3 sm:px-4 md:px-6 py-3 md:py-4">{t(language, 'documents.status')}</th>
                            <th className="px-3 sm:px-4 md:px-6 py-3 md:py-4">Weryfikacja</th>
                            <th className="px-3 sm:px-4 md:px-6 py-3 md:py-4 text-right">{t(language, 'documents.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {pendingDocs.map(doc => {
                            const user = state.users.find(u => u.id === doc.user_id);
                            const skill = state.skills.find(s => s.id === doc.skill_id);
                            const bonus = doc.bonus_value || skill?.hourly_bonus || 0;
                            const displayName = doc.custom_name || skill?.name_pl || 'Dokument';
                            const urlsFound = Array.isArray(doc.document_urls) && doc.document_urls.length > 0 ? doc.document_urls.length : (doc.document_url ? 1 : 0);
                            const isSelected = selectedDocs.has(doc.id);

                            return (
                                <tr key={doc.id} className={`hover:bg-slate-50 cursor-pointer ${isSelected ? 'bg-blue-50/50' : ''}`} onClick={() => handleEditDocument(doc.id)}>
                                    <td className="px-2 sm:px-4 md:px-6 py-3 md:py-4" onClick={(e) => e.stopPropagation()}>
                                        <DocumentCheckbox
                                            checked={isSelected}
                                            onChange={() => handleToggleDoc(doc.id)}
                                            disabled={isBulkSigning}
                                        />
                                    </td>
                                    <td className="px-3 sm:px-4 md:px-6 py-3 md:py-4 font-medium">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xs">
                                                {user ? user.first_name[0] + user.last_name[0] : '?'}
                                            </div>
                                            <div>
                                                {user ? `${user.first_name} ${user.last_name}` : 'Nieznany'}
                                                <div className="text-xs text-slate-400">{user?.role}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 sm:px-4 md:px-6 py-3 md:py-4">
                                        <div className="flex items-center gap-2">
                                            <FileText size={16} className="text-slate-400 hidden sm:block"/>
                                            <span className="truncate max-w-[120px] sm:max-w-none">{displayName}</span>
                                        </div>
                                    </td>
                                    <td className="px-3 sm:px-4 md:px-6 py-3 md:py-4">
                                        {bonus > 0 ? (
                                            <span className="text-green-600 font-bold">+{bonus} zł/h</span>
                                        ) : (
                                            <span className="text-slate-400">0 zł/h</span>
                                        )}
                                    </td>
                                    <td className="px-3 sm:px-4 md:px-6 py-3 md:py-4 relative" onClick={(e) => { e.stopPropagation(); setStatusPopoverDocId(doc.id); }}>
                                        <span className={`px-2 py-1 rounded text-xs font-bold uppercase cursor-pointer hover:opacity-80 bg-blue-100 text-blue-700`}>
                                            {SKILL_STATUS_LABELS[doc.status]}
                                        </span>
                                        {statusPopoverDocId === doc.id && (
                                            <div className="absolute top-full left-0 sm:left-0 right-0 sm:right-auto mt-1 w-full sm:w-48 bg-white border border-slate-200 shadow-xl rounded-lg z-[9999] flex flex-col py-1">
                                                <button className="text-left px-3 py-2 text-xs hover:bg-green-50 text-green-700 font-medium flex items-center gap-2" onClick={() => handleDocStatusChange(doc.id, SkillStatus.CONFIRMED)}>
                                                    <CheckCircle size={14}/> Zatwierdź
                                                </button>
                                                <button className="text-left px-3 py-2 text-xs hover:bg-red-50 text-red-700 font-medium flex items-center gap-2" onClick={() => handleDocStatusChange(doc.id, SkillStatus.FAILED)}>
                                                    <XCircle size={14}/> Odrzuć
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 sm:px-4 md:px-6 py-3 md:py-4" onClick={(e) => e.stopPropagation()}>
                                        <IdentityVerification userId={doc.user_id} />
                                    </td>
                                    <td className="px-3 sm:px-4 md:px-6 py-3 md:py-4 text-right">
                                        <div className="flex justify-end gap-1">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); openFileViewer(doc); }}
                                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all"
                                                title={`Podgląd ${urlsFound > 1 ? `(${urlsFound})` : ''}`}
                                            >
                                                <Eye size={20}/>
                                            </button>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDocStatusChange(doc.id, SkillStatus.FAILED); }}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                                                title="Odrzuć dokument"
                                            >
                                                <XCircle size={20}/>
                                            </button>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDocStatusChange(doc.id, SkillStatus.CONFIRMED); }}
                                                className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-full transition-all"
                                                title="Zatwierdź dokument"
                                            >
                                                <CheckCircle size={20}/>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {pendingDocs.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-3 sm:px-6 py-8 sm:py-12 text-center text-slate-400">
                                    {t(language, 'documents.noDocuments')}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                </div>
             </div>
             )}

             {renderDocumentModal()}
             <DocumentViewerModal 
                isOpen={fileViewer.isOpen}
                onClose={() => setFileViewer({ ...fileViewer, isOpen: false })}
                urls={fileViewer.urls}
                initialIndex={fileViewer.index}
                title={fileViewer.title}
            />
             </div>
    );
};