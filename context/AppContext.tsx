
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, SUPABASE_ANON_KEY } from '../lib/supabase';
import { sendTemplatedSMS } from '../lib/smsService';
import { createShortLink } from '../lib/shortLinks';
import { APP_URL } from '../config/app.config';
import {
  User, UserSkill, Skill, Test, TestAttempt, SystemConfig,
  AppNotification, NotificationSetting, Position, CandidateHistoryEntry,
  QualityIncident, EmployeeNote, EmployeeBadge, MonthlyBonus, LibraryResource,
  Role, UserStatus, SkillStatus, ContractType, VerificationType, NoteCategory, BadgeType, SkillCategory,
  Company, Module, CompanyModule, ModuleUserAccess, PaymentHistory,
  CRMCompany, CRMContact, CRMDeal, CRMActivity, DealStage
} from '../types';

interface AppState {
  currentUser: User | null;
  currentCompany: Company | null;
  users: User[];
  userSkills: UserSkill[];
  skills: Skill[];
  tests: Test[];
  testAttempts: TestAttempt[];
  candidateHistory: CandidateHistoryEntry[];
  appNotifications: AppNotification[];
  systemConfig: SystemConfig;
  notificationSettings: NotificationSetting[];
  positions: Position[];
  monthlyBonuses: Record<string, MonthlyBonus>;
  qualityIncidents: QualityIncident[];
  employeeNotes: EmployeeNote[];
  employeeBadges: EmployeeBadge[];
  toast: { title: string, message: string } | null;
  libraryResources: LibraryResource[];

  // Multi-company data
  companies: Company[];
  modules: Module[];
  companyModules: CompanyModule[];
  moduleUserAccess: ModuleUserAccess[];
  paymentHistory: PaymentHistory[];

  // CRM data (Sales module)
  crmCompanies: CRMCompany[];
  crmContacts: CRMContact[];
  crmDeals: CRMDeal[];
  crmActivities: CRMActivity[];

  // SuperAdmin role simulation
  simulatedRole: Role | null;

  // Misc
  language: string;
  allUsers: User[];
}

