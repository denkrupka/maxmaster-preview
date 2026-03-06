
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Users, CheckSquare, Award, DollarSign, BookOpen, X,
  LogOut, Layers, UserPlus, Settings,
  FileText, PieChart, Clock, FileCheck, Home, User, GraduationCap, LayoutDashboard, Briefcase, FileInput, AlertTriangle, Network,
  Building2, Target, UserCheck, Headphones, ChevronDown, RefreshCw, ShieldCheck, Gift,
  ClipboardList, CalendarOff, CalendarDays, CalendarClock, CalendarRange,
  FolderKanban, BarChart3, ChevronsLeft, ChevronsRight,
  // Construction module icons
  Calculator, FileSpreadsheet, HardHat, PenTool, FolderOpen, GanttChartSquare,
  Wallet, ShoppingCart, ClipboardCheck, Inbox
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { Role, UserStatus } from '../types';
import { ROLE_LABELS } from '../constants';
import { useMemo } from 'react';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  collapsed?: boolean;
  setCollapsed?: (v: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen, collapsed = false, setCollapsed }) => {
  const { state, logout, setSimulatedRole, getEffectiveRole } = useAppContext();
  const { currentUser, simulatedRole, currentCompany, companyModules } = state;
  const location = useLocation();
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Check if company is eligible for trial (never had any subscriptions including trial)
  const isEligibleForTrial = useMemo(() => {
    if (!currentCompany || currentUser?.role !== Role.COMPANY_ADMIN) return false;
    // Only show banner if subscription_status is 'none' (never started any subscription)
    // Don't show if already in trial, active, past_due, or cancelled
    if (currentCompany.subscription_status && currentCompany.subscription_status !== 'none') {
      return false;
    }
    // Also check if company has never had any subscription on any module
    const hasHadSubscription = companyModules.some(m =>
      m.company_id === currentCompany.id && m.stripe_subscription_id
    );
    return !hasHadSubscription;
  }, [currentCompany, companyModules, currentUser?.role]);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Get effective role for displaying the correct menu
  const effectiveRole = getEffectiveRole();
  const isSuperAdminSimulating = currentUser?.role === Role.SUPERADMIN && simulatedRole !== null;

  const NavItem = ({ to, icon: Icon, label, matchPaths }: { to: string, icon: any, label: string, matchPaths?: string[] }) => {
    const active = matchPaths
      ? matchPaths.some(p => isActive(p))
      : isActive(to);
    return (
      <Link
        to={to}
        onClick={() => setIsOpen(false)}
        className={`flex items-center ${collapsed ? 'justify-center px-2 py-3' : 'space-x-3 px-4 py-3'} rounded-lg mb-1 transition-colors ${
          active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-100'
        }`}
        title={collapsed ? label : undefined}
      >
        <Icon size={20} />
        {!collapsed && <span>{label}</span>}
      </Link>
    );
  };

  const CollapsibleNavGroup = ({
    groupId,
    icon: Icon,
    label,
    children
  }: {
    groupId: string;
    icon: any;
    label: string;
    children: React.ReactNode;
  }) => {
    const isGroupOpen = openGroups[groupId] || false;

    if (collapsed) {
      // When collapsed, show just the icon that expands on click
      return (
        <div className="mb-1">
          <button
            onClick={() => toggleGroup(groupId)}
            className={`w-full flex items-center justify-center px-2 py-3 rounded-lg transition-colors ${
              isGroupOpen ? 'bg-slate-100 text-slate-800' : 'text-slate-600 hover:bg-slate-100'
            }`}
            title={label}
          >
            <Icon size={20} />
          </button>
          {isGroupOpen && <div className="mt-1">{children}</div>}
        </div>
      );
    }

    return (
      <div className="mb-1">
        <button
          onClick={() => toggleGroup(groupId)}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
            isGroupOpen ? 'bg-slate-100 text-slate-800' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center space-x-3">
            <Icon size={20} />
            <span>{label}</span>
          </div>
          <ChevronDown
            size={16}
            className={`transform transition-transform duration-200 ${isGroupOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {isGroupOpen && (
          <div className="ml-4 mt-1 border-l-2 border-slate-200 pl-2">
            {children}
          </div>
        )}
      </div>
    );
  };

  // Role switcher for SuperAdmin
  const RoleSwitcher = ({ roles, returnLabel }: { roles: { role: Role; label: string; icon: any }[]; returnLabel: string }) => {
    if (collapsed) return null;
    return (
      <div className="px-4 py-2 mb-2">
        <div className="relative">
          <button
            onClick={() => setShowRoleSwitcher(!showRoleSwitcher)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border ${
              simulatedRole
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-slate-50 border-slate-200 text-slate-600'
            } hover:bg-slate-100 transition-colors`}
          >
            <div className="flex items-center space-x-2">
              <RefreshCw size={16} className={simulatedRole ? 'text-amber-600' : 'text-slate-400'} />
              <span className="text-sm font-medium">
                {simulatedRole ? `Tryb: ${ROLE_LABELS[simulatedRole]}` : 'Przełącz rolę'}
              </span>
            </div>
            <ChevronDown size={16} className={`transform transition-transform ${showRoleSwitcher ? 'rotate-180' : ''}`} />
          </button>

          {showRoleSwitcher && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
              {simulatedRole && (
                <button
                  onClick={() => {
                    setSimulatedRole(null);
                    setShowRoleSwitcher(false);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 border-b border-slate-100"
                >
                  <ShieldCheck size={16} />
                  <span>{returnLabel}</span>
                </button>
              )}
              {roles.map(({ role, label, icon: Icon }) => (
                <button
                  key={role}
                  onClick={() => {
                    setSimulatedRole(role);
                    setShowRoleSwitcher(false);
                  }}
                  className={`w-full flex items-center space-x-2 px-3 py-2 text-sm hover:bg-slate-50 ${
                    simulatedRole === role ? 'bg-amber-50 text-amber-700' : 'text-slate-600'
                  }`}
                >
                  <Icon size={16} />
                  <span>Pracuj jako {label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {simulatedRole && (
          <p className="text-xs text-amber-600 mt-1 px-1">
            Aktywny tryb symulacji roli
          </p>
        )}
      </div>
    );
  };

  const isCompanyAdminSimulating = currentUser?.role === Role.COMPANY_ADMIN && simulatedRole !== null;

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 bottom-0 bg-white border-r border-slate-200 z-50 transform transition-all duration-300 lg:translate-x-0 ${collapsed ? 'w-16' : 'w-64'} ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className={`h-16 flex items-center ${collapsed ? 'px-3 justify-center' : 'px-6'} border-b border-slate-100`}>
          {collapsed ? (
            <button onClick={() => setCollapsed?.(false)} className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold hover:bg-blue-700 transition" title="Rozwiń menu">
              M
            </button>
          ) : (
            <>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">M</div>
                <span className="text-lg font-bold text-slate-800">MaxMaster</span>
              </div>
              <button onClick={() => setCollapsed?.(true)} className="ml-auto hidden lg:flex p-1 hover:bg-slate-100 rounded text-slate-400" title="Zwiń menu">
                <ChevronsLeft size={18} />
              </button>
              <button onClick={() => setIsOpen(false)} className="ml-auto lg:hidden text-slate-500">
                <X size={24} />
              </button>
            </>
          )}
        </div>

        <div className={`${collapsed ? 'p-2' : 'p-4'} overflow-y-auto h-[calc(100vh-4rem)] flex flex-col ${collapsed ? 'items-center' : ''}`}>
          <div className="mb-6">

            {/* --- SUPERADMIN VIEW --- */}
            {currentUser?.role === Role.SUPERADMIN && !simulatedRole && (
               <>
                 <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>Super Admin</p>
                 <NavItem to="/superadmin/dashboard" icon={LayoutDashboard} label="Dashboard" />
                 <NavItem to="/superadmin/users" icon={Users} label="Użytkownicy" />
                 <NavItem to="/superadmin/companies" icon={Building2} label="Firmy" />
                 <div className="my-2 border-t border-slate-100"></div>
                 <NavItem to="/superadmin/settings" icon={Settings} label="Ustawienia" />
               </>
            )}

            {/* --- SUPERADMIN ROLE SWITCHER --- */}
            {currentUser?.role === Role.SUPERADMIN && (
              <>
                <div className="my-3 border-t border-slate-100"></div>
                <RoleSwitcher
                  roles={[
                    { role: Role.SALES, label: 'Sales', icon: Target },
                    { role: Role.DORADCA, label: 'Doradca', icon: GraduationCap },
                  ]}
                  returnLabel="Powrót do SuperAdmin"
                />
                <div className="my-2 border-t border-slate-100"></div>
              </>
            )}

            {/* Show simulated role menu or actual role menu */}

            {/* --- SALES VIEW (or SuperAdmin simulating Sales) --- */}
            {(effectiveRole === Role.SALES || (isSuperAdminSimulating && simulatedRole === Role.SALES)) && (
               <>
                 <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>
                   Sales CRM {isSuperAdminSimulating && <span className="text-amber-500">(tryb)</span>}
                 </p>
                 <NavItem to="/sales/dashboard" icon={LayoutDashboard} label="Dashboard" />
                 <NavItem to="/sales/pipeline" icon={Target} label="CRM" />
                 <NavItem to="/sales/activities" icon={CheckSquare} label="Zadania" />
                 <div className="my-2 border-t border-slate-100"></div>
                 <NavItem to="/sales/companies" icon={Building2} label="Firmy" />
                 <NavItem to="/sales/contacts" icon={UserCheck} label="Kontakty" />
               </>
            )}

            {/* --- DORADCA (CONSULTANT) VIEW (or SuperAdmin simulating Doradca) --- */}
            {(effectiveRole === Role.DORADCA || (isSuperAdminSimulating && simulatedRole === Role.DORADCA)) && (
               <>
                 <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>
                   Doradca {isSuperAdminSimulating && <span className="text-amber-500">(tryb)</span>}
                 </p>
                 <NavItem to="/doradca/dashboard" icon={LayoutDashboard} label="Panel Doradcy" />
                 <NavItem to="/doradca/companies" icon={Building2} label="Firmy klientów" />
               </>
            )}

            {/* --- HR VIEW (or SuperAdmin/CompanyAdmin simulating HR) --- */}
            {(effectiveRole === Role.HR || (isSuperAdminSimulating && simulatedRole === Role.HR) || (isCompanyAdminSimulating && simulatedRole === Role.HR)) && (
               <>
                 <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>
                   Panel HR {(isSuperAdminSimulating || isCompanyAdminSimulating) && <span className="text-amber-500">(tryb)</span>}
                 </p>
                 <NavItem to="/hr/dashboard" icon={Layers} label="Dashboard" />
                 <div className="my-2 border-t border-slate-100"></div>
                 <CollapsibleNavGroup groupId="hr-rekrutacja" icon={UserPlus} label="Rekrutacja">
                   <NavItem to="/hr/candidates" icon={UserPlus} label="Kandydaci" />
                   <NavItem to="/hr/trial" icon={Clock} label="Okres próbny" />
                 </CollapsibleNavGroup>
                 <NavItem to="/hr/employees" icon={Users} label="Pracownicy" />
                 <div className="my-2 border-t border-slate-100"></div>
                 <NavItem to="/company/attendance" icon={ClipboardList} label="Obecności" matchPaths={['/company/team-now', '/employee/attendance', '/company/attendance']} />
                 <NavItem to="/company/time-off" icon={CalendarDays} label="Urlopy" />
                 <NavItem to="/company/schedules" icon={CalendarRange} label="Grafiki" />
                 <NavItem to="/company/projects" icon={FolderKanban} label="Projekty" matchPaths={['/company/projects', '/company/tasks', '/company/customers']} />
                 <div className="my-2 border-t border-slate-100"></div>
                 <CollapsibleNavGroup groupId="hr-umiejetnosci" icon={Award} label="Umiejętności">
                   <NavItem to="/hr/documents" icon={FileText} label="Dokumenty" />
                   <NavItem to="/hr/tests" icon={FileCheck} label="Testy" />
                   <NavItem to="/hr/skills" icon={Award} label="Umiejętności" />
                   <NavItem to="/hr/library" icon={BookOpen} label="Baza wiedzy" />
                 </CollapsibleNavGroup>
                 <div className="my-2 border-t border-slate-100"></div>
                 <NavItem to="/company/reports" icon={BarChart3} label="Raporty" />
                 <NavItem to="/hr/reports" icon={PieChart} label="Raporty HR" />
                 <div className="my-2 border-t border-slate-100"></div>
                 <CollapsibleNavGroup groupId="hr-construction" icon={HardHat} label="Budowlanka">
                   <NavItem to="/construction/estimates" icon={Calculator} label="Kosztorys" />
                   <NavItem to="/construction/offers" icon={FileSpreadsheet} label="Ofertowanie" />
                   <NavItem to="/construction/drawings" icon={PenTool} label="Plany i rzuty" />
                   <NavItem to="/construction/dms" icon={FolderOpen} label="Dokumenty" />
                   <NavItem to="/construction/gantt" icon={GanttChartSquare} label="Harmonogram" />
                   <NavItem to="/construction/finance" icon={Wallet} label="Finanse" />
                   <NavItem to="/construction/procurement" icon={ShoppingCart} label="Zaopatrzenie" />
                   <NavItem to="/construction/approvals" icon={ClipboardCheck} label="Uzgodnienia" />
                 </CollapsibleNavGroup>
                 <div className="my-2 border-t border-slate-100"></div>
                 <NavItem to="/hr/settings" icon={Settings} label="Ustawienia" />
               </>
            )}

            {/* --- COMPANY ADMIN VIEW --- */}
            {currentUser?.role === Role.COMPANY_ADMIN && !simulatedRole && (
               <>
                 <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>Admin Firmy</p>
                 <NavItem to="/company/dashboard" icon={LayoutDashboard} label="Dashboard" />
                 <NavItem to="/company/users" icon={Users} label="Użytkownicy" />
                 <NavItem to="/company/departments" icon={Building2} label="Obiekty" />
                 <div className="my-2 border-t border-slate-100"></div>
                 <NavItem to="/company/attendance" icon={ClipboardList} label="Obecności" matchPaths={['/company/team-now', '/employee/attendance', '/company/attendance']} />
                 <NavItem to="/company/time-off" icon={CalendarDays} label="Urlopy" matchPaths={['/employee/time-off', '/company/time-off']} />
                 <NavItem to="/company/schedules" icon={CalendarRange} label="Grafiki" matchPaths={['/employee/schedule', '/company/schedules']} />
                 <NavItem to="/company/projects" icon={FolderKanban} label="Projekty" matchPaths={['/employee/tasks', '/company/tasks', '/company/projects']} />
                 <div className="my-2 border-t border-slate-100"></div>
                 <NavItem to="/company/reports" icon={BarChart3} label="Raporty" />
                 <div className="my-2 border-t border-slate-100"></div>
                 <CollapsibleNavGroup groupId="construction-modules" icon={HardHat} label="Budowlanka">
                   <NavItem to="/construction/estimates" icon={Calculator} label="Kosztorys" />
                   <NavItem to="/construction/offers" icon={FileSpreadsheet} label="Ofertowanie" />
                   <NavItem to="/construction/drawings" icon={PenTool} label="Plany i rzuty" />
                   <NavItem to="/construction/dms" icon={FolderOpen} label="Dokumenty" />
                   <NavItem to="/construction/gantt" icon={GanttChartSquare} label="Harmonogram" />
                   <NavItem to="/construction/finance" icon={Wallet} label="Finanse" />
                   <NavItem to="/construction/procurement" icon={ShoppingCart} label="Zaopatrzenie" />
                   <NavItem to="/construction/approvals" icon={ClipboardCheck} label="Uzgodnienia" />
                 </CollapsibleNavGroup>
                 <div className="my-2 border-t border-slate-100"></div>
                 <NavItem to="/company/subscription" icon={DollarSign} label="Subskrypcja" />
                 <NavItem to="/company/referrals" icon={Gift} label="Program Poleceń" />
                 <NavItem to="/company/settings" icon={Settings} label="Ustawienia" />

                 {/* Trial Period Banner - only for companies without previous subscriptions */}
                 {isEligibleForTrial && (
                   <div className="mt-4 mx-2">
                     <Link
                       to="/company/subscription"
                       onClick={() => setIsOpen(false)}
                       className="block"
                     >
                       <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 p-[1px]">
                         <div className="relative rounded-[11px] bg-gradient-to-br from-violet-500/10 via-purple-500/10 to-fuchsia-500/10 backdrop-blur-sm p-3">
                           <div className="flex items-start gap-2.5">
                             <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center">
                               <Gift className="w-4 h-4 text-white" />
                             </div>
                             <div className="flex-1 min-w-0">
                               <p className="text-xs font-bold text-white leading-tight">
                                 7 dni za darmo!
                               </p>
                               <p className="text-[10px] text-white/80 mt-0.5 leading-tight">
                                 Wypróbuj bez zobowiązań
                               </p>
                             </div>
                           </div>
                           <div className="mt-2 flex items-center justify-between">
                             <span className="text-[10px] text-white/70">Aktywuj teraz</span>
                             <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                               <ChevronDown className="w-3 h-3 text-white -rotate-90" />
                             </div>
                           </div>
                         </div>
                       </div>
                     </Link>
                   </div>
                 )}
               </>
            )}

            {/* --- COMPANY ADMIN ROLE SWITCHER --- */}
            {currentUser?.role === Role.COMPANY_ADMIN && (
              <>
                <div className="my-3 border-t border-slate-100"></div>
                <RoleSwitcher
                  roles={[
                    { role: Role.HR, label: 'HR Manager', icon: UserPlus },
                    { role: Role.BRIGADIR, label: 'Brygadzista', icon: Briefcase },
                    { role: Role.COORDINATOR, label: 'Koordynator', icon: Network },
                  ]}
                  returnLabel="Powrót do Admin Firmy"
                />
                <div className="my-2 border-t border-slate-100"></div>
              </>
            )}

            {/* --- ADMIN VIEW (TECHNICAL / LEGACY) --- */}
            {currentUser?.role === Role.ADMIN && (
               <>
                 <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>Panel Techniczny</p>
                 <NavItem to="/admin/users" icon={Users} label="Zarządzanie Kontami" />
               </>
            )}

            {/* --- COORDINATOR VIEW (or CompanyAdmin simulating Coordinator) --- */}
            {(currentUser?.role === Role.COORDINATOR || (isCompanyAdminSimulating && simulatedRole === Role.COORDINATOR)) && (
                <>
                    <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>
                      Koordynator {isCompanyAdminSimulating && <span className="text-amber-500">(tryb)</span>}
                    </p>
                    <NavItem to="/coordinator/dashboard" icon={LayoutDashboard} label="Dashboard" />
                    <NavItem to="/coordinator/employees" icon={Users} label="Pracownicy" />
                    <NavItem to="/company/departments" icon={Building2} label="Obiekty" />
                    <NavItem to="/coordinator/verifications" icon={CheckSquare} label="Weryfikacje Praktyki" />
                    <NavItem to="/coordinator/quality" icon={AlertTriangle} label="Zgłoszenia jakości" />
                    <div className="my-2 border-t border-slate-100"></div>
                    <NavItem to="/company/attendance" icon={ClipboardList} label="Obecności" matchPaths={['/company/team-now', '/employee/attendance', '/company/attendance']} />
                    <NavItem to="/company/time-off" icon={CalendarDays} label="Urlopy" matchPaths={['/employee/time-off', '/company/time-off']} />
                    <NavItem to="/company/schedules" icon={CalendarRange} label="Grafiki" matchPaths={['/employee/schedule', '/company/schedules']} />
                    <NavItem to="/company/projects" icon={FolderKanban} label="Projekty" matchPaths={['/employee/tasks', '/company/tasks', '/company/projects']} />
                    <div className="my-2 border-t border-slate-100"></div>
                    <CollapsibleNavGroup groupId="coordinator-umiejetnosci" icon={Award} label="Umiejętności">
                      <NavItem to="/coordinator/skills" icon={Award} label="Umiejętności i uprawnienia" />
                      <NavItem to="/coordinator/library" icon={BookOpen} label="Baza wiedzy" />
                    </CollapsibleNavGroup>
                    <div className="my-2 border-t border-slate-100"></div>
                    <CollapsibleNavGroup groupId="coordinator-construction" icon={HardHat} label="Budowlanka">
                      <NavItem to="/construction/drawings" icon={PenTool} label="Plany i rzuty" />
                      <NavItem to="/construction/dms" icon={FolderOpen} label="Dokumenty" />
                      <NavItem to="/construction/gantt" icon={GanttChartSquare} label="Harmonogram" />
                      <NavItem to="/construction/procurement" icon={ShoppingCart} label="Zaopatrzenie" />
                      <NavItem to="/construction/approvals" icon={ClipboardCheck} label="Uzgodnienia" />
                    </CollapsibleNavGroup>
                    <NavItem to="/coordinator/profile" icon={User} label="Mój Profil" />
                </>
            )}

            {/* --- CANDIDATE VIEW --- */}
            {currentUser?.role === Role.CANDIDATE && (
                <>
                    <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>Kandydat</p>
                    <NavItem to="/candidate/dashboard" icon={Home} label="Panel Główny" />
                    <NavItem to="/candidate/profile" icon={User} label="Mój Profil" />
                </>
            )}

            {/* --- TRIAL EMPLOYEE VIEW --- */}
            {currentUser?.status === UserStatus.TRIAL && (
                <>
                    <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>Okres Próbny</p>
                    <NavItem to="/trial/dashboard" icon={Clock} label="Mój Okres Próbny" />
                    <NavItem to="/trial/skills" icon={Award} label="Umiejętności i Uprawnienia" />
                    <NavItem to="/trial/quality" icon={AlertTriangle} label="Historia Jakości" />
                    <NavItem to="/trial/library" icon={BookOpen} label="Biblioteka" />
                    <NavItem to="/trial/career" icon={Briefcase} label="Rozwój Zawodowy" />
                    <NavItem to="/trial/referrals" icon={UserPlus} label="Zaproś znajomego" />
                    <NavItem to="/trial/profile" icon={User} label="Mój Profil" />
                </>
            )}

            {/* --- BRIGADIR VIEW (CompanyAdmin simulating Brigadir) --- */}
            {(isCompanyAdminSimulating && simulatedRole === Role.BRIGADIR) && (
                <>
                    <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>
                      Brygadzista <span className="text-amber-500">(tryb)</span>
                    </p>
                    <NavItem to="/brigadir/dashboard" icon={LayoutDashboard} label="Panel Zarządzania" />
                    <NavItem to="/brigadir/checks" icon={CheckSquare} label="Weryfikacje praktyki" />
                    <NavItem to="/brigadir/quality" icon={AlertTriangle} label="Zgłoszenia Jakości" />
                    <NavItem to="/brigadir/team" icon={Users} label="Mój Zespół" />
                    <div className="my-2 border-t border-slate-100"></div>
                    <NavItem to="/company/attendance" icon={ClipboardList} label="Obecności" matchPaths={['/employee/attendance', '/company/team-now', '/company/attendance']} />
                    <NavItem to="/company/time-off" icon={CalendarDays} label="Urlopy" matchPaths={['/employee/time-off', '/company/time-off']} />
                    <div className="my-2 border-t border-slate-100"></div>
                    <CollapsibleNavGroup groupId="brigadir-construction" icon={HardHat} label="Budowlanka">
                      <NavItem to="/construction/drawings" icon={PenTool} label="Plany i rzuty" />
                      <NavItem to="/construction/dms" icon={FolderOpen} label="Dokumenty" />
                      <NavItem to="/construction/procurement" icon={ShoppingCart} label="Zaopatrzenie" />
                      <NavItem to="/construction/approvals" icon={ClipboardCheck} label="Uzgodnienia" />
                    </CollapsibleNavGroup>
                </>
            )}

            {/* --- FULL EMPLOYEE VIEW (POST-TRIAL) --- */}
            {((currentUser?.role === Role.EMPLOYEE || currentUser?.role === Role.BRIGADIR) && currentUser?.status !== UserStatus.TRIAL) && (
              <>
                {/* --- BRIGADIR VIEW EXTENSION --- */}
                {currentUser?.role === Role.BRIGADIR && (
                  <>
                    <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>Brygadzista</p>
                    <NavItem to="/brigadir/dashboard" icon={LayoutDashboard} label="Panel Zarządzania" />
                    <NavItem to="/brigadir/checks" icon={CheckSquare} label="Weryfikacje praktyki" />
                    <NavItem to="/brigadir/quality" icon={AlertTriangle} label="Zgłoszenia Jakości" />
                    <NavItem to="/brigadir/team" icon={Users} label="Mój Zespół" />
                    <div className="my-4 border-t border-slate-100"></div>
                    <NavItem to="/company/attendance" icon={ClipboardList} label="Obecności" matchPaths={['/employee/attendance', '/company/team-now', '/company/attendance']} />
                    <NavItem to="/company/time-off" icon={CalendarDays} label="Urlopy" matchPaths={['/employee/time-off', '/company/time-off']} />
                    <div className="my-2 border-t border-slate-100"></div>
                    <CollapsibleNavGroup groupId="brigadir-real-construction" icon={HardHat} label="Budowlanka">
                      <NavItem to="/construction/drawings" icon={PenTool} label="Plany i rzuty" />
                      <NavItem to="/construction/dms" icon={FolderOpen} label="Dokumenty" />
                      <NavItem to="/construction/procurement" icon={ShoppingCart} label="Zaopatrzenie" />
                      <NavItem to="/construction/approvals" icon={ClipboardCheck} label="Uzgodnienia" />
                    </CollapsibleNavGroup>
                  </>
                )}

                {/* --- REGULAR EMPLOYEE (non-brigadir) --- */}
                {currentUser?.role === Role.EMPLOYEE && (
                  <>
                    <p className={`text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-4 ${collapsed ? 'hidden' : ''}`}>Pracownik</p>

                    <NavItem to="/dashboard" icon={LayoutDashboard} label="Panel Pracownika" />
                    <div className="my-2 border-t border-slate-100"></div>
                    <NavItem to="/employee/attendance" icon={Clock} label="Czas pracy" />
                    <NavItem to="/employee/time-off" icon={CalendarOff} label="Moje urlopy" />
                    <NavItem to="/employee/schedule" icon={CalendarClock} label="Mój grafik" />
                    <NavItem to="/employee/tasks" icon={CheckSquare} label="Moje zadania" />
                    <NavItem to="/construction/dms" icon={FolderOpen} label="Dokumenty" />
                  </>
                )}
                <div className="my-2 border-t border-slate-100"></div>
                <CollapsibleNavGroup groupId="employee-umiejetnosci" icon={Award} label="Umiejętności">
                  <NavItem to="/dashboard/skills" icon={Award} label="Umiejętności i uprawnienia" />
                  <NavItem to="/dashboard/library" icon={BookOpen} label="Baza wiedzy" />
                  <NavItem to="/dashboard/quality" icon={AlertTriangle} label="Historia jakości" />
                </CollapsibleNavGroup>
                <NavItem to="/dashboard/career" icon={Briefcase} label="Rozwój Zawodowy" />
                <NavItem to="/dashboard/referrals" icon={UserPlus} label="Zaproś znajomego" />
                <NavItem to="/dashboard/profile" icon={User} label="Mój Profil" />
              </>
            )}

          </div>

          <div className="mt-auto pt-4 border-t border-slate-100">
             {collapsed ? (
               <div className="flex flex-col items-center gap-2">
                 <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-bold text-sm" title={`${currentUser?.first_name} ${currentUser?.last_name}`}>
                   {currentUser?.first_name?.[0]}
                 </div>
                 <button onClick={logout} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Wyloguj się">
                   <LogOut size={18} />
                 </button>
               </div>
             ) : (
             <>
             <div className={`px-4 py-3 rounded-lg mb-4 ${(isSuperAdminSimulating || isCompanyAdminSimulating) ? 'bg-amber-50' : 'bg-slate-50'}`}>
                <p className="text-sm font-medium text-slate-900">{currentUser?.first_name} {currentUser?.last_name}</p>
                <p className="text-xs text-slate-500 capitalize">
                    {isSuperAdminSimulating
                      ? <span className="text-amber-600">SuperAdmin → {ROLE_LABELS[simulatedRole!]}</span>
                      : isCompanyAdminSimulating
                      ? <span className="text-amber-600">Admin Firmy → {ROLE_LABELS[simulatedRole!]}</span>
                      : (currentUser?.target_position || ROLE_LABELS[currentUser?.role || Role.EMPLOYEE])
                    }
                </p>
             </div>
            <button onClick={logout} className="flex w-full items-center space-x-3 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <LogOut size={20} />
              <span>Wyloguj się</span>
            </button>
            </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
