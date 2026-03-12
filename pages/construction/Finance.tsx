import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Search, DollarSign, TrendingUp, TrendingDown, Wallet,
  CreditCard, Loader2, Download, Building2,
  FileText, ArrowUpRight, ArrowDownRight, PieChart, BarChart3,
  Receipt, Clock, X, Pencil, Save, Trash2, ChevronLeft, ChevronRight,
  Target
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import {
  Project, FinanceAccount, FinanceOperation, FinanceAct,
  FinanceOperationType, FinanceOperationStatus, ActStatus, Contractor
} from '../../types';
import {
  FINANCE_OPERATION_TYPE_LABELS, FINANCE_OPERATION_TYPE_COLORS,
  FINANCE_OPERATION_STATUS_LABELS, ACT_STATUS_LABELS, ACT_STATUS_COLORS
} from '../../constants';

type TabType = 'operations' | 'acts' | 'accounts' | 'budget';

interface ProjectBudget {
  id: string;
  project_id: string;
  year: number;
  month: number;
  planned_income: number;
  planned_expense: number;
  created_at: string;
  updated_at: string;
}

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

export const FinancePage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser } = state;

  const [activeTab, setActiveTab] = useState<TabType>('operations');
  const [operations, setOperations] = useState<FinanceOperation[]>([]);
  const [acts, setActs] = useState<FinanceAct[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [budgets, setBudgets] = useState<ProjectBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<FinanceOperationType | 'all'>('all');

  // Budget state
  const [budgetProjectId, setBudgetProjectId] = useState<string>('');
  const [budgetYear, setBudgetYear] = useState<number>(new Date().getFullYear());
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [editingBudget, setEditingBudget] = useState<ProjectBudget | null>(null);
  const [budgetForm, setBudgetForm] = useState({
    project_id: '',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    planned_income: 0,
    planned_expense: 0
  });

  // Modals
  const [showOperationModal, setShowOperationModal] = useState(false);
  const [showActModal, setShowActModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingOperation, setEditingOperation] = useState<FinanceOperation | null>(null);
  const [editingAct, setEditingAct] = useState<FinanceAct | null>(null);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [saving, setSaving] = useState(false);

  // Operation form
  const [operationForm, setOperationForm] = useState({
    project_id: '',
    account_id: '',
    contractor_id: '',
    operation_type: 'expense' as FinanceOperationType,
    amount: 0,
    description: '',
    operation_date: new Date().toISOString().split('T')[0],
    invoice_number: ''
  });

  // Act form — uses period_from/period_to to match DB schema
  const [actForm, setActForm] = useState({
    project_id: '',
    contractor_id: '',
    number: '',
    name: '',
    act_date: new Date().toISOString().split('T')[0],
    period_from: '',
    period_to: '',
    total: 0,
    nds_amount: 0,
    payment_status: 'unpaid' as 'unpaid' | 'partial' | 'paid'
  });

  // Account form
  const [accountForm, setAccountForm] = useState({
    name: '',
    account_type: 'bank' as 'bank' | 'cash' | 'card',
    bank_name: '',
    account_number: '',
    current_balance: 0
  });

  useEffect(() => {
    if (currentUser) loadData();
  }, [currentUser]);

  const loadData = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [operationsRes, actsRes, accountsRes, projectsRes, contractorsRes, budgetsRes] = await Promise.all([
        supabase
          .from('finance_operations')
          .select('*, project:projects(*), account:finance_accounts(*), contractor:contractors(*)')
          .eq('company_id', currentUser.company_id)
          .is('deleted_at', null)
          .order('operation_date', { ascending: false }),
        supabase
          .from('finance_acts')
          .select('*, project:projects(*), contractor:contractors(*)')
          .eq('company_id', currentUser.company_id)
          .is('deleted_at', null)
          .order('act_date', { ascending: false }),
        supabase
          .from('finance_accounts')
          .select('*')
          .eq('company_id', currentUser.company_id)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('projects')
          .select('*')
          .eq('company_id', currentUser.company_id),
        supabase
          .from('contractors')
          .select('*')
          .eq('company_id', currentUser.company_id)
          .is('deleted_at', null),
        supabase
          .from('project_budgets')
          .select('*')
          .in('project_id', (await supabase.from('projects').select('id').eq('company_id', currentUser.company_id)).data?.map(p => p.id) || [])
          .order('year', { ascending: true })
          .order('month', { ascending: true })
      ]);

      if (operationsRes.data) setOperations(operationsRes.data);
      if (actsRes.data) setActs(actsRes.data);
      if (accountsRes.data) setAccounts(accountsRes.data);
      if (projectsRes.data) {
        setProjects(projectsRes.data);
        if (projectsRes.data.length > 0 && !budgetProjectId) {
          setBudgetProjectId(projectsRes.data[0].id);
          setBudgetForm(f => ({ ...f, project_id: projectsRes.data[0].id }));
        }
      }
      if (contractorsRes.data) setContractors(contractorsRes.data);
      if (budgetsRes.data) setBudgets(budgetsRes.data);
    } catch (err) {
      console.error('Error loading finance data:', err);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const completedOps = operations.filter(o => o.status === 'completed');
    const income = completedOps.filter(o => o.operation_type === 'income' || (o as any).transaction_type === 'income').reduce((sum, o) => sum + o.amount, 0);
    const expense = completedOps.filter(o => o.operation_type === 'expense' || (o as any).transaction_type === 'expense').reduce((sum, o) => sum + o.amount, 0);
    const totalBalance = accounts.reduce((sum, a) => sum + (a.current_balance ?? a.balance ?? 0), 0);
    const pendingActs = acts.filter(a => a.payment_status !== 'paid').reduce((sum, a) => sum + ((a.total ?? a.amount ?? 0) - (a.paid_amount ?? 0)), 0);

    return { income, expense, balance: income - expense, totalBalance, pendingActs };
  }, [operations, accounts, acts]);

  const filteredOperations = useMemo(() => {
    return operations.filter(op => {
      const matchesProject = projectFilter === 'all' || op.project_id === projectFilter;
      const opType = op.operation_type || (op as any).transaction_type;
      const matchesType = typeFilter === 'all' || opType === typeFilter;
      const matchesSearch = !search || op.description?.toLowerCase().includes(search.toLowerCase());
      return matchesProject && matchesType && matchesSearch;
    });
  }, [operations, projectFilter, typeFilter, search]);

  const filteredActs = useMemo(() => {
    return acts.filter(act => {
      const matchesProject = projectFilter === 'all' || act.project_id === projectFilter;
      const matchesSearch = !search ||
        act.number?.toLowerCase().includes(search.toLowerCase()) ||
        act.name?.toLowerCase().includes(search.toLowerCase());
      return matchesProject && matchesSearch;
    });
  }, [acts, projectFilter, search]);

  // Budget computations for selected project+year
  const budgetData = useMemo(() => {
    const projectBudgets = budgets.filter(b => b.project_id === budgetProjectId && b.year === budgetYear);

    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const budget = projectBudgets.find(b => b.month === month);

      // Actual from operations
      const monthOps = operations.filter(op => {
        if (!budgetProjectId || op.project_id !== budgetProjectId) return false;
        const d = new Date(op.operation_date || (op as any).transaction_date || '');
        return d.getFullYear() === budgetYear && d.getMonth() + 1 === month && op.status === 'completed';
      });

      const actualIncome = monthOps
        .filter(o => o.operation_type === 'income' || (o as any).transaction_type === 'income')
        .reduce((s, o) => s + o.amount, 0);
      const actualExpense = monthOps
        .filter(o => o.operation_type === 'expense' || (o as any).transaction_type === 'expense')
        .reduce((s, o) => s + o.amount, 0);

      return {
        month,
        monthName: MONTH_NAMES[i],
        budgetId: budget?.id,
        plannedIncome: budget?.planned_income ?? 0,
        plannedExpense: budget?.planned_expense ?? 0,
        actualIncome,
        actualExpense,
        varianceIncome: actualIncome - (budget?.planned_income ?? 0),
        varianceExpense: actualExpense - (budget?.planned_expense ?? 0),
      };
    });
  }, [budgets, budgetProjectId, budgetYear, operations]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value);

  const formatDate = (date: string) =>
    date ? new Date(date).toLocaleDateString('pl-PL') : '—';

  // ─── Operation CRUD ───────────────────────────────────────────────────────
  const handleSaveOperation = async () => {
    if (!currentUser || !operationForm.amount || !operationForm.account_id) return;
    setSaving(true);
    try {
      const data = {
        company_id: currentUser.company_id,
        project_id: operationForm.project_id || null,
        account_id: operationForm.account_id,
        contractor_id: operationForm.contractor_id || null,
        operation_type: operationForm.operation_type,
        amount: operationForm.amount,
        description: operationForm.description,
        operation_date: operationForm.operation_date,
        invoice_number: operationForm.invoice_number || null,
        status: 'completed' as FinanceOperationStatus,
        created_by_id: currentUser.id
      };

      if (editingOperation) {
        await supabase.from('finance_operations').update(data).eq('id', editingOperation.id);
      } else {
        await supabase.from('finance_operations').insert(data);
      }

      setShowOperationModal(false);
      setEditingOperation(null);
      resetOperationForm();
      await loadData();
    } catch (err) {
      console.error('Error saving operation:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOperation = async (op: FinanceOperation) => {
    if (!confirm('Czy na pewno chcesz usunąć tę operację?')) return;
    try {
      await supabase.from('finance_operations').update({ deleted_at: new Date().toISOString() }).eq('id', op.id);
      await loadData();
    } catch (err) {
      console.error('Error deleting operation:', err);
    }
  };

  const resetOperationForm = () => {
    setOperationForm({
      project_id: '',
      account_id: accounts.length === 1 ? accounts[0].id : '',
      contractor_id: '',
      operation_type: 'expense',
      amount: 0,
      description: '',
      operation_date: new Date().toISOString().split('T')[0],
      invoice_number: ''
    });
  };

  // ─── Act CRUD ─────────────────────────────────────────────────────────────
  const handleSaveAct = async () => {
    if (!currentUser || !actForm.number || !actForm.total || !actForm.project_id || !actForm.contractor_id) return;
    setSaving(true);
    try {
      const data = {
        company_id: currentUser.company_id,
        project_id: actForm.project_id,
        contractor_id: actForm.contractor_id,
        number: actForm.number,
        name: actForm.name || null,
        act_date: actForm.act_date,
        period_from: actForm.period_from || actForm.act_date,
        period_to: actForm.period_to || actForm.act_date,
        total: actForm.total,
        nds_amount: actForm.nds_amount,
        payment_status: actForm.payment_status,
        status: 'draft' as ActStatus,
        created_by_id: currentUser.id
      };

      if (editingAct) {
        await supabase.from('finance_acts').update(data).eq('id', editingAct.id);
      } else {
        await supabase.from('finance_acts').insert(data);
      }

      setShowActModal(false);
      setEditingAct(null);
      resetActForm();
      await loadData();
    } catch (err) {
      console.error('Error saving act:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAct = async (act: FinanceAct) => {
    if (!confirm('Czy na pewno chcesz usunąć ten akt?')) return;
    try {
      await supabase.from('finance_acts').update({ deleted_at: new Date().toISOString() }).eq('id', act.id);
      await loadData();
    } catch (err) {
      console.error('Error deleting act:', err);
    }
  };

  const resetActForm = () => {
    setActForm({
      project_id: '',
      contractor_id: '',
      number: '',
      name: '',
      act_date: new Date().toISOString().split('T')[0],
      period_from: '',
      period_to: '',
      total: 0,
      nds_amount: 0,
      payment_status: 'unpaid'
    });
  };

  // ─── Account CRUD ─────────────────────────────────────────────────────────
  const handleSaveAccount = async () => {
    if (!currentUser || !accountForm.name) return;
    setSaving(true);
    try {
      const data = {
        company_id: currentUser.company_id,
        name: accountForm.name,
        account_type: accountForm.account_type,
        bank_name: accountForm.bank_name || null,
        account_number: accountForm.account_number || null,
        current_balance: accountForm.current_balance
      };

      if (editingAccount) {
        await supabase.from('finance_accounts').update(data).eq('id', editingAccount.id);
      } else {
        await supabase.from('finance_accounts').insert({ ...data, is_active: true });
      }

      setShowAccountModal(false);
      setEditingAccount(null);
      resetAccountForm();
      await loadData();
    } catch (err) {
      console.error('Error saving account:', err);
    } finally {
      setSaving(false);
    }
  };

  const resetAccountForm = () => {
    setAccountForm({ name: '', account_type: 'bank', bank_name: '', account_number: '', current_balance: 0 });
  };

  // ─── Budget CRUD ──────────────────────────────────────────────────────────
  const handleSaveBudget = async () => {
    if (!currentUser || !budgetForm.project_id) return;
    setSaving(true);
    try {
      const data = {
        project_id: budgetForm.project_id,
        year: budgetForm.year,
        month: budgetForm.month,
        planned_income: budgetForm.planned_income,
        planned_expense: budgetForm.planned_expense
      };

      if (editingBudget) {
        await supabase.from('project_budgets').update(data).eq('id', editingBudget.id);
      } else {
        // upsert by project_id+year+month
        await supabase.from('project_budgets').upsert(data, { onConflict: 'project_id,year,month' });
      }

      setShowBudgetModal(false);
      setEditingBudget(null);
      await loadData();
    } catch (err) {
      console.error('Error saving budget:', err);
    } finally {
      setSaving(false);
    }
  };

  const openBudgetModal = (month: number, existing?: ProjectBudget) => {
    setEditingBudget(existing || null);
    setBudgetForm({
      project_id: budgetProjectId,
      year: budgetYear,
      month,
      planned_income: existing?.planned_income ?? 0,
      planned_expense: existing?.planned_expense ?? 0
    });
    setShowBudgetModal(true);
  };

  // ─── Export ───────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    const rows = [
      ['Data', 'Typ', 'Kwota', 'Opis', 'Nr dokumentu', 'Projekt', 'Status'],
      ...filteredOperations.map(op => [
        formatDate(op.operation_date || (op as any).transaction_date || ''),
        FINANCE_OPERATION_TYPE_LABELS[op.operation_type as FinanceOperationType] || op.operation_type,
        op.operation_type === 'expense' ? -op.amount : op.amount,
        op.description || '',
        (op as any).invoice_number || (op as any).document_number || '',
        (op as any).project?.name || '',
        FINANCE_OPERATION_STATUS_LABELS[op.status as FinanceOperationStatus] || op.status
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operacje_finansowe_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportXLS = async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MaxMaster Portal';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Operacje finansowe');

    // Column definitions
    sheet.columns = [
      { header: 'Data', key: 'date', width: 14 },
      { header: 'Typ', key: 'type', width: 18 },
      { header: 'Kwota (PLN)', key: 'amount', width: 16 },
      { header: 'Opis', key: 'description', width: 30 },
      { header: 'Nr dokumentu', key: 'document', width: 18 },
      { header: 'Projekt', key: 'project', width: 22 },
      { header: 'Status', key: 'status', width: 16 },
    ];

    // Bold header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' }
    };
    headerRow.border = {
      bottom: { style: 'thin', color: { argb: 'FF94A3B8' } }
    };

    // Data rows
    filteredOperations.forEach(op => {
      const rawDate = op.operation_date || (op as any).transaction_date || '';
      const amount = op.operation_type === 'expense' ? -op.amount : op.amount;

      const row = sheet.addRow({
        date: rawDate ? new Date(rawDate).toLocaleDateString('pl-PL') : '—',
        type: FINANCE_OPERATION_TYPE_LABELS[op.operation_type as FinanceOperationType] || op.operation_type,
        amount: Number(amount),
        description: op.description || '',
        document: (op as any).invoice_number || (op as any).document_number || '',
        project: (op as any).project?.name || '',
        status: FINANCE_OPERATION_STATUS_LABELS[op.status as FinanceOperationStatus] || op.status,
      });

      // Format amount column: 2 decimal places
      const amountCell = row.getCell('amount');
      amountCell.numFmt = '#,##0.00 "zł"';
      if (amount < 0) {
        amountCell.font = { color: { argb: 'FFDC2626' } }; // red for expenses
      } else {
        amountCell.font = { color: { argb: 'FF16A34A' } }; // green for income
      }
    });

    // Auto-filter on header
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 7 }
    };

    // Generate file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operacje_finansowe_${new Date().toLocaleDateString('pl-PL').replace(/\./g, '-')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };


  const handleExportActsPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const company = 'MaxMaster';
    const dateStr = new Date().toLocaleDateString('pl-PL');

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Akty wykonawcze', 14, 20);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Wygenerowano: ${dateStr}`, 14, 28);
    if (projectFilter !== 'all') {
      const proj = projects.find(p => p.id === projectFilter);
      if (proj) doc.text(`Projekt: ${proj.name}`, 14, 35);
    }

    const tableRows = filteredActs.map(act => [
      act.number || '—',
      act.name || '—',
      formatDate(act.act_date || act.date || ''),
      (act as any).project?.name || '—',
      (act as any).contractor?.name || '—',
      ACT_STATUS_LABELS[act.status as ActStatus] || act.status,
      act.payment_status === 'paid' ? 'Opłacony' : act.payment_status === 'partial' ? 'Częściowo' : 'Oczekuje',
      formatCurrency(act.total ?? act.amount ?? 0),
    ]);

    autoTable(doc, {
      startY: projectFilter !== 'all' ? 42 : 35,
      head: [['Nr aktu', 'Nazwa', 'Data', 'Projekt', 'Wykonawca', 'Status aktu', 'Płatność', 'Kwota']],
      body: tableRows,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 7: { halign: 'right' } },
      styles: { fontSize: 9, cellPadding: 3 },
    });

    // Summary row
    const total = filteredActs.reduce((s, a) => s + (a.total ?? a.amount ?? 0), 0);
    const finalY = (doc as any).lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'bold');
    doc.text(`Łącznie: ${formatCurrency(total)}`, 14, finalY);

    doc.save(`akty_wykonawcze_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handlePrintOperations = () => {
    const printContent = `
      <html><head><title>Operacje finansowe</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { color: #666; font-size: 11px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #e2e8f0; padding: 6px 8px; text-align: left; border-bottom: 2px solid #94a3b8; font-weight: bold; }
        td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
        .income { color: #16a34a; font-weight: 600; }
        .expense { color: #dc2626; font-weight: 600; }
        .summary { margin-top: 16px; font-weight: bold; font-size: 13px; }
      </style></head><body>
      <h1>Operacje finansowe</h1>
      <div class="meta">Wygenerowano: ${new Date().toLocaleDateString('pl-PL')}${dateFrom || dateTo ? ` | Zakres: ${dateFrom || '—'} → ${dateTo || '—'}` : ''}</div>
      <table>
        <thead><tr>
          <th>Data</th><th>Opis</th><th>Typ</th><th>Projekt</th><th>Nr dokumentu</th><th>Status</th><th style="text-align:right">Kwota</th>
        </tr></thead>
        <tbody>
          ${filteredOperations.map(op => {
            const opType = op.operation_type || (op as any).transaction_type;
            const amount = (opType === 'expense' ? '-' : '+') + formatCurrency(op.amount);
            const cls = opType === 'income' ? 'income' : 'expense';
            return `<tr>
              <td>${formatDate(op.operation_date || (op as any).transaction_date || '')}</td>
              <td>${op.description || '—'}</td>
              <td>${FINANCE_OPERATION_TYPE_LABELS[op.operation_type as FinanceOperationType] || op.operation_type}</td>
              <td>${(op as any).project?.name || '—'}</td>
              <td>${(op as any).invoice_number || (op as any).document_number || '—'}</td>
              <td>${FINANCE_OPERATION_STATUS_LABELS[op.status as FinanceOperationStatus] || op.status}</td>
              <td class="${cls}" style="text-align:right">${amount}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="summary">
        Przychody: ${formatCurrency(stats.income)} | Wydatki: ${formatCurrency(stats.expense)} | Bilans: ${formatCurrency(stats.balance)}
      </div>
      </body></html>
    `;
    const w = window.open('', '_blank');
    if (w) { w.document.write(printContent); w.document.close(); w.print(); }
  };

  const tabs: { key: TabType; label: string; icon: React.ElementType }[] = [
    { key: 'operations', label: 'Operacje', icon: DollarSign },
    { key: 'acts', label: 'Akty', icon: FileText },
    { key: 'accounts', label: 'Konta', icon: Wallet },
    { key: 'budget', label: 'Budżet', icon: PieChart }
  ];

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-end gap-2">
        {activeTab === 'operations' && (
          <>
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
            >
              <Download className="w-4 h-4" />
              Eksport CSV
            </button>
            <button
              onClick={() => { resetOperationForm(); setEditingOperation(null); setShowOperationModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-5 h-5" />
              Nowa operacja
            </button>
          </>
        )}
        {activeTab === 'acts' && (
          <button
            onClick={() => { resetActForm(); setEditingAct(null); setShowActModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            Nowy akt
          </button>
        )}
        {activeTab === 'accounts' && (
          <button
            onClick={() => { resetAccountForm(); setEditingAccount(null); setShowAccountModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            Nowe konto
          </button>
        )}
        {activeTab === 'budget' && budgetProjectId && (
          <button
            onClick={() => openBudgetModal(new Date().getMonth() + 1)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            Zaplanuj miesiąc
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 text-green-600 mb-2">
            <TrendingUp className="w-5 h-5" />
            <span className="text-sm font-medium">Przychody</span>
          </div>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(stats.income)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 text-red-600 mb-2">
            <TrendingDown className="w-5 h-5" />
            <span className="text-sm font-medium">Wydatki</span>
          </div>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(stats.expense)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 text-blue-600 mb-2">
            <BarChart3 className="w-5 h-5" />
            <span className="text-sm font-medium">Bilans</span>
          </div>
          <p className={`text-xl font-bold ${stats.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(stats.balance)}
          </p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 text-purple-600 mb-2">
            <Wallet className="w-5 h-5" />
            <span className="text-sm font-medium">Na kontach</span>
          </div>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(stats.totalBalance)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 text-amber-600 mb-2">
            <Clock className="w-5 h-5" />
            <span className="text-sm font-medium">Do zapłaty</span>
          </div>
          <p className="text-xl font-bold text-slate-900">{formatCurrency(stats.pendingActs)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="border-b border-slate-200">
          <nav className="flex -mb-px">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Filters */}
        {(activeTab === 'operations' || activeTab === 'acts') && (
          <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4">
            <div className="flex-1 min-w-64 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Szukaj..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg"
              />
            </div>
            <select
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-lg"
            >
              <option value="all">Wszystkie projekty</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {activeTab === 'operations' && (
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as FinanceOperationType | 'all')}
                className="px-4 py-2 border border-slate-200 rounded-lg"
              >
                <option value="all">Wszystkie typy</option>
                <option value="income">Przychody</option>
                <option value="expense">Wydatki</option>
              </select>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : activeTab === 'operations' ? (
            filteredOperations.length === 0 ? (
              <div className="text-center py-12">
                <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 mb-4">Brak operacji finansowych</p>
                <button
                  onClick={() => { resetOperationForm(); setShowOperationModal(true); }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Dodaj pierwszą operację
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredOperations.map(op => {
                  const opType = op.operation_type || (op as any).transaction_type;
                  return (
                    <div
                      key={op.id}
                      className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 cursor-pointer group"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        opType === 'income' ? 'bg-green-100' : 'bg-red-100'
                      }`}>
                        {opType === 'income' ? (
                          <ArrowUpRight className="w-5 h-5 text-green-600" />
                        ) : (
                          <ArrowDownRight className="w-5 h-5 text-red-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{op.description || 'Operacja finansowa'}</p>
                        <p className="text-sm text-slate-500">
                          {formatDate(op.operation_date || (op as any).transaction_date || '')}
                          {' • '}
                          {(op as any).project?.name || 'Bez projektu'}
                          {((op as any).invoice_number || (op as any).document_number) && ` • ${(op as any).invoice_number || (op as any).document_number}`}
                        </p>
                      </div>
                      <span className={`hidden md:inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        op.status === 'completed' ? 'bg-green-100 text-green-700' :
                        op.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {FINANCE_OPERATION_STATUS_LABELS[op.status as FinanceOperationStatus] || op.status}
                      </span>
                      <p className={`text-lg font-semibold ${
                        opType === 'income' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {opType === 'income' ? '+' : '-'}{formatCurrency(op.amount)}
                      </p>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingOperation(op);
                            setOperationForm({
                              project_id: op.project_id || '',
                              account_id: op.account_id || '',
                              contractor_id: op.contractor_id || '',
                              operation_type: (opType || 'expense') as FinanceOperationType,
                              amount: op.amount,
                              description: op.description || '',
                              operation_date: (op.operation_date || (op as any).transaction_date || '').split('T')[0],
                              invoice_number: (op as any).invoice_number || (op as any).document_number || ''
                            });
                            setShowOperationModal(true);
                          }}
                          className="p-1 hover:bg-slate-200 rounded"
                        >
                          <Pencil className="w-4 h-4 text-slate-400" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteOperation(op); }}
                          className="p-1 hover:bg-red-100 rounded"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : activeTab === 'acts' ? (
            filteredActs.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 mb-4">Brak aktów wykonawczych</p>
                <button
                  onClick={() => { resetActForm(); setShowActModal(true); }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Dodaj pierwszy akt
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredActs.map(act => (
                  <div
                    key={act.id}
                    className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 cursor-pointer group"
                  >
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Receipt className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">Akt nr {act.number}{act.name ? ` — ${act.name}` : ''}</p>
                      <p className="text-sm text-slate-500">
                        {formatDate(act.act_date || act.date)}
                        {' • '}
                        {(act as any).project?.name || '—'}
                        {(act as any).contractor?.name && ` • ${(act as any).contractor?.name}`}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      ACT_STATUS_COLORS[act.status as ActStatus] || 'bg-slate-100 text-slate-600'
                    }`}>
                      {ACT_STATUS_LABELS[act.status as ActStatus] || act.status}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      act.payment_status === 'paid' ? 'bg-green-100 text-green-700' :
                      act.payment_status === 'partial' ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {act.payment_status === 'paid' ? 'Opłacony' :
                       act.payment_status === 'partial' ? 'Częściowo' : 'Oczekuje'}
                    </span>
                    <p className="text-lg font-semibold text-slate-900">
                      {formatCurrency(act.total ?? act.amount ?? 0)}
                    </p>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingAct(act);
                          setActForm({
                            project_id: act.project_id || '',
                            contractor_id: act.contractor_id || '',
                            number: act.number,
                            name: act.name || '',
                            act_date: (act.act_date || act.date || '').split('T')[0],
                            period_from: ((act as any).period_from || (act as any).period_start || '').split('T')[0],
                            period_to: ((act as any).period_to || (act as any).period_end || '').split('T')[0],
                            total: act.total ?? act.amount ?? 0,
                            nds_amount: act.nds_amount ?? 0,
                            payment_status: (act.payment_status === 'unpaid' ? 'unpaid' : act.payment_status || 'unpaid') as 'unpaid' | 'partial' | 'paid'
                          });
                          setShowActModal(true);
                        }}
                        className="p-1 hover:bg-slate-200 rounded"
                      >
                        <Pencil className="w-4 h-4 text-slate-400" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteAct(act); }}
                        className="p-1 hover:bg-red-100 rounded"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : activeTab === 'accounts' ? (
            accounts.length === 0 ? (
              <div className="text-center py-12">
                <Wallet className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 mb-4">Brak kont finansowych</p>
                <button
                  onClick={() => { resetAccountForm(); setShowAccountModal(true); }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Dodaj pierwsze konto
                </button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {accounts.map(account => (
                  <div key={account.id} className="p-4 bg-slate-50 rounded-lg group">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        account.account_type === 'bank' ? 'bg-blue-100' :
                        account.account_type === 'cash' ? 'bg-green-100' : 'bg-purple-100'
                      }`}>
                        {account.account_type === 'bank' ? (
                          <Building2 className="w-5 h-5 text-blue-600" />
                        ) : account.account_type === 'cash' ? (
                          <DollarSign className="w-5 h-5 text-green-600" />
                        ) : (
                          <CreditCard className="w-5 h-5 text-purple-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{account.name}</p>
                        <p className="text-xs text-slate-500">{account.bank_name || 'Gotówka'}</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => {
                            setEditingAccount(account);
                            setAccountForm({
                              name: account.name,
                              account_type: (account.account_type || 'bank') as 'bank' | 'cash' | 'card',
                              bank_name: account.bank_name || '',
                              account_number: account.account_number || '',
                              current_balance: account.current_balance ?? account.balance ?? 0
                            });
                            setShowAccountModal(true);
                          }}
                          className="p-1 hover:bg-slate-200 rounded"
                        >
                          <Pencil className="w-4 h-4 text-slate-400" />
                        </button>
                      </div>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">
                      {formatCurrency(account.current_balance ?? account.balance ?? 0)}
                    </p>
                    {account.account_number && (
                      <p className="text-xs text-slate-400 mt-1">{account.account_number}</p>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            /* ─── BUDGET TAB ─────────────────────────────────────────── */
            <div>
              {projects.length === 0 ? (
                <div className="text-center py-12">
                  <Target className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500">Brak projektów do planowania budżetu</p>
                </div>
              ) : (
                <>
                  {/* Controls */}
                  <div className="flex flex-wrap gap-4 mb-6 items-center">
                    <select
                      value={budgetProjectId}
                      onChange={e => setBudgetProjectId(e.target.value)}
                      className="px-4 py-2 border border-slate-200 rounded-lg font-medium"
                    >
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setBudgetYear(y => y - 1)}
                        className="p-2 hover:bg-slate-100 rounded-lg"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-lg font-semibold text-slate-900 min-w-16 text-center">
                        {budgetYear}
                      </span>
                      <button
                        onClick={() => setBudgetYear(y => y + 1)}
                        className="p-2 hover:bg-slate-100 rounded-lg"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Year summary */}
                  {(() => {
                    const totalPlannedIncome = budgetData.reduce((s, r) => s + r.plannedIncome, 0);
                    const totalPlannedExpense = budgetData.reduce((s, r) => s + r.plannedExpense, 0);
                    const totalActualIncome = budgetData.reduce((s, r) => s + r.actualIncome, 0);
                    const totalActualExpense = budgetData.reduce((s, r) => s + r.actualExpense, 0);
                    return (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                          <p className="text-xs text-green-600 font-medium mb-1">Plan przychód</p>
                          <p className="text-lg font-bold text-green-700">{formatCurrency(totalPlannedIncome)}</p>
                        </div>
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                          <p className="text-xs text-blue-600 font-medium mb-1">Fakt przychód</p>
                          <p className="text-lg font-bold text-blue-700">{formatCurrency(totalActualIncome)}</p>
                        </div>
                        <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                          <p className="text-xs text-red-600 font-medium mb-1">Plan wydatki</p>
                          <p className="text-lg font-bold text-red-700">{formatCurrency(totalPlannedExpense)}</p>
                        </div>
                        <div className="bg-amber-50 p-4 rounded-xl border border-amber-100">
                          <p className="text-xs text-amber-600 font-medium mb-1">Fakt wydatki</p>
                          <p className="text-lg font-bold text-amber-700">{formatCurrency(totalActualExpense)}</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Monthly table */}
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-4 py-3 text-left font-medium text-slate-600">Miesiąc</th>
                          <th className="px-4 py-3 text-right font-medium text-green-600">Plan przychód</th>
                          <th className="px-4 py-3 text-right font-medium text-blue-600">Fakt przychód</th>
                          <th className="px-4 py-3 text-right font-medium text-slate-500">Odchylenie</th>
                          <th className="px-4 py-3 text-right font-medium text-red-600">Plan wydatki</th>
                          <th className="px-4 py-3 text-right font-medium text-amber-600">Fakt wydatki</th>
                          <th className="px-4 py-3 text-right font-medium text-slate-500">Odchylenie</th>
                          <th className="px-4 py-3 text-center font-medium text-slate-500 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {budgetData.map(row => {
                          const currentMonth = new Date().getMonth() + 1;
                          const currentYear = new Date().getFullYear();
                          const isCurrentMonth = row.month === currentMonth && budgetYear === currentYear;
                          const hasBudget = row.plannedIncome > 0 || row.plannedExpense > 0;

                          return (
                            <tr
                              key={row.month}
                              className={`border-b border-slate-100 hover:bg-slate-50 ${isCurrentMonth ? 'bg-blue-50/30' : ''}`}
                            >
                              <td className="px-4 py-3 font-medium text-slate-900">
                                <span className={isCurrentMonth ? 'text-blue-600' : ''}>{row.monthName}</span>
                                {isCurrentMonth && <span className="ml-2 text-xs text-blue-500 font-normal">bieżący</span>}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">
                                {hasBudget ? formatCurrency(row.plannedIncome) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">
                                {row.actualIncome > 0 ? formatCurrency(row.actualIncome) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {hasBudget && (
                                  <span className={`text-xs font-medium ${
                                    row.varianceIncome >= 0 ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                    {row.varianceIncome >= 0 ? '+' : ''}{formatCurrency(row.varianceIncome)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">
                                {hasBudget ? formatCurrency(row.plannedExpense) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">
                                {row.actualExpense > 0 ? formatCurrency(row.actualExpense) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {hasBudget && (
                                  <span className={`text-xs font-medium ${
                                    row.varianceExpense <= 0 ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                    {row.varianceExpense >= 0 ? '+' : ''}{formatCurrency(row.varianceExpense)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={() => openBudgetModal(row.month, row.budgetId
                                    ? budgets.find(b => b.id === row.budgetId)
                                    : undefined
                                  )}
                                  className="p-1.5 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600"
                                  title="Edytuj plan"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Operation Modal ─────────────────────────────────────────────── */}
      {showOperationModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                {editingOperation ? 'Edytuj operację' : 'Nowa operacja'}
              </h2>
              <button onClick={() => setShowOperationModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setOperationForm({ ...operationForm, operation_type: 'income' })}
                  className={`p-4 rounded-lg border-2 text-center transition ${
                    operationForm.operation_type === 'income'
                      ? 'border-green-500 bg-green-50'
                      : 'border-slate-200 hover:border-green-300'
                  }`}
                >
                  <ArrowUpRight className={`w-6 h-6 mx-auto mb-1 ${
                    operationForm.operation_type === 'income' ? 'text-green-600' : 'text-slate-400'
                  }`} />
                  <span className={operationForm.operation_type === 'income' ? 'text-green-700 font-medium' : 'text-slate-600'}>
                    Przychód
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setOperationForm({ ...operationForm, operation_type: 'expense' })}
                  className={`p-4 rounded-lg border-2 text-center transition ${
                    operationForm.operation_type === 'expense'
                      ? 'border-red-500 bg-red-50'
                      : 'border-slate-200 hover:border-red-300'
                  }`}
                >
                  <ArrowDownRight className={`w-6 h-6 mx-auto mb-1 ${
                    operationForm.operation_type === 'expense' ? 'text-red-600' : 'text-slate-400'
                  }`} />
                  <span className={operationForm.operation_type === 'expense' ? 'text-red-700 font-medium' : 'text-slate-600'}>
                    Wydatek
                  </span>
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Kwota *</label>
                <input
                  type="number"
                  value={operationForm.amount || ''}
                  onChange={e => setOperationForm({ ...operationForm, amount: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-lg"
                  step="0.01"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Konto *</label>
                <select
                  value={operationForm.account_id}
                  onChange={e => setOperationForm({ ...operationForm, account_id: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg ${
                    !operationForm.account_id ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
                  }`}
                >
                  <option value="">-- Wybierz konto --</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {!operationForm.account_id && (
                  <p className="text-xs text-amber-600 mt-1">Konto jest wymagane</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Opis</label>
                <input
                  type="text"
                  value={operationForm.description}
                  onChange={e => setOperationForm({ ...operationForm, description: e.target.value })}
                  placeholder="np. Faktura za materiały"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
                  <input
                    type="date"
                    value={operationForm.operation_date}
                    onChange={e => setOperationForm({ ...operationForm, operation_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nr faktury</label>
                  <input
                    type="text"
                    value={operationForm.invoice_number}
                    onChange={e => setOperationForm({ ...operationForm, invoice_number: e.target.value })}
                    placeholder="FV/2024/001"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Projekt</label>
                  <select
                    value={operationForm.project_id}
                    onChange={e => setOperationForm({ ...operationForm, project_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  >
                    <option value="">-- Wybierz --</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Kontrahent</label>
                  <select
                    value={operationForm.contractor_id}
                    onChange={e => setOperationForm({ ...operationForm, contractor_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  >
                    <option value="">-- Wybierz --</option>
                    {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowOperationModal(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveOperation}
                disabled={!operationForm.amount || !operationForm.account_id || saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingOperation ? 'Zapisz' : 'Dodaj'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Act Modal ───────────────────────────────────────────────────── */}
      {showActModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                {editingAct ? 'Edytuj akt' : 'Nowy akt wykonawczy'}
              </h2>
              <button onClick={() => setShowActModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Numer aktu *</label>
                  <input
                    type="text"
                    value={actForm.number}
                    onChange={e => setActForm({ ...actForm, number: e.target.value })}
                    placeholder="ACT-001"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Data aktu</label>
                  <input
                    type="date"
                    value={actForm.act_date}
                    onChange={e => setActForm({ ...actForm, act_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa</label>
                <input
                  type="text"
                  value={actForm.name}
                  onChange={e => setActForm({ ...actForm, name: e.target.value })}
                  placeholder="np. Akt wykonania robót elektrycznych"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Projekt *</label>
                  <select
                    value={actForm.project_id}
                    onChange={e => setActForm({ ...actForm, project_id: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg ${!actForm.project_id ? 'border-amber-300' : 'border-slate-200'}`}
                  >
                    <option value="">-- Wybierz --</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Kontrahent *</label>
                  <select
                    value={actForm.contractor_id}
                    onChange={e => setActForm({ ...actForm, contractor_id: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg ${!actForm.contractor_id ? 'border-amber-300' : 'border-slate-200'}`}
                  >
                    <option value="">-- Wybierz --</option>
                    {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Okres od</label>
                  <input
                    type="date"
                    value={actForm.period_from}
                    onChange={e => setActForm({ ...actForm, period_from: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Okres do</label>
                  <input
                    type="date"
                    value={actForm.period_to}
                    onChange={e => setActForm({ ...actForm, period_to: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Suma *</label>
                  <input
                    type="number"
                    value={actForm.total || ''}
                    onChange={e => setActForm({ ...actForm, total: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    step="0.01"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VAT</label>
                  <input
                    type="number"
                    value={actForm.nds_amount || ''}
                    onChange={e => setActForm({ ...actForm, nds_amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status płatności</label>
                <select
                  value={actForm.payment_status}
                  onChange={e => setActForm({ ...actForm, payment_status: e.target.value as any })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                >
                  <option value="unpaid">Nieopłacony</option>
                  <option value="partial">Częściowo opłacony</option>
                  <option value="paid">Opłacony</option>
                </select>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowActModal(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveAct}
                disabled={!actForm.number || !actForm.total || !actForm.project_id || !actForm.contractor_id || saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingAct ? 'Zapisz' : 'Dodaj'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Account Modal ───────────────────────────────────────────────── */}
      {showAccountModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                {editingAccount ? 'Edytuj konto' : 'Nowe konto finansowe'}
              </h2>
              <button onClick={() => setShowAccountModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa konta *</label>
                <input
                  type="text"
                  value={accountForm.name}
                  onChange={e => setAccountForm({ ...accountForm, name: e.target.value })}
                  placeholder="np. Konto główne PKO"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Typ konta</label>
                <select
                  value={accountForm.account_type}
                  onChange={e => setAccountForm({ ...accountForm, account_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                >
                  <option value="bank">Konto bankowe</option>
                  <option value="cash">Gotówka</option>
                  <option value="card">Karta</option>
                </select>
              </div>

              {accountForm.account_type === 'bank' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa banku</label>
                    <input
                      type="text"
                      value={accountForm.bank_name}
                      onChange={e => setAccountForm({ ...accountForm, bank_name: e.target.value })}
                      placeholder="np. PKO BP"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Numer konta</label>
                    <input
                      type="text"
                      value={accountForm.account_number}
                      onChange={e => setAccountForm({ ...accountForm, account_number: e.target.value })}
                      placeholder="PL 00 0000 0000 0000 0000 0000 0000"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Saldo początkowe</label>
                <input
                  type="number"
                  value={accountForm.current_balance || ''}
                  onChange={e => setAccountForm({ ...accountForm, current_balance: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  step="0.01"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowAccountModal(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveAccount}
                disabled={!accountForm.name || saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingAccount ? 'Zapisz' : 'Dodaj'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Budget Modal ────────────────────────────────────────────────── */}
      {showBudgetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                Budżet — {MONTH_NAMES[budgetForm.month - 1]} {budgetForm.year}
              </h2>
              <button onClick={() => setShowBudgetModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Projekt</label>
                <select
                  value={budgetForm.project_id}
                  onChange={e => setBudgetForm({ ...budgetForm, project_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                >
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rok</label>
                  <input
                    type="number"
                    value={budgetForm.year}
                    onChange={e => setBudgetForm({ ...budgetForm, year: parseInt(e.target.value) || budgetYear })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    min="2020" max="2030"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Miesiąc</label>
                  <select
                    value={budgetForm.month}
                    onChange={e => setBudgetForm({ ...budgetForm, month: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i + 1} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plan przychód (PLN)</label>
                <input
                  type="number"
                  value={budgetForm.planned_income || ''}
                  onChange={e => setBudgetForm({ ...budgetForm, planned_income: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  step="0.01" min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plan wydatki (PLN)</label>
                <input
                  type="number"
                  value={budgetForm.planned_expense || ''}
                  onChange={e => setBudgetForm({ ...budgetForm, planned_expense: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  step="0.01" min="0"
                />
              </div>
              {budgetForm.planned_income > 0 && budgetForm.planned_expense > 0 && (
                <div className={`p-3 rounded-lg text-sm font-medium ${
                  budgetForm.planned_income >= budgetForm.planned_expense
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}>
                  Planowany wynik: {formatCurrency(budgetForm.planned_income - budgetForm.planned_expense)}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowBudgetModal(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveBudget}
                disabled={!budgetForm.project_id || saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Zapisz plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancePage;