interface AppContextType {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshData: () => Promise<void>;
  loginAsUser: (user: User) => void;
  addUser: (userData: any) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  updateUser: (id: string, updates: any) => Promise<void>;
  addCandidate: (userData: Partial<User>) => Promise<User>;
  moveCandidateToTrial: (id: string, config: any) => Promise<void>;
  logCandidateAction: (candidateId: string, action: string) => Promise<void>;
  resetTestAttempt: (testId: string, userId: string) => Promise<void>;
  addCandidateDocument: (userId: string, docData: any) => Promise<void>;
  updateCandidateDocumentDetails: (docId: string, updates: any) => Promise<void>;
  updateUserSkillStatus: (userSkillId: string, status: SkillStatus, reason?: string) => Promise<void>;
  archiveCandidateDocument: (docId: string) => Promise<void>;
  restoreCandidateDocument: (docId: string) => Promise<void>;
  hireCandidate: (userId: string, hiredDate: string, contractEndDate?: string) => Promise<void>;
  triggerNotification: (type: string, title: string, message: string, link?: string) => void;
  assignBrigadir: (userId: string, brigadirId: string) => Promise<void>;
  resetSkillProgress: (userId: string, skillId: string, mode: 'theory' | 'practice' | 'both') => Promise<void>;
  addEmployeeNote: (note: any) => Promise<void>;
  deleteEmployeeNote: (id: string) => Promise<void>;
  payReferralBonus: (userId: string) => Promise<void>;
  addSkill: (skill: Omit<Skill, 'id'>) => Promise<Skill>;
  updateSkill: (id: string, skill: Partial<Skill>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  addLibraryResource: (res: LibraryResource) => Promise<void>;
  updateLibraryResource: (id: string, res: Partial<LibraryResource>) => Promise<void>;
  deleteLibraryResource: (id: string) => Promise<void>;
  addTest: (test: Omit<Test, 'id'>) => Promise<void>;
  updateTest: (id: string, test: Partial<Test>) => Promise<void>;
  startTest: (skillId: string) => void;
  submitTest: (testId: string, answers: number[][], score: number, passed: boolean) => Promise<void>;
  updateSystemConfig: (config: SystemConfig) => Promise<void>;
  updateNotificationSettings: (settings: NotificationSetting[]) => Promise<void>;
  addPosition: (pos: Omit<Position, 'id'>) => Promise<void>;
  updatePosition: (id: string, pos: Partial<Position>) => Promise<void>;
  deletePosition: (id: string) => Promise<void>;
  reorderPositions: (positions: Position[]) => Promise<void>;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  clearToast: () => void;
  inviteFriend: (firstName: string, lastName: string, phone: string, targetPosition: string) => void;
  confirmSkillPractice: (userSkillId: string, brigadirId: string) => Promise<void>;
  saveSkillChecklistProgress: (userSkillId: string, progress: any) => Promise<void>;
  addEmployeeBadge: (badge: any) => Promise<void>;
  deleteEmployeeBadge: (id: string) => Promise<void>;
  addQualityIncident: (incident: any) => Promise<void>;
  blockUser: (userId: string, reason?: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  updateUserWithPassword: (userId: string, updates: any, password?: string) => Promise<void>;
  deleteUserCompletely: (userId: string) => Promise<void>;

  // Multi-company methods
  addCompany: (company: Partial<Company>) => Promise<Company>;
  updateCompany: (id: string, updates: Partial<Company>) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;
  blockCompany: (id: string, reason?: string) => Promise<void>;
  unblockCompany: (id: string) => Promise<void>;
  processReferralBonus: (companyId: string, paymentAmount: number) => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  getCompanyUsers: (companyId: string) => User[];
  isGlobalUser: () => boolean;

  // Module access methods
  grantModuleAccess: (userId: string, moduleCode: string) => Promise<void>;
  revokeModuleAccess: (userId: string, moduleCode: string) => Promise<void>;
  autoGrantModuleAccessForCompany: (companyId: string, moduleCode: string) => Promise<void>;

  // SuperAdmin role simulation
  setSimulatedRole: (role: Role | null) => void;
  getEffectiveRole: () => Role | null;

  // CRM Deal methods
  addCrmDeal: (deal: Omit<CRMDeal, 'id' | 'created_at' | 'updated_at'>) => Promise<CRMDeal>;
  updateCrmDeal: (id: string, updates: Partial<CRMDeal>) => Promise<void>;
  deleteCrmDeal: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
};

// Logical identifier for main configuration
const CONFIG_KEY = 'main';

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  baseRate: 25,
  overtimeBonus: 3,
  holidayBonus: 5,
  seniorityBonus: 1,
  delegationBonus: 3,
  contractBonuses: { [ContractType.UOP]: 0, [ContractType.UZ]: 1, [ContractType.B2B]: 7 },
  studentBonus: 3,
  bonusDocumentTypes: [
      { id: 'sep_e', label: 'SEP E z pomiarami', bonus: 0.5 },
      { id: 'sep_d', label: 'SEP D z pomiarami', bonus: 0.5 },
      { id: 'udt_pod', label: 'UDT - Podnośniki (IP)', bonus: 1.0 },
      { id: 'bhp_szkol', label: 'Szkolenie BHP (Wstępne/Okresowe)', bonus: 0 },
      { id: 'badania', label: 'Orzeczenie Lekarskie (Wysokościowe)', bonus: 0 }
  ],
  bonusPermissionTypes: [],
  terminationReasons: ["Niesatysfakcjonujące wynagrodzenie", "Brak możliwości rozwoju", "Zła atmosfera w zespole", "Lepsza oferta konkurencji", "Przyczyny osobiste", "Niewywychodzenie z obowiązków", "Naruszenie regulaminu", "Inne"],
  positions: [],
  noteCategories: Object.values(NoteCategory),
  badgeTypes: Object.values(BadgeType),
  skillCategories: Object.values(SkillCategory), // Added dynamic source

  // Referral program defaults
  referralMinPaymentAmount: 100,
  referralBonusAmount: 50,

  // Sales config defaults
  salesMaxDiscountPercent: 15,
  salesMaxFreeExtensionDays: 14
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    currentUser: null,
    currentCompany: null,
    users: [],
    userSkills: [],
    skills: [],
    tests: [],
    testAttempts: [],
    candidateHistory: [],
    appNotifications: [],
    systemConfig: DEFAULT_SYSTEM_CONFIG,
    notificationSettings: [],
    positions: [],
    monthlyBonuses: {},
    qualityIncidents: [],
    employeeNotes: [],
    employeeBadges: [],
    toast: null,
    libraryResources: [],

    // Multi-company data
    companies: [],
    modules: [],
    companyModules: [],
    moduleUserAccess: [],
    paymentHistory: [],

    // CRM data
    crmCompanies: [],
    crmContacts: [],
    crmDeals: [],
    crmActivities: [],

    // SuperAdmin role simulation
    simulatedRole: null,

    // Global
    language: 'pl',
    allUsers: []
  });

  // Track if we're in the initial auth setup to prevent duplicate refreshData calls
  const isInitializingRef = React.useRef(true);

  const refreshData = useCallback(async () => {
    try {
      const [
        { data: users },
        { data: positions },
        { data: skills },
        { data: tests },
        { data: userSkills },
        { data: testAttempts },
        { data: history },
        { data: incidents },
        { data: notes },
        { data: badges },
        { data: resources },
        { data: configData },
        { data: companies },
        { data: modules },
        { data: companyModules },
        { data: moduleUserAccess },
        { data: paymentHistory },
        { data: crmCompanies },
        { data: crmContacts },
        { data: crmDeals },
        { data: crmActivities }
      ] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('positions').select('*').order('order'),
        supabase.from('skills').select('*'),
        supabase.from('tests').select('*'),
        supabase.from('user_skills').select('*'),
        supabase.from('test_attempts').select('*'),
        supabase.from('candidate_history').select('*'),
        supabase.from('quality_incidents').select('*'),
        supabase.from('employee_notes').select('*'),
        supabase.from('employee_badges').select('*'),
        supabase.from('library_resources').select('*'),
        supabase.from('system_config').select('config_data').eq('config_key', CONFIG_KEY).maybeSingle(),
        supabase.from('companies').select('*'),
        supabase.from('modules').select('*').order('display_order'),
        supabase.from('company_modules').select('*'),
        supabase.from('module_user_access').select('*'),
        supabase.from('payment_history').select('*').order('paid_at', { ascending: false }),
        supabase.from('crm_companies').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_contacts').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_deals').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_activities').select('*').order('scheduled_at', { ascending: true })
      ]);

      setState(prev => {
        // Update currentCompany with fresh data if it's set
        const updatedCurrentCompany = prev.currentCompany && companies
          ? companies.find((c: Company) => c.id === prev.currentCompany!.id) || prev.currentCompany
          : prev.currentCompany;

        return {
          ...prev,
          users: users || [],
          positions: positions || [],
          skills: skills || [],
          tests: tests || [],
          userSkills: userSkills || [],
          testAttempts: testAttempts || [],
          candidateHistory: history || [],
          qualityIncidents: incidents || [],
          employeeNotes: notes || [],
          employeeBadges: badges || [],
          libraryResources: (resources || []).map((r: any) => ({
            ...r,
            textContent: r.text_content ?? r.textContent ?? '',
            videoUrl: r.video_url ?? r.videoUrl ?? '',
            imageUrl: r.image_url ?? r.imageUrl ?? '',
          })),
          systemConfig: {
              ...DEFAULT_SYSTEM_CONFIG,
              ...(configData?.config_data || {})
          },
          companies: companies || [],
          currentCompany: updatedCurrentCompany,
          modules: modules || [],
          companyModules: companyModules || [],
          moduleUserAccess: moduleUserAccess || [],
          paymentHistory: paymentHistory || [],
          crmCompanies: crmCompanies || [],
          crmContacts: crmContacts || [],
          crmDeals: crmDeals || [],
          crmActivities: crmActivities || []
        };
      });
    } catch (err) {
      console.error('Error refreshing data from Supabase:', err);
    }
  }, []);

  // Refresh only system config (for real-time updates when HR changes settings)
  const refreshSystemConfig = useCallback(async () => {
    try {
      const { data: configData } = await supabase
        .from('system_config')
        .select('config_data')
        .eq('config_key', CONFIG_KEY)
        .maybeSingle();

      if (configData?.config_data) {
        setState(prev => ({
          ...prev,
          systemConfig: {
            ...DEFAULT_SYSTEM_CONFIG,
            ...configData.config_data
          }
        }));
      }
    } catch (err) {
      console.error('Error refreshing system config:', err);
    }
  }, []);

  // Listen for auth state changes and initial fetch
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        console.log('Initializing auth...');
        isInitializingRef.current = true;

        // Check if Doradca is viewing as another user (from new window)
        const viewAsUserData = localStorage.getItem('doradca_view_as_user');
        if (viewAsUserData) {
          try {
            const viewAsUser = JSON.parse(viewAsUserData);
            console.log('Doradca viewing as user:', viewAsUser.email);
            // Clear the storage immediately to prevent loops
            localStorage.removeItem('doradca_view_as_user');
            // Find user's company
            const { data: companies } = await supabase.from('companies').select('*');
            const userCompany = viewAsUser.company_id
              ? (companies || []).find((c: Company) => c.id === viewAsUser.company_id)
              : null;
            setState(prev => ({
              ...prev,
              currentUser: viewAsUser,
              currentCompany: userCompany || null,
              companies: companies || prev.companies
            }));
            console.log('Auth initialization complete (view as user mode)');
            isInitializingRef.current = false;
            // Load remaining data in background
            refreshData().catch(err => console.error('Background refresh error:', err));
            return; // Skip normal auth flow
          } catch (parseError) {
            console.error('Error parsing view as user data:', parseError);
            localStorage.removeItem('doradca_view_as_user');
          }
        }

        // Check for existing auth session FIRST (fast operation)
        // This lets the user navigate away from login page quickly
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          console.log('Existing session found, restoring user:', session.user.email);
          // Try to find user in database
          const { data: dbUser } = await supabase
            .from('users')
            .select('*')
            .eq('email', session.user.email)
            .maybeSingle();

          if (dbUser) {
            console.log('User found in database:', dbUser);
            // Find user's company
            const { data: companies } = await supabase.from('companies').select('*');
            const userCompany = dbUser.company_id
              ? (companies || []).find((c: Company) => c.id === dbUser.company_id)
              : null;
            setState(prev => ({
              ...prev,
              currentUser: dbUser,
              currentCompany: userCompany || null,
              companies: companies || prev.companies
            }));
          } else {
            // User authenticated but not in database - create record
            console.log('User authenticated but missing from database, creating record...');
            const newUserData = {
              id: session.user.id,
              email: session.user.email!,
              first_name: session.user.user_metadata?.first_name || 'Użytkownik',
              last_name: session.user.user_metadata?.last_name || '',
              role: session.user.user_metadata?.role || Role.EMPLOYEE,
              status: session.user.user_metadata?.status || UserStatus.ACTIVE,
              hired_date: new Date().toISOString()
            };

            const { data: createdUser, error: createError } = await supabase
              .from('users')
              .insert([newUserData])
              .select()
              .single();

            if (!createError && createdUser) {
              console.log('User record created successfully:', createdUser);
              setState(prev => ({ ...prev, currentUser: createdUser }));
            } else {
              console.error('Failed to create user record:', createError);
            }
          }
        }

        // Load all data AFTER session check (so user navigates away from login quickly)
        await refreshData();

        console.log('Auth initialization complete');
        isInitializingRef.current = false;
      } catch (error) {
        console.error('Error during auth initialization:', error);
        isInitializingRef.current = false;
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event);

      if (event === 'SIGNED_IN') {
        console.log('Handling SIGNED_IN event...');

        // Skip refreshData if we're still initializing (to prevent duplicate work)
        if (isInitializingRef.current) {
          console.log('Skipping SIGNED_IN handler during initialization');
          return;
        }

        // IMPORTANT: Defer refreshData to avoid deadlock with Supabase's internal lock.
        // onAuthStateChange callback runs inside the auth lock context, so making
        // Supabase calls here would deadlock (they need the same lock).
        // See: https://github.com/supabase/auth-js/issues/762
        setTimeout(() => {
          refreshData().catch(err => console.error('Error refreshing data after SIGNED_IN:', err));
        }, 0);
      } else if (event === 'SIGNED_OUT') {
        console.log('Handling SIGNED_OUT event...');
        setState(prev => ({ ...prev, currentUser: null, currentCompany: null }));
      }
      // Don't refresh on TOKEN_REFRESHED to avoid unnecessary requests
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshData]);

  // Auto-refresh system config every 30 seconds to sync HR settings changes
  useEffect(() => {
    const interval = setInterval(() => {
      refreshSystemConfig();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [refreshSystemConfig]);

  const login = async (email: string, password: string) => {
    console.log('Login: Attempting authentication for', email);

    // Wait for initialization to complete before attempting login
    // to avoid concurrent Supabase request contention
    if (isInitializingRef.current) {
      console.log('Login: Waiting for auth initialization to complete...');
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!isInitializingRef.current) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        // Safety timeout - don't wait forever
        setTimeout(() => { clearInterval(check); resolve(); }, 10000);
      });
      // If user was already set during init, no need to login again
      if (state.currentUser) {
        console.log('Login: User already authenticated during initialization, skipping');
        return;
      }
    }

    // First check if user exists and is not blocked (before authenticating)
    const { data: dbUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (dbUser?.is_blocked) {
      throw new Error(`Twoje konto zostało zablokowane. Powód: ${dbUser.blocked_reason || 'Skontaktuj się z administratorem.'}`);
    }

    // Authenticate - this will trigger onAuthStateChange which handles the rest
    console.log('Login: Authenticating with Supabase...');
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      console.error('Login: Authentication failed:', authError);
      throw authError;
    }

    console.log('Login: Authentication successful');

    // If user doesn't exist in database yet, create the record
    if (!dbUser && authData.user) {
      console.log('Login: User not in database, creating record...');
      const newUserData = {
        id: authData.user.id,
        email: authData.user.email!,
        first_name: authData.user.user_metadata?.first_name || 'Użytkownik',
        last_name: authData.user.user_metadata?.last_name || '',
        role: authData.user.user_metadata?.role || Role.EMPLOYEE,
        status: authData.user.user_metadata?.status || UserStatus.ACTIVE,
        hired_date: new Date().toISOString()
      };

      const { data: createdUser, error: createError } = await supabase
        .from('users')
        .insert([newUserData])
        .select()
        .single();

      if (createError) {
        console.error('Login: Error creating user record:', createError);
        await supabase.auth.signOut();
        throw new Error('Nie można utworzyć profilu użytkownika. Skontaktuj się z administratorem.');
      }

      console.log('Login: User record created successfully');
      setState(prev => ({ ...prev, currentUser: createdUser }));
    } else if (dbUser) {
      // Find user's company
      const userCompany = dbUser.company_id
        ? state.companies.find(c => c.id === dbUser.company_id)
        : null;
      setState(prev => ({
        ...prev,
        currentUser: dbUser,
        currentCompany: userCompany || null
      }));
    }

    // Eagerly refresh data so companyModules/moduleUserAccess are available
    // before ProtectedRoute runs the subscription check.
    // (onAuthStateChange defers refreshData via setTimeout, which causes a race condition)
    await refreshData();
  };

  const logout = async () => {
    setState(prev => ({ ...prev, currentUser: null, currentCompany: null }));
    await supabase.auth.signOut();
  };

  const loginAsUser = (user: User) => {
    setState(prev => ({ ...prev, currentUser: user }));
    refreshData();
  };

  const addUser = async (userData: any) => {
    const cleanEmail = userData.email.trim().toLowerCase();

    // Use edge function to create user server-side (prevents session swap on signUp)
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    if (!accessToken) {
      throw new Error('No active session. Please log in.');
    }

    const supabaseUrl = 'https://diytvuczpciikzdhldny.supabase.co';
    const response = await fetch(`${supabaseUrl}/functions/v1/create-user-admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        email: cleanEmail,
        password: userData.password || undefined,
        first_name: userData.first_name,
        last_name: userData.last_name,
        phone: userData.phone,
        role: userData.role,
        status: userData.status || UserStatus.ACTIVE,
        company_id: userData.company_id || state.currentUser?.company_id || null,
        is_global_user: userData.is_global_user || false
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to create user');
    }

    const createdUser = result.data;
    setState(prev => ({ ...prev, users: [...prev.users, createdUser] }));

    // Auto-grant module access if there are free seats
    if (createdUser.company_id) {
      await autoGrantAccessForNewUser(createdUser.id, createdUser.company_id);
    }
  };

  const deleteUser = async (id: string) => {
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    setState(prev => ({ ...prev, users: prev.users.filter(u => u.id !== id) }));
  };

  const updateUser = async (id: string, updates: any) => {
    const { data, error } = await supabase.from('users').update(updates).eq('id', id).select().single();
    if (error) throw error;
    setState(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === id ? { ...u, ...data } : u),
      currentUser: prev.currentUser?.id === id ? { ...prev.currentUser, ...data } : prev.currentUser
    }));
  };

  const addCandidate = async (userData: Partial<User>) => {
    // Call Edge Function to create candidate with auth user and send invitation email
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    if (!accessToken) {
      throw new Error('No active session. Please log in.');
    }

    const supabaseUrl = 'https://diytvuczpciikzdhldny.supabase.co';
    // Get company_id from current user or current company (HR belongs to a company)
    const companyId = state.currentUser?.company_id || state.currentCompany?.id || null;

    const response = await fetch(`${supabaseUrl}/functions/v1/create-candidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        phone: userData.phone,
        target_position: userData.target_position,
        source: userData.source || 'OLX',
        status: userData.status || UserStatus.STARTED,
        company_id: companyId
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to create candidate');
    }

    // Update local state with the created candidate
    const createdCandidate = result.data;
    setState(prev => ({ ...prev, users: [...prev.users, createdCandidate] }));

    // Auto-grant module access if there are free seats
    if (createdCandidate.company_id) {
      await autoGrantAccessForNewUser(createdCandidate.id, createdCandidate.company_id);
    }

    return createdCandidate;
  };

  const moveCandidateToTrial = async (id: string, config: any) => {
    const user = state.users.find(u => u.id === id);
    await updateUser(id, { status: UserStatus.TRIAL, role: Role.EMPLOYEE, ...config });

    // Auto-grant module access for the new employee role (e.g. Skills module)
    if (user?.company_id) {
      await autoGrantAccessForNewUser(id, user.company_id);
    }

    // Send SMS notification about trial start
    if (user?.phone && config.contract_end_date) {
      const trialEndDate = new Date(config.contract_end_date).toLocaleDateString('pl-PL');
      const brigadir = config.assigned_brigadir_id
        ? state.users.find(u => u.id === config.assigned_brigadir_id)
        : null;
      const hrName = brigadir ? `${brigadir.first_name} ${brigadir.last_name}` : 'HR';

      try {
        await sendTemplatedSMS(
          'TRIAL_START',
          user.phone,
          { firstName: user.first_name, trialEndDate, hrName },
          user.id
        );
      } catch (error) {
        console.error('Failed to send trial start SMS:', error);
      }
    }
  };

  const logCandidateAction = async (candidateId: string, action: string) => {
    const newEntry = {
      candidate_id: candidateId,
      action,
      performed_by: state.currentUser ? `${state.currentUser.first_name} ${state.currentUser.last_name}` : 'System'
    };
    const { data, error } = await supabase.from('candidate_history').insert([newEntry]).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, candidateHistory: [data, ...prev.candidateHistory] }));
  };

  const resetTestAttempt = async (testId: string, userId: string) => {
    const { error } = await supabase.from('test_attempts').delete().match({ test_id: testId, user_id: userId });
    if (error) throw error;
    setState(prev => ({
      ...prev,
      testAttempts: prev.testAttempts.filter(ta => !(ta.test_id === testId && ta.user_id === userId))
    }));
  };

  const addCandidateDocument = async (userId: string, docData: any) => {
    const { data, error } = await supabase.from('user_skills').insert([{ user_id: userId, ...docData }]).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, userSkills: [...prev.userSkills, data] }));
  };

  const updateCandidateDocumentDetails = async (docId: string, updates: any) => {
    const { data, error } = await supabase.from('user_skills').update(updates).eq('id', docId).select().single();
    if (error) throw error;
    setState(prev => ({
      ...prev,
      userSkills: prev.userSkills.map(us => us.id === docId ? { ...us, ...data } : us)
    }));
  };

  const updateUserSkillStatus = async (userSkillId: string, status: SkillStatus, reason?: string) => {
    const updates: any = { status, rejection_reason: reason };
    if (status === SkillStatus.CONFIRMED) updates.confirmed_at = new Date().toISOString();
    
    const { data, error } = await supabase.from('user_skills').update(updates).eq('id', userSkillId).select().single();
    if (error) throw error;
    
    setState(prev => ({
      ...prev,
      userSkills: prev.userSkills.map(us => us.id === userSkillId ? { ...us, ...data } : us)
    }));
  };

  const archiveCandidateDocument = async (docId: string) => {
    const { data, error } = await supabase.from('user_skills').update({ is_archived: true }).eq('id', docId).select().single();
    if (error) throw error;
    setState(prev => ({
      ...prev,
      userSkills: prev.userSkills.map(us => us.id === docId ? { ...us, ...data } : us)
    }));
  };

  const restoreCandidateDocument = async (docId: string) => {
    const { data, error } = await supabase.from('user_skills').update({ is_archived: false }).eq('id', docId).select().single();
    if (error) throw error;
    setState(prev => ({
      ...prev,
      userSkills: prev.userSkills.map(us => us.id === docId ? { ...us, ...data } : us)
    }));
  };

  const hireCandidate = async (userId: string, hiredDate: string, contractEndDate?: string) => {
    // When transitioning from TRIAL to ACTIVE, skills should apply immediately
    const user = state.users.find(u => u.id === userId);
    if (!user) return;

    // Get all CONFIRMED skills for this user
    const confirmedSkills = state.userSkills.filter(
      us => us.user_id === userId && us.status === SkillStatus.CONFIRMED && !us.is_archived
    );

    // Set effective_from to the exact hired date so skills apply immediately
    // This ensures the forecast rate applies from the day of transition to ACTIVE
    const hiredDateObj = new Date(hiredDate);
    const effectiveFromISO = hiredDateObj.toISOString();

    // Update effective_from for ALL confirmed skills (force update)
    // This ensures skills confirmed during TRIAL apply immediately when transitioning to ACTIVE
    for (const userSkill of confirmedSkills) {
      await supabase
        .from('user_skills')
        .update({ effective_from: effectiveFromISO })
        .eq('id', userSkill.id);
    }

    // Reset base_rate to null so that calculateSalary() uses systemConfig.baseRate
    // and calculates skills based on effective_from dates
    await updateUser(userId, {
      status: UserStatus.ACTIVE,
      hired_date: hiredDate,
      contract_end_date: contractEndDate,
      base_rate: null // Use system base rate + skills from effective_from
    });

    // Refresh data to ensure state is updated with new effective_from values
    await refreshData();
  };

  const triggerNotification = (type: string, title: string, message: string, link?: string) => {
    const newNotif: AppNotification = { id: crypto.randomUUID(), title, message, isRead: false, createdAt: new Date().toISOString(), link };
    setState(prev => ({ ...prev, appNotifications: [newNotif, ...prev.appNotifications], toast: { title, message } }));
  };

  const assignBrigadir = async (userId: string, brigadirId: string) => {
    await updateUser(userId, { assigned_brigadir_id: brigadirId });
  };

  const resetSkillProgress = async (userId: string, skillId: string, mode: 'theory' | 'practice' | 'both') => {
    const existing = state.userSkills.find(us => us.user_id === userId && us.skill_id === skillId);
    if (!existing) return;
    
    const updates: Partial<UserSkill> = {};
    if (mode === 'theory' || mode === 'both') {
      updates.theory_score = undefined;
      updates.status = SkillStatus.PENDING;
    }
    if (mode === 'practice' || mode === 'both') {
      updates.practice_date = undefined;
      updates.practice_checked_by = undefined;
      updates.checklist_progress = {};
      if (updates.status !== SkillStatus.PENDING) updates.status = SkillStatus.THEORY_PASSED;
    }

    const { data, error } = await supabase.from('user_skills').update(updates).eq('id', existing.id).select().single();
    if (error) throw error;

    setState(prev => ({
      ...prev,
      userSkills: prev.userSkills.map(us => us.id === existing.id ? { ...us, ...data } : us)
    }));
  };

  const addEmployeeNote = async (note: any) => {
    const { data, error } = await supabase.from('employee_notes').insert([note]).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, employeeNotes: [...prev.employeeNotes, data] }));
  };

  const deleteEmployeeNote = async (id: string) => {
    const { error } = await supabase.from('employee_notes').delete().eq('id', id);
    if (error) throw error;
    setState(prev => ({ ...prev, employeeNotes: prev.employeeNotes.filter(n => n.id !== id) }));
  };

  const payReferralBonus = async (userId: string) => {
    await updateUser(userId, { referral_bonus_paid: true, referral_bonus_paid_date: new Date().toISOString() });
  };

  const addSkill = async (skill: Omit<Skill, 'id'>) => {
    const { data, error } = await supabase.from('skills').insert([skill]).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, skills: [...prev.skills, data] }));
    return data; // Return the created skill
  };

  const updateSkill = async (id: string, skill: Partial<Skill>) => {
    const { data, error } = await supabase.from('skills').update(skill).eq('id', id).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, skills: prev.skills.map(s => s.id === id ? { ...s, ...data } : s) }));
  };

  const deleteSkill = async (id: string) => {
    const { error } = await supabase.from('skills').delete().eq('id', id);
    if (error) throw error;
    setState(prev => ({ ...prev, skills: prev.skills.filter(s => s.id !== id) }));
  };

  const addLibraryResource = async (res: LibraryResource) => {
    console.log('AppContext: inserting library resource...', res.title);

    // Transform camelCase to snake_case for Supabase
    const dbData = {
      id: res.id,
      title: res.title,
      description: res.description ?? '',
      type: res.type,
      category: res.category,
      categories: res.categories,
      skill_ids: res.skill_ids,
      url: res.url ?? '',
      video_url: res.videoUrl ?? '',
      image_url: res.imageUrl ?? '',
      text_content: res.textContent ?? '',
      file_urls: res.file_urls ?? [],
      is_archived: res.is_archived ?? false,
    };

    console.log('AppContext: insert data (transformed):', dbData);

    // Use fetch directly with timeout to prevent hanging
    const supabaseUrl = 'https://diytvuczpciikzdhldny.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpeXR2dWN6cGNpaWt6ZGhsZG55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMTcwOTMsImV4cCI6MjA4MjU5MzA5M30.8dd75VEY_6VbHWmpbDv4nyzlpyMU0XGAtq6cxBfSbQY';

    // Get current session token with timeout
    console.log('AppContext: getting session for insert...');
    let accessToken = supabaseKey;
    try {
      const sessionPromise = supabase.auth.getSession();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getSession timed out')), 10000)
      );
      const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]) as Awaited<typeof sessionPromise>;
      accessToken = session?.access_token || supabaseKey;
      console.log('AppContext: got session token for insert');
    } catch (sessionErr) {
      console.warn('AppContext: getSession failed for insert, using anon key:', sessionErr);
    }

    console.log('AppContext: starting insert fetch request...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/library_resources`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${accessToken}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(dbData),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);
      console.log('AppContext: insert fetch completed - status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('AppContext: insert error:', errorText);
        throw new Error(`Insert failed: ${response.status} ${errorText}`);
      }

      console.log('AppContext: insert success');
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('AppContext: insert timed out after 15s');
        throw new Error('Insert timed out');
      }
      console.error('AppContext: insert failed:', err);
      throw err;
    }

    // Use the resource we sent since ID is already generated client-side
    setState(prev => ({ ...prev, libraryResources: [...prev.libraryResources, res] }));
  };

  const updateLibraryResource = async (id: string, res: Partial<LibraryResource>) => {
    console.log('AppContext: updating library resource...', id);

    // Transform camelCase to snake_case for Supabase
    const dbData: Record<string, any> = {
      title: res.title,
      description: res.description ?? '',
      type: res.type,
      category: res.category,
      categories: res.categories,
      skill_ids: res.skill_ids,
      url: res.url ?? '',
      video_url: res.videoUrl ?? '',
      image_url: res.imageUrl ?? '',
      text_content: res.textContent ?? '',
      file_urls: res.file_urls ?? [],
      is_archived: res.is_archived,
    };

    // Remove undefined values
    Object.keys(dbData).forEach(key => {
      if (dbData[key] === undefined) delete dbData[key];
    });

    console.log('AppContext: update data (transformed):', dbData);

    // Use fetch directly to bypass Supabase client issues
    const supabaseUrl = 'https://diytvuczpciikzdhldny.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpeXR2dWN6cGNpaWt6ZGhsZG55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMTcwOTMsImV4cCI6MjA4MjU5MzA5M30.8dd75VEY_6VbHWmpbDv4nyzlpyMU0XGAtq6cxBfSbQY';

    // Get current session token with timeout
    console.log('AppContext: getting session...');
    let accessToken = supabaseKey;
    try {
      const sessionPromise = supabase.auth.getSession();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getSession timed out')), 10000)
      );
      const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]) as Awaited<typeof sessionPromise>;
      accessToken = session?.access_token || supabaseKey;
      console.log('AppContext: got session token');
    } catch (sessionErr) {
      console.warn('AppContext: getSession failed, using anon key:', sessionErr);
      // Continue with anon key
    }

    console.log('AppContext: starting fetch request...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/library_resources?id=eq.${id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${accessToken}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(dbData),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);
      console.log('AppContext: fetch completed - status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('AppContext: update error:', errorText);
        throw new Error(`Update failed: ${response.status} ${errorText}`);
      }

      console.log('AppContext: update success');
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('AppContext: update timed out after 15s');
        throw new Error('Update timed out');
      }
      console.error('AppContext: update failed:', err);
      throw err;
    }

    // Update local state
    setState(prev => ({ ...prev, libraryResources: prev.libraryResources.map(r => r.id === id ? { ...r, ...res } : r) }));
  };

  const deleteLibraryResource = async (id: string) => {
    const { error } = await supabase.from('library_resources').delete().eq('id', id);
    if (error) throw error;
    setState(prev => ({ ...prev, libraryResources: prev.libraryResources.filter(r => r.id !== id) }));
  };

  const addTest = async (test: Omit<Test, 'id'>) => {
    const { data, error } = await supabase.from('tests').insert([test]).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, tests: [...prev.tests, data] }));
  };

  const updateTest = async (id: string, test: Partial<Test>) => {
    const { data, error } = await supabase.from('tests').update(test).eq('id', id).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, tests: prev.tests.map(t => t.id === id ? { ...t, ...data } : t) }));
  };

  const startTest = (skillId: string) => {
    // Activity logging removed - only log test completion
  };

  const submitTest = async (testId: string, answers: number[][], score: number, passed: boolean) => {
    if (!state.currentUser) {
      console.error('submitTest: No current user');
      throw new Error('Nie można zapisać wyników testu: użytkownik nie zalogowany');
    }

    console.log('submitTest: Starting test submission', { testId, score, passed, userId: state.currentUser.id });

    const newAttempt = {
      user_id: state.currentUser.id,
      test_id: testId,
      score,
      passed,
      completed_at: new Date().toISOString()
    };

    console.log('submitTest: Inserting test attempt', newAttempt);
    const { data: attemptData, error: attemptError } = await supabase.from('test_attempts').insert([newAttempt]).select().single();
    if (attemptError) {
      console.error('submitTest: Error inserting test attempt:', attemptError);
      throw new Error(`Błąd podczas zapisywania próby testu: ${attemptError.message}`);
    }
    console.log('submitTest: Test attempt inserted successfully', attemptData);

    const test = state.tests.find(t => t.id === testId);
    // Fix: Safely check if skill_ids array has elements
    const skillId = Array.isArray(test?.skill_ids) && test.skill_ids.length > 0 ? test.skill_ids[0] : null;
    console.log('submitTest: Processing skill', { testTitle: test?.title, skillId });

    if (skillId) {
      const existingUs = state.userSkills.find(us => us.user_id === state.currentUser?.id && us.skill_id === skillId);
      const skill = state.skills.find(s => s.id === skillId);
      const newStatus = passed ? (skill?.verification_type === VerificationType.THEORY_ONLY ? SkillStatus.CONFIRMED : SkillStatus.THEORY_PASSED) : SkillStatus.FAILED;

      console.log('submitTest: Updating user skill', { existingUs: !!existingUs, newStatus });

      // Fix: Add error handling for user_skills operations
      if (existingUs) {
        const { error: updateError } = await supabase.from('user_skills').update({ status: newStatus, theory_score: score }).eq('id', existingUs.id);
        if (updateError) {
          console.error('submitTest: Error updating user_skills:', updateError);
          throw new Error(`Błąd podczas aktualizacji umiejętności: ${updateError.message}`);
        }
        console.log('submitTest: User skill updated successfully');
      } else {
        const { error: insertError } = await supabase.from('user_skills').insert([{ user_id: state.currentUser.id, skill_id: skillId, status: newStatus, theory_score: score }]);
        if (insertError) {
          console.error('submitTest: Error inserting user_skills:', insertError);
          throw new Error(`Błąd podczas tworzenia umiejętności: ${insertError.message}`);
        }
        console.log('submitTest: User skill inserted successfully');
      }

      const { data: refreshedSkills } = await supabase.from('user_skills').select('*').eq('user_id', state.currentUser.id);
      console.log('submitTest: Refreshing user skills', { count: refreshedSkills?.length });
      setState(prev => ({
        ...prev,
        testAttempts: [...prev.testAttempts, attemptData],
        userSkills: refreshedSkills || prev.userSkills
      }));
    } else {
      console.log('submitTest: No skill associated, only updating test attempts');
      // Even if no skill is associated, update testAttempts
      setState(prev => ({
        ...prev,
        testAttempts: [...prev.testAttempts, attemptData]
      }));
    }

    // Fix: Don't let logging errors fail the entire operation
    try {
      console.log('submitTest: Logging candidate action');
      await logCandidateAction(state.currentUser.id, `Zakończono test: ${test?.title || 'Nieznany'}. Wynik: ${score}%, ${passed ? 'ZALICZONY' : 'NIEZALICZONY'}`);
    } catch (logError) {
      console.error('submitTest: Error logging candidate action:', logError);
      // Don't throw - test results are already saved
    }

    console.log('submitTest: Test submission completed successfully');
  };

  const updateSystemConfig = async (config: SystemConfig) => {
    try {
      // payload includes config_key for conflict matching and config_value as a clone of config_data to satisfy NOT NULL
      const payload = {
        config_key: CONFIG_KEY,
        config_data: config,
        config_value: config
      };

      const { error } = await supabase
        .from('system_config')
        .upsert(payload, { onConflict: 'config_key' });

      if (error) throw error;
      setState(prev => ({ ...prev, systemConfig: config }));
    } catch (err) {
      console.error('Error saving system config:', err);
    }
  };

  const updateNotificationSettings = async (settings: NotificationSetting[]) => {
    setState(prev => ({ ...prev, notificationSettings: settings }));
  };

  const addPosition = async (pos: Omit<Position, 'id'>) => {
    const { data, error } = await supabase.from('positions').insert([pos]).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, positions: [...prev.positions, data] }));
  };

  const updatePosition = async (id: string, pos: Partial<Position>) => {
    const { data, error } = await supabase.from('positions').update(pos).eq('id', id).select().single();
    if (error) throw error;
    setState(prev => ({
      ...prev,
      positions: prev.positions.map(p => p.id === id ? { ...p, ...data } : p)
    }));
  };

  const deletePosition = async (id: string) => {
    const { error } = await supabase.from('positions').delete().eq('id', id);
    if (error) throw error;
    setState(prev => ({ ...prev, positions: prev.positions.filter(p => p.id !== id) }));
  };

  const reorderPositions = async (positions: Position[]) => {
    setState(prev => ({ ...prev, positions }));
  };

  const markNotificationAsRead = (id: string) => {
    setState(prev => ({ ...prev, appNotifications: prev.appNotifications.map(n => n.id === id ? { ...n, isRead: true } : n) }));
  };

  const markAllNotificationsAsRead = () => {
    setState(prev => ({ ...prev, appNotifications: prev.appNotifications.map(n => ({ ...n, isRead: true })) }));
  };

  const clearToast = () => {
    setState(prev => ({ ...prev, toast: null }));
  };

  const inviteFriend = async (firstName: string, lastName: string, phone: string, targetPosition: string) => {
    if (state.currentUser) logCandidateAction(state.currentUser.id, `Zaproszono znajomego: ${firstName} ${lastName} (${targetPosition})`);

    // Send SMS invitation with referral and company params
    const params = new URLSearchParams();
    if (state.currentUser?.id) params.append('ref', state.currentUser.id);
    if (state.currentUser?.company_id) params.append('company', state.currentUser.company_id);
    const queryStr = params.toString() ? `?${params.toString()}` : '';
    const fullPortalUrl = `${APP_URL}/#/candidate/welcome${queryStr}`;
    const shortUrl = await createShortLink(fullPortalUrl, state.currentUser?.id);
    const portalUrl = shortUrl || fullPortalUrl;

    try {
      await sendTemplatedSMS(
        'CAND_INVITE_LINK',
        phone,
        { firstName, portalUrl },
        undefined
      );
      triggerNotification('success', 'Zaproszenie wysłane', `Wysłano SMS do ${firstName} ${lastName}.`);
    } catch (error) {
      console.error('Failed to send invitation SMS:', error);
      triggerNotification('warning', 'Zaproszenie wysłane', `Dodano ${firstName} ${lastName}, ale SMS nie został wysłany.`);
    }
  };

  const confirmSkillPractice = async (userSkillId: string, brigadirId: string) => {
    // Get the userSkill to find the user
    const userSkill = state.userSkills.find(us => us.id === userSkillId);
    if (!userSkill) return;

    const user = state.users.find(u => u.id === userSkill.user_id);
    if (!user) return;

    // Determine effective_from based on user status
    let effectiveFrom: string | null;

    if (user.status === UserStatus.TRIAL) {
      // For TRIAL employees, set effective_from to null
      // It will be updated to hired_date when transitioning to ACTIVE
      effectiveFrom = null;
    } else {
      // For ACTIVE employees, set effective_from to 1st of next month
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      effectiveFrom = nextMonth.toISOString();
    }

    const updates = {
      status: SkillStatus.CONFIRMED,
      practice_checked_by: brigadirId,
      practice_date: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      effective_from: effectiveFrom
    };

    const { data, error } = await supabase.from('user_skills').update(updates).eq('id', userSkillId).select().single();
    if (error) throw error;
    setState(prev => ({
      ...prev,
      userSkills: prev.userSkills.map(us => us.id === userSkillId ? { ...us, ...data } : us)
    }));

    // Send SMS notification about approved skill
    const skill = state.skills.find(s => s.id === userSkill.skill_id);
    if (user.phone && skill) {
      try {
        await sendTemplatedSMS(
          'PRACTICE_VERIFICATION_RESULT_APPROVED',
          user.phone,
          { firstName: user.first_name, skillName: skill.title_pl },
          user.id
        );
      } catch (error) {
        console.error('Failed to send skill approval SMS:', error);
      }
    }
  };

  const saveSkillChecklistProgress = async (userSkillId: string, progress: any) => {
    const { data, error } = await supabase.from('user_skills').update({ checklist_progress: progress }).eq('id', userSkillId).select().single();
    if (error) throw error;
    setState(prev => ({
      ...prev,
      userSkills: prev.userSkills.map(us => us.id === userSkillId ? { ...us, ...data } : us)
    }));
  };

  const addEmployeeBadge = async (badge: any) => {
    const { data, error } = await supabase.from('employee_badges').insert([badge]).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, employeeBadges: [...prev.employeeBadges, data] }));
  };

  const deleteEmployeeBadge = async (id: string) => {
    const { error } = await supabase.from('employee_badges').delete().eq('id', id);
    if (error) throw error;
    setState(prev => ({ ...prev, employeeBadges: prev.employeeBadges.filter(b => b.id !== id) }));
  };

  const addQualityIncident = async (incident: any) => {
    const { data, error } = await supabase.from('quality_incidents').insert([incident]).select().single();
    if (error) throw error;
    setState(prev => ({ ...prev, qualityIncidents: [...prev.qualityIncidents, data] }));
  };

  const blockUser = async (userId: string, reason?: string) => {
    const updates = {
      is_blocked: true,
      blocked_at: new Date().toISOString(),
      blocked_reason: reason || 'Zablokowany przez administratora'
    };
    await updateUser(userId, updates);
  };

  const unblockUser = async (userId: string) => {
    const updates = {
      is_blocked: false,
      blocked_at: null,
      blocked_reason: null
    };
    await updateUser(userId, updates);
  };

  const updateUserWithPassword = async (userId: string, updates: any, password?: string) => {
    const { data, error } = await supabase.functions.invoke('manage-user', {
      body: {
        action: 'updateUser',
        userId,
        email: updates.email,
        first_name: updates.first_name,
        last_name: updates.last_name,
        phone: updates.phone,
        role: updates.role,
        password
      }
    });

    if (error) {
      throw new Error(error.message || 'Failed to update user');
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Failed to update user');
    }

    // Refresh local data
    await refreshData();
  };

  const deleteUserCompletely = async (userId: string) => {
    const { data, error } = await supabase.functions.invoke('manage-user', {
      body: {
        action: 'deleteUser',
        userId
      }
    });

    if (error) {
      throw new Error(error.message || 'Failed to delete user');
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Failed to delete user');
    }

    // Refresh data from server to ensure state is in sync
    await refreshData();
  };

  // =====================================================
  // MULTI-COMPANY METHODS
  // =====================================================

  const addCompany = async (companyData: Partial<Company>): Promise<Company> => {
    const { data, error } = await supabase.from('companies').insert([{
      ...companyData,
      created_by: state.currentUser?.id
    }]).select().single();

    if (error) throw error;
    setState(prev => ({ ...prev, companies: [...prev.companies, data] }));

    // Trigger notification for assigned Doradca
    if (data.doradca_id) {
      const doradcaUser = state.users.find(u => u.id === data.doradca_id);
      if (doradcaUser && state.currentUser?.id === data.doradca_id) {
        triggerNotification(
          'company_assigned',
          'Nowa firma pod opieką',
          `Firma "${data.name}" została dodana pod Twoją opiekę.`,
          `/doradca/company/${data.id}`
        );
      }
    }

    return data;
  };

  const updateCompany = async (id: string, updates: Partial<Company>) => {
    // Check if doradca_id is being assigned/changed
    const existingCompany = state.companies.find(c => c.id === id);
    const isNewDoradcaAssignment = updates.doradca_id &&
      updates.doradca_id !== existingCompany?.doradca_id;

    const { data, error } = await supabase.from('companies').update(updates).eq('id', id).select().single();
    if (error) throw error;
    setState(prev => ({
      ...prev,
      companies: prev.companies.map(c => c.id === id ? { ...c, ...data } : c),
      currentCompany: prev.currentCompany?.id === id ? { ...prev.currentCompany, ...data } : prev.currentCompany
    }));

    // Trigger notification for newly assigned Doradca
    if (isNewDoradcaAssignment && state.currentUser?.id === updates.doradca_id) {
      triggerNotification(
        'company_assigned',
        'Nowa firma pod opieką',
        `Firma "${data.name}" została przypisana pod Twoją opiekę.`,
        `/doradca/company/${data.id}`
      );
    }
  };

  const deleteCompany = async (id: string) => {
    const { error } = await supabase.from('companies').delete().eq('id', id);
    if (error) throw error;
    setState(prev => ({
      ...prev,
      companies: prev.companies.filter(c => c.id !== id),
      currentCompany: prev.currentCompany?.id === id ? null : prev.currentCompany
    }));
  };

  const blockCompany = async (id: string, reason?: string) => {
    await updateCompany(id, {
      is_blocked: true,
      blocked_at: new Date().toISOString(),
      blocked_reason: reason || 'Zablokowana przez administratora'
    });
  };

  const unblockCompany = async (id: string) => {
    await updateCompany(id, {
      is_blocked: false,
      blocked_at: undefined,
      blocked_reason: undefined
    });
  };

  // Process referral bonus when a company makes a qualifying payment
  const processReferralBonus = async (companyId: string, paymentAmount: number) => {
    const company = state.companies.find(c => c.id === companyId);
    if (!company) return;

    // Check if company was referred and bonus hasn't been paid yet
    if (!company.referred_by_company_id || company.referral_bonus_paid) {
      return;
    }

    // Check if payment meets minimum threshold
    const minPaymentAmount = state.systemConfig.referralMinPaymentAmount || 100;
    const bonusAmount = state.systemConfig.referralBonusAmount || 50;

    if (paymentAmount < minPaymentAmount) {
      return;
    }

    // Find referring company
    const referringCompany = state.companies.find(c => c.id === company.referred_by_company_id);
    if (!referringCompany) return;

    try {
      // Add bonus to referring company's balance
      const newBonusBalance = (referringCompany.bonus_balance || 0) + bonusAmount;

      await supabase
        .from('companies')
        .update({ bonus_balance: newBonusBalance })
        .eq('id', referringCompany.id);

      // Mark bonus as paid for referred company
      await supabase
        .from('companies')
        .update({
          referral_bonus_paid: true,
          referral_bonus_paid_at: new Date().toISOString()
        })
        .eq('id', companyId);

      // Refresh data to update state
      await refreshData();

      console.log(`Referral bonus of ${bonusAmount} PLN added to company ${referringCompany.name}`);
    } catch (error) {
      console.error('Error processing referral bonus:', error);
    }
  };

  const switchCompany = async (companyId: string) => {
    const company = state.companies.find(c => c.id === companyId);
    if (company) {
      setState(prev => ({ ...prev, currentCompany: company }));
    }
  };

  const getCompanyUsers = (companyId: string): User[] => {
    return state.users.filter(u => u.company_id === companyId);
  };

  const isGlobalUser = (): boolean => {
    return state.currentUser?.is_global_user === true;
  };

  // Module access management
  const grantModuleAccess = async (userId: string, moduleCode: string) => {
    const user = state.users.find(u => u.id === userId);
    if (!user?.company_id) throw new Error('User has no company');

    // Check if access record already exists
    const existing = state.moduleUserAccess.find(
      mua => mua.user_id === userId && mua.module_code === moduleCode
    );

    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from('module_user_access')
        .update({ is_enabled: true, enabled_at: new Date().toISOString(), disabled_at: null })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      setState(prev => ({
        ...prev,
        moduleUserAccess: prev.moduleUserAccess.map(mua =>
          mua.id === existing.id ? { ...mua, ...data } : mua
        )
      }));
    } else {
      // Create new access record
      const { data, error } = await supabase
        .from('module_user_access')
        .insert([{
          company_id: user.company_id,
          user_id: userId,
          module_code: moduleCode,
          is_enabled: true,
          enabled_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;
      setState(prev => ({
        ...prev,
        moduleUserAccess: [...prev.moduleUserAccess, data]
      }));
    }

    // Update company module user count
    const companyModule = state.companyModules.find(
      cm => cm.company_id === user.company_id && cm.module_code === moduleCode
    );
    if (companyModule) {
      const newCount = state.moduleUserAccess.filter(
        mua => mua.module_code === moduleCode &&
               state.users.find(u => u.id === mua.user_id)?.company_id === user.company_id &&
               mua.is_enabled
      ).length + 1;

      await supabase
        .from('company_modules')
        .update({ current_users: newCount })
        .eq('id', companyModule.id);
    }
  };

  const revokeModuleAccess = async (userId: string, moduleCode: string) => {
    const existing = state.moduleUserAccess.find(
      mua => mua.user_id === userId && mua.module_code === moduleCode
    );

    if (!existing) return;

    const { data, error } = await supabase
      .from('module_user_access')
      .update({ is_enabled: false, disabled_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    setState(prev => ({
      ...prev,
      moduleUserAccess: prev.moduleUserAccess.map(mua =>
        mua.id === existing.id ? { ...mua, ...data } : mua
      )
    }));

    // Update company module user count
    const user = state.users.find(u => u.id === userId);
    if (user?.company_id) {
      const companyModule = state.companyModules.find(
        cm => cm.company_id === user.company_id && cm.module_code === moduleCode
      );
      if (companyModule) {
        const newCount = Math.max(0, state.moduleUserAccess.filter(
          mua => mua.module_code === moduleCode &&
                 state.users.find(u => u.id === mua.user_id)?.company_id === user.company_id &&
                 mua.is_enabled &&
                 mua.id !== existing.id
        ).length);

        await supabase
          .from('company_modules')
          .update({ current_users: newCount })
          .eq('id', companyModule.id);
      }
    }
  };

  // Role priority for auto-granting module access
  const ROLE_PRIORITY = ['hr', 'coordinator', 'brigadir', 'employee', 'trial', 'candidate'];

  /**
   * Auto-grant module access to a single newly created user.
   * Checks all active company modules for free seats and grants access.
   */
  const autoGrantAccessForNewUser = async (userId: string, companyId: string) => {
    try {
      // Refresh state to get latest data
      const { data: activeModules } = await supabase
        .from('company_modules')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true);

      if (!activeModules || activeModules.length === 0) return;

      for (const mod of activeModules) {
        // Count currently enabled users for this module
        const { count } = await supabase
          .from('module_user_access')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('module_code', mod.module_code)
          .eq('is_enabled', true);

        const currentEnabled = count || 0;

        // Check if there's room
        if (currentEnabled < mod.max_users) {
          // Check if user already has access
          const { data: existingAccess } = await supabase
            .from('module_user_access')
            .select('id')
            .eq('user_id', userId)
            .eq('module_code', mod.module_code)
            .eq('is_enabled', true)
            .maybeSingle();

          if (!existingAccess) {
            await grantModuleAccess(userId, mod.module_code);
          }
        }
      }
    } catch (err) {
      console.error('autoGrantAccessForNewUser error:', err);
    }
  };

  /**
   * Auto-grant module access to all company users for a specific module.
   * Used after module purchase or seat addition, grants in role priority order.
   */
  const autoGrantModuleAccessForCompany = async (companyId: string, moduleCode: string) => {
    try {
      const companyModule = state.companyModules.find(
        cm => cm.company_id === companyId && cm.module_code === moduleCode && cm.is_active
      );
      if (!companyModule) return;

      const companyUsers = state.users.filter(
        u => u.company_id === companyId && u.status !== UserStatus.INACTIVE
      );

      const currentlyGranted = state.moduleUserAccess.filter(
        mua => mua.module_code === moduleCode && mua.is_enabled &&
               companyUsers.some(u => u.id === mua.user_id)
      );

      const availableSeats = companyModule.max_users - currentlyGranted.length;
      if (availableSeats <= 0) return;

      const usersWithoutAccess = companyUsers.filter(
        u => !currentlyGranted.some(mua => mua.user_id === u.id)
      );

      // Sort by priority
      usersWithoutAccess.sort((a, b) => {
        const aIdx = ROLE_PRIORITY.indexOf(a.role);
        const bIdx = ROLE_PRIORITY.indexOf(b.role);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      });

      const usersToGrant = usersWithoutAccess.slice(0, availableSeats);
      for (const user of usersToGrant) {
        await grantModuleAccess(user.id, moduleCode);
      }
    } catch (err) {
      console.error('autoGrantModuleAccessForCompany error:', err);
    }
  };

  // Role simulation methods (SuperAdmin and Company Admin)
  const setSimulatedRole = (role: Role | null) => {
    // SuperAdmin and Company Admin can simulate roles
    if (state.currentUser?.role !== Role.SUPERADMIN && state.currentUser?.role !== Role.COMPANY_ADMIN) return;
    setState(prev => ({ ...prev, simulatedRole: role }));
  };

  const getEffectiveRole = (): Role | null => {
    // If superadmin or company_admin is simulating a role, return that role
    if ((state.currentUser?.role === Role.SUPERADMIN || state.currentUser?.role === Role.COMPANY_ADMIN) && state.simulatedRole) {
      return state.simulatedRole;
    }
    return state.currentUser?.role || null;
  };

  // =====================================================
  // CRM DEAL METHODS
  // =====================================================

  const addCrmDeal = async (deal: Omit<CRMDeal, 'id' | 'created_at' | 'updated_at'>): Promise<CRMDeal> => {
    const { data, error } = await supabase.from('crm_deals').insert([{
      ...deal,
      assigned_sales_id: deal.assigned_sales_id || state.currentUser?.id
    }]).select().single();

    if (error) throw error;
    setState(prev => ({ ...prev, crmDeals: [data, ...prev.crmDeals] }));
    return data;
  };

  const updateCrmDeal = async (id: string, updates: Partial<CRMDeal>) => {
    const { data, error } = await supabase.from('crm_deals').update({
      ...updates,
      updated_at: new Date().toISOString()
    }).eq('id', id).select().single();

    if (error) throw error;
    setState(prev => ({
      ...prev,
      crmDeals: prev.crmDeals.map(d => d.id === id ? { ...d, ...data } : d)
    }));
  };

  const deleteCrmDeal = async (id: string) => {
    const { error } = await supabase.from('crm_deals').delete().eq('id', id);
    if (error) throw error;
    setState(prev => ({
      ...prev,
      crmDeals: prev.crmDeals.filter(d => d.id !== id)
    }));
  };

  const contextValue: AppContextType = {
    state,
    setState,
    login,
    logout,
    refreshData,
    loginAsUser,
    addUser,
    deleteUser,
    updateUser,
    addCandidate,
    moveCandidateToTrial,
    logCandidateAction,
    resetTestAttempt,
    addCandidateDocument,
    updateCandidateDocumentDetails,
    updateUserSkillStatus,
    archiveCandidateDocument,
    restoreCandidateDocument,
    hireCandidate,
    triggerNotification,
    assignBrigadir,
    resetSkillProgress,
    addEmployeeNote,
    deleteEmployeeNote,
    payReferralBonus,
    addSkill,
    updateSkill,
    deleteSkill,
    addLibraryResource,
    updateLibraryResource,
    deleteLibraryResource,
    addTest,
    updateTest,
    startTest,
    submitTest,
    updateSystemConfig,
    updateNotificationSettings,
    addPosition,
    updatePosition,
    deletePosition,
    reorderPositions,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearToast,
    inviteFriend,
    confirmSkillPractice,
    saveSkillChecklistProgress,
    addEmployeeBadge,
    deleteEmployeeBadge,
    addQualityIncident,
    blockUser,
    unblockUser,
    updateUserWithPassword,
    deleteUserCompletely,

    // Multi-company methods
    addCompany,
    updateCompany,
    deleteCompany,
    blockCompany,
    unblockCompany,
    processReferralBonus,
    switchCompany,
    getCompanyUsers,
    isGlobalUser,

    // Module access
    grantModuleAccess,
    revokeModuleAccess,
    autoGrantModuleAccessForCompany,

    // SuperAdmin role simulation
    setSimulatedRole,
    getEffectiveRole,

    // CRM Deal methods
    addCrmDeal,
    updateCrmDeal,
    deleteCrmDeal
  };

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};
