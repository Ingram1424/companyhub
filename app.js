/**
 * Multi-Company Accounting Hub (ระบบบัญชีกลางและจัดการการเงินรวม)
 * Ultra-Clean Professional Redesign & Enterprise Financial Engine
 */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBvATwBLcNoQ-a6kP_Unkt-FMmjjX6yt8M",
  authDomain: "companyhub-ca1b0.firebaseapp.com",
  projectId: "companyhub-ca1b0",
  storageBucket: "companyhub-ca1b0.firebasestorage.app",
  messagingSenderId: "1001866724047",
  appId: "1:1001866724047:web:7790d58131a6ca5eefadba"
};

class AccountingApp {
    constructor() {
        this.initStorage();
        this.portalSearchQuery = "";
        this.charts = {};
        this.db = null;
        this.initFirebase();
        this.parseUrlParams();
        this.bindGlobalEvents();
        this.render();
        this.syncWithFirebase();
        this.syncWithServer();
    }

    // 1. Storage & State Initialization
    initStorage() {
        const storedCompanies = localStorage.getItem("mc_companies");
        const storedTransactions = localStorage.getItem("mc_transactions");
        const storedUsers = localStorage.getItem("mc_users");
        const storedLocalUser = localStorage.getItem("mc_current_user");
        const storedSessionUser = sessionStorage.getItem("mc_current_user");
        const storedCurrentUser = storedLocalUser || storedSessionUser;
        this.rememberLogin = !!storedLocalUser;
        const storedFirebase = localStorage.getItem("mc_firebase_cfg");

        let parsedCompanies = null;
        try {
            parsedCompanies = storedCompanies ? JSON.parse(storedCompanies) : null;
        } catch (e) {
            parsedCompanies = null;
        }

        this.companies = (Array.isArray(parsedCompanies) && parsedCompanies.length > 0) 
            ? parsedCompanies 
            : [...INITIAL_MOCK_DATA.companies];

        this.transactions = storedTransactions ? JSON.parse(storedTransactions) : [...INITIAL_MOCK_DATA.transactions];
        this.categories = [...INITIAL_MOCK_DATA.categories];
        this.users = storedUsers ? JSON.parse(storedUsers) : [...INITIAL_MOCK_DATA.users];
        this.firebaseCfg = storedFirebase ? JSON.parse(storedFirebase) : null;

        // Authentication & Navigation state: public mode by default (no login required)
        const defaultAdmin = (this.users && this.users.length > 0) ? this.users[0] : {
            id: "admin",
            username: "admin",
            full_name: "ผู้ดูแลระบบ (Administrator)",
            email: "admin",
            role: "super_admin",
            title: "ผู้ดูแลระบบศูนย์รวมลิงก์",
            avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
        };
        this.currentUser = storedCurrentUser ? JSON.parse(storedCurrentUser) : defaultAdmin;
        this.currentCompanyId = this.companies[0] ? this.companies[0].id : null;
        this.viewMode = "portal"; // Direct public access to portal
        this.selectedCategory = "all";
        this.activeTab = "dashboard"; 
        this.activeReportCompany = this.currentCompanyId;
        this.filterStatus = "all";
        this.filterPeriod = "all"; // 'all', '2026-03', '2026-Q1'
        this.filterSearch = "";

        // Embedded Viewer state
        this.viewerCurrentCompanyId = null;
        this.viewerCurrentUrl = null;
        this.viewerCurrentTitle = null;

        // Save locally without overwriting Firebase yet until sync completes
        this.saveLocalData(false);
    }

    async syncWithServer() {
        try {
            const res = await fetch("/api/data");
            if (res.ok) {
                const data = await res.json();
                let updated = false;

                // 1. Synchronize Companies
                if (Array.isArray(data.companies) && data.companies.length > 0) {
                    this.companies = data.companies;
                    updated = true;
                } else if (this.companies && this.companies.length > 0) {
                    // Browser has companies, server has none: sync to server!
                    this.saveLocalData(true);
                }

                // 2. Synchronize Users
                if (Array.isArray(data.users) && data.users.length > 0) {
                    this.users = data.users;
                    updated = true;
                } else if (this.users && this.users.length > 0) {
                    this.saveLocalData(true);
                }

                if (updated) {
                    this.saveLocalData(false);
                    this.render();
                }
            }
        } catch (e) {
            // Local file or offline mode, ignore
        }
    }

    saveLocalData(syncServer = true) {
        try {
            localStorage.setItem("mc_companies", JSON.stringify(this.companies));
            localStorage.setItem("mc_transactions", JSON.stringify(this.transactions));
            localStorage.setItem("mc_users", JSON.stringify(this.users));
            if (this.currentUser) {
                if (this.rememberLogin) {
                    localStorage.setItem("mc_current_user", JSON.stringify(this.currentUser));
                } else {
                    sessionStorage.setItem("mc_current_user", JSON.stringify(this.currentUser));
                }
            } else {
                localStorage.removeItem("mc_current_user");
                sessionStorage.removeItem("mc_current_user");
            }
        } catch (storageErr) {
            console.warn("localStorage quota exceeded or write failed:", storageErr);
        }

        if (syncServer) {
            // 1. Direct Cloud Sync to Firebase Firestore
            if (this.db) {
                const now = new Date().toISOString();
                this._lastLocalSaveTime = now;
                this.db.collection("companyhub").doc("app_data").set({
                    companies: this.companies,
                    users: this.users,
                    transactions: this.transactions,
                    categories: this.categories,
                    json_data: JSON.stringify({
                        companies: this.companies,
                        users: this.users,
                        transactions: this.transactions,
                        categories: this.categories
                    }),
                    updated_at: now
                }, { merge: true }).catch(err => {
                    console.error("Firebase save error:", err);
                    this.showToast("บันทึกขึ้น Cloud ไม่สำเร็จ: " + (err.message || err), "error");
                });
            }

            // 2. Local Python server API Sync (if available)
            if (window.location.protocol === "http:" || window.location.protocol === "https:") {
                fetch("/api/save", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        companies: this.companies,
                        users: this.users
                    })
                }).catch(() => {});
            }
        }
    }

    // 2. Firebase Cloud Firestore Integration Layer
    initFirebase() {
        const storedFb = localStorage.getItem("mc_firebase_cfg");
        this.firebaseCfg = storedFb ? JSON.parse(storedFb) : DEFAULT_FIREBASE_CONFIG;

        if (window.firebase && this.firebaseCfg && this.firebaseCfg.projectId) {
            try {
                if (!window.firebase.apps.length) {
                    window.firebase.initializeApp(this.firebaseCfg);
                }
                this.db = window.firebase.firestore();
                console.log("🔥 Firebase Firestore connected successfully!");
            } catch (err) {
                console.warn("Firebase init warning:", err);
            }
        }
    }

    async syncWithFirebase() {
        if (!this.db) return false;
        try {
            const docRef = this.db.collection("companyhub").doc("app_data");
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                const cloud = docSnap.data();
                let data = cloud;
                if (cloud.json_data) {
                    try {
                        data = typeof cloud.json_data === "string" ? JSON.parse(cloud.json_data) : cloud.json_data;
                    } catch (pe) {
                        data = cloud;
                    }
                }

                let updated = false;
                if (Array.isArray(data.companies) && data.companies.length > 0) {
                    this.companies = data.companies;
                    updated = true;
                }
                if (Array.isArray(data.users) && data.users.length > 0) {
                    this.users = data.users;
                    updated = true;
                }
                if (Array.isArray(data.transactions) && data.transactions.length > 0) {
                    this.transactions = data.transactions;
                    updated = true;
                }
                if (updated) {
                    this.saveLocalData(false);
                    this.render();
                }
            } else {
                // First time: seed Firebase with current 5 companies
                await docRef.set({
                    companies: this.companies,
                    users: this.users,
                    transactions: this.transactions,
                    categories: this.categories,
                    json_data: JSON.stringify({
                        companies: this.companies,
                        users: this.users,
                        transactions: this.transactions,
                        categories: this.categories
                    }),
                    updated_at: new Date().toISOString()
                });
            }

            // Real-time synchronization listener
            docRef.onSnapshot((snapshot) => {
                if (!snapshot || !snapshot.exists) return;
                // If this snapshot update is from local cache write (hasPendingWrites), skip to prevent reverting local changes
                if (snapshot.metadata && snapshot.metadata.hasPendingWrites) {
                    return;
                }
                const cloudData = snapshot.data();
                let parsed = cloudData;
                if (cloudData.json_data) {
                    try {
                        parsed = typeof cloudData.json_data === "string" ? JSON.parse(cloudData.json_data) : cloudData.json_data;
                    } catch (e) {
                        parsed = cloudData;
                    }
                }
                if (Array.isArray(parsed.companies) && parsed.companies.length > 0) {
                    const curr = JSON.stringify(this.companies);
                    const next = JSON.stringify(parsed.companies);
                    if (curr !== next) {
                        this.companies = parsed.companies;
                        if (Array.isArray(parsed.users) && parsed.users.length > 0) this.users = parsed.users;
                        if (Array.isArray(parsed.transactions)) this.transactions = parsed.transactions;
                        this.saveLocalData(false);
                        const modal = document.getElementById("modal-container");
                        if (!modal || modal.classList.contains("hidden")) {
                            this.render();
                        }
                    }
                }
            }, (err) => {
                console.warn("Firestore real-time listener warning:", err);
            });

            return true;
        } catch (e) {
            console.warn("Firebase sync warning:", e);
        }
        return false;
    }

    openFirebaseModal() {
        const modal = document.getElementById("modal-container");
        const modalContent = document.getElementById("modal-content");
        if (!modal || !modalContent) return;

        const currentCfg = this.firebaseCfg ? JSON.stringify(this.firebaseCfg, null, 2) : "";

        modalContent.innerHTML = `
            <div class="p-6 sm:p-8">
                <div class="flex items-center justify-between pb-4 border-b border-slate-100">
                    <div class="flex items-center gap-2.5">
                        <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-xl">
                            🔥
                        </div>
                        <div>
                            <h2 class="text-base sm:text-lg font-bold text-slate-900">ตั้งค่าฐานข้อมูล Firebase Cloud</h2>
                            <p class="text-xs text-slate-400">เชื่อมต่อ Firebase Firestore เพื่อซิงค์ข้อมูลถาวรข้ามอุปกรณ์</p>
                        </div>
                    </div>
                    <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>

                <div class="mt-5 space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1.5">วางโค้ด Firebase Config (จาก Firebase Console):</label>
                        <textarea id="firebase-cfg-input" rows="8" placeholder='const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "my-project.firebaseapp.com",
  projectId: "my-project",
  storageBucket: "my-project.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};' class="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500">${currentCfg}</textarea>
                        <p class="text-[11px] text-slate-400 mt-1">สามารถก๊อปปี้ทั้งบล็อกหรือเฉพาะ JSON จาก Firebase Project Settings มาวางได้เลย</p>
                    </div>

                    <div class="flex items-center justify-between pt-2">
                        <div class="text-xs text-slate-500 flex items-center gap-1.5">
                            <span class="w-2 h-2 rounded-full ${this.db ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
                            <span>สถานะ: ${this.db ? 'เชื่อมต่อ Firebase แล้ว' : 'ยังไม่ได้เชื่อมต่อ'}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button type="button" onclick="app.closeModal()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition">ยกเลิก</button>
                            <button type="button" onclick="app.saveFirebaseConfig()" class="px-5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-xs transition active:scale-95">บันทึกและเชื่อมต่อ</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        modal.classList.remove("hidden");
        if (window.lucide) window.lucide.createIcons();
    }

    saveFirebaseConfig() {
        const input = document.getElementById("firebase-cfg-input")?.value.trim();
        if (!input) {
            this.showToast("กรุณาระบุ Firebase Config", "error");
            return;
        }

        try {
            let cfg = null;
            const match = input.match(/\{[\s\S]*\}/);
            if (match) {
                const jsonStr = match[0]
                    .replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":')
                    .replace(/'([^']*)'/g, '"$1"')
                    .replace(/,\s*\}/g, '}');
                cfg = JSON.parse(jsonStr);
            } else {
                cfg = JSON.parse(input);
            }

            if (!cfg || !cfg.projectId) {
                throw new Error("ต้องมี projectId ใน config");
            }

            localStorage.setItem("mc_firebase_cfg", JSON.stringify(cfg));
            this.firebaseCfg = cfg;
            this.initFirebase();
            this.closeModal();
            this.showToast("🔥 เชื่อมต่อ Firebase สำเร็จ กำลังซิงค์ข้อมูล...", "success");
            this.syncWithFirebase();
            this.render();
        } catch (e) {
            alert("รูปแบบ Firebase Config ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง: " + e.message);
        }
    }

    // 3. Multi-Tenant Workspace & Invite Link Parser
    parseUrlParams() {
        let inviteCode = null;
        let directCid = null;
        let directUser = null;

        if (typeof URLSearchParams !== "undefined" && window.location && window.location.search) {
            const urlParams = new URLSearchParams(window.location.search);
            inviteCode = urlParams.get("invite");
            directCid = urlParams.get("cid");
            directUser = urlParams.get("user");
        } else if (window.location && window.location.search) {
            const matchInvite = window.location.search.match(/[?&]invite=([^&]+)/);
            const matchCid = window.location.search.match(/[?&]cid=([^&]+)/);
            const matchUser = window.location.search.match(/[?&]user=([^&]+)/);
            if (matchInvite) inviteCode = decodeURIComponent(matchInvite[1]);
            if (matchCid) directCid = decodeURIComponent(matchCid[1]);
            if (matchUser) directUser = decodeURIComponent(matchUser[1]);
        }

        let targetCompany = null;
        if (inviteCode) {
            targetCompany = this.companies.find(c => c.invite_code === inviteCode);
        } else if (directCid) {
            targetCompany = this.companies.find(c => c.id === directCid || c.code === directCid);
        }

        if (targetCompany) {
            this.currentCompanyId = targetCompany.id;
            this.viewMode = "workspace";
            const compUser = this.users.find(u => u.company_id === targetCompany.id && u.role === "company_manager") ||
                             this.users.find(u => u.company_id === targetCompany.id);
            if (compUser && !this.currentUser) {
                this.currentUser = compUser;
                this.saveLocalData();
            }
            this.showToast(`เข้าสู่ระบบบัญชี: ${targetCompany.name_th}`, "info");
        }

        if (directUser) {
            const foundUser = this.users.find(u => u.id === directUser || u.email === directUser);
            if (foundUser) {
                this.currentUser = foundUser;
                this.saveLocalData();
                if (this.currentUser.company_id) {
                    this.currentCompanyId = this.currentUser.company_id;
                    this.viewMode = "workspace";
                }
            }
        }
    }

    bindGlobalEvents() {
        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                this.closeModal();
            }
        });
    }

    // 4. RBAC Permissions
    hasPermission(action) {
        if (!this.currentUser) return true; // In public mode, allow full access
        const role = this.currentUser.role || "super_admin";
        switch (action) {
            case "view_all_companies":
                return role === "super_admin" || role === "auditor";
            case "switch_company":
                return role === "super_admin" || role === "auditor";
            case "create_transaction":
                return role === "super_admin" || role === "accountant";
            case "approve_transaction":
                return role === "super_admin" || role === "company_manager";
            case "manage_companies":
                return role === "super_admin";
            case "manage_users":
                return role === "super_admin";
            case "manage_settings":
                return role === "super_admin";
            case "print_export":
                return true;
            default:
                return false;
        }
    }

    getCurrentCompany() {
        return this.companies.find(c => c.id === this.currentCompanyId) || this.companies[0] || {
            id: "none",
            code: "none",
            name_th: "ยังไม่ได้เลือกบริษัท",
            name_en: "No Company Selected",
            website_url: "",
            logo_emoji: "🏢",
            sub_links: []
        };
    }

    getVisibleTransactions() {
        let list = [...this.transactions];

        if (!this.hasPermission("view_all_companies")) {
            const userCompId = this.currentUser.company_id;
            list = list.filter(t => t.company_id === userCompId);
        } else if (this.currentCompanyId !== "all") {
            list = list.filter(t => t.company_id === this.currentCompanyId);
        }

        // Period filter
        if (this.filterPeriod === "2026-03") {
            list = list.filter(t => t.transaction_date.startsWith("2026-03"));
        } else if (this.filterPeriod === "2026-Q1") {
            list = list.filter(t => t.transaction_date >= "2026-01-01" && t.transaction_date <= "2026-03-31");
        }

        if (this.filterStatus !== "all") {
            list = list.filter(t => t.status === this.filterStatus);
        }

        if (this.filterSearch.trim()) {
            const query = this.filterSearch.toLowerCase().trim();
            list = list.filter(t => 
                t.transaction_no.toLowerCase().includes(query) ||
                t.description.toLowerCase().includes(query) ||
                t.counterparty_name.toLowerCase().includes(query) ||
                (t.reference_no && t.reference_no.toLowerCase().includes(query)) ||
                t.category_name.toLowerCase().includes(query)
            );
        }

        return list.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
    }

    calculateMetrics(companyId = this.currentCompanyId) {
        let txs = this.transactions.filter(t => t.status !== "rejected");
        if (companyId !== "all") {
            txs = txs.filter(t => t.company_id === companyId);
        }

        if (this.filterPeriod === "2026-03") {
            txs = txs.filter(t => t.transaction_date.startsWith("2026-03"));
        } else if (this.filterPeriod === "2026-Q1") {
            txs = txs.filter(t => t.transaction_date >= "2026-01-01" && t.transaction_date <= "2026-03-31");
        }

        let totalIncome = 0;
        let totalExpense = 0;
        let totalPending = 0;
        let totalVatInput = 0;
        let totalVatOutput = 0;
        let totalWhtPayable = 0;
        let pendingCount = 0;

        txs.forEach(t => {
            const amount = Number(t.subtotal) || 0;
            const vat = Number(t.vat_amount) || 0;
            const wht = Number(t.wht_amount) || 0;

            if (t.type === "income") {
                totalIncome += amount;
                totalVatOutput += vat;
            } else if (t.type === "expense") {
                totalExpense += amount;
                totalVatInput += vat;
                totalWhtPayable += wht;
            }

            if (t.status === "pending") {
                totalPending += Number(t.total_amount) || 0;
                pendingCount++;
            }
        });

        const netProfit = totalIncome - totalExpense;
        const profitMargin = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : 0;

        return {
            totalIncome,
            totalExpense,
            netProfit,
            profitMargin,
            totalPending,
            pendingCount,
            totalVatInput,
            totalVatOutput,
            netVat: totalVatOutput - totalVatInput,
            totalWhtPayable
        };
    }

    // 5. Master View Render
    render() {
        const loginView = document.getElementById("login-view");
        const portalView = document.getElementById("portal-view");
        const workspaceLayout = document.getElementById("workspace-layout");
        const embeddedViewer = document.getElementById("embedded-viewer-view");

        if (this.viewMode === "viewer") {
            if (loginView) loginView.classList.add("hidden");
            if (portalView) portalView.classList.add("hidden");
            if (workspaceLayout) workspaceLayout.classList.add("hidden");
            if (embeddedViewer) embeddedViewer.classList.remove("hidden");
            this.renderEmbeddedViewerScreen();
        } else if (this.viewMode === "workspace") {
            if (loginView) loginView.classList.add("hidden");
            if (portalView) portalView.classList.add("hidden");
            if (workspaceLayout) workspaceLayout.classList.remove("hidden");
            if (embeddedViewer) embeddedViewer.classList.add("hidden");
            this.renderWorkspaceScreen();
        } else {
            // Default: Public Portal View
            if (loginView) loginView.classList.add("hidden");
            if (portalView) portalView.classList.remove("hidden");
            if (workspaceLayout) workspaceLayout.classList.add("hidden");
            if (embeddedViewer) embeddedViewer.classList.add("hidden");
            this.renderPortalScreen();
        }

        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    // =========================================================================
    // VIEW 0: AUTHENTICATION / LOGIN SCREEN
    // =========================================================================
    togglePasswordVisibility(inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        if (btn) {
            btn.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>`;
            if (window.lucide) window.lucide.createIcons();
        }
    }

    renderLoginScreen() {
        const uInput = document.getElementById("login-username");
        const pInput = document.getElementById("login-password");
        if (uInput && !this.currentUser) uInput.value = "";
        if (pInput && !this.currentUser) pInput.value = "";
        if (window.lucide) window.lucide.createIcons();
    }

    handleLoginFormSubmit(e) {
        e.preventDefault();
        const usernameInput = document.getElementById("login-username") || document.getElementById("login-email");
        const passInput = document.getElementById("login-password");
        const rememberChk = document.getElementById("login-remember");
        const username = usernameInput ? usernameInput.value.trim().toLowerCase() : "";
        const password = passInput ? passInput.value.trim() : "";

        const foundUser = this.users.find(u => 
            (u.username && u.username.toLowerCase() === username) || 
            (u.email && u.email.toLowerCase() === username) ||
            (u.id && u.id.toLowerCase() === username)
        );

        if (!foundUser) {
            this.showToast("ไม่พบชื่อผู้ใช้งานนี้ในระบบ กรุณาตรวจสอบอีกครั้ง", "error");
            return;
        }

        const validPassword = foundUser.password || "admin123";
        if (password !== validPassword) {
            this.showToast("รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", "error");
            return;
        }

        const remember = rememberChk ? rememberChk.checked : false;
        this.loginAs(foundUser.id, remember);
    }

    loginAs(userId, remember = false) {
        const user = this.users.find(u => u.id === userId) || this.users[0];
        this.currentUser = user;
        this.rememberLogin = remember;
        this.saveLocalData(true);
        
        this.showToast(`เข้าสู่ระบบสำเร็จ: ${this.currentUser.full_name}`, "success");

        if (!this.hasPermission("view_all_companies") && this.currentUser.company_id) {
            this.enterWorkspace(this.currentUser.company_id);
        } else {
            this.viewMode = "portal";
            this.render();
        }
    }

    logout() {
        const defaultAdmin = (this.users && this.users.length > 0) ? this.users[0] : {
            id: "admin",
            username: "admin",
            full_name: "ผู้ดูแลระบบ (Administrator)",
            email: "admin",
            role: "super_admin",
            title: "ผู้ดูแลระบบศูนย์รวมลิงก์",
            avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
        };
        this.currentUser = defaultAdmin;
        this.rememberLogin = false;
        localStorage.removeItem("mc_current_user");
        sessionStorage.removeItem("mc_current_user");
        this.viewMode = "portal";
        this.showToast("รีเซ็ตสถานะเป็นโหมดสาธารณะเรียบร้อยแล้ว", "info");
        this.render();
    }

    // =========================================================================
    // VIEW 1: ENTERPRISE MULTI-COMPANY LINK HUB & PORTAL SCREEN
    // =========================================================================
    renderPortalScreen() {
        const userHeader = document.getElementById("portal-user-header-actions");
        if (userHeader) {
            userHeader.innerHTML = `
                <button onclick="app.openFirebaseModal()" class="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition shadow-xs active:scale-95" title="ตั้งค่าฐานข้อมูล Firebase">
                    <span class="text-xs">🔥</span>
                    <span class="hidden sm:inline">Firebase DB</span>
                </button>

                <button onclick="app.openUserManagerModal()" class="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition shadow-xs active:scale-95" title="จัดการผู้ใช้งาน (Gen User)">
                    <i data-lucide="users" class="w-3.5 h-3.5 flex-shrink-0"></i>
                    <span class="hidden sm:inline">จัดการผู้ใช้ (Gen User)</span>
                    <span class="sm:hidden">ผู้ใช้</span>
                </button>

                <button onclick="app.openCompanyModal()" class="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm active:scale-95" title="เพิ่มบริษัท/ระบบงาน">
                    <i data-lucide="plus" class="w-3.5 h-3.5 flex-shrink-0"></i>
                    <span class="hidden sm:inline">+ เพิ่มบริษัท</span>
                    <span class="sm:hidden">+ บริษัท</span>
                </button>
            `;
        }

        // Render Category Filter Tabs dynamically
        const catFilterContainer = document.getElementById("portal-category-filters");
        if (catFilterContainer) {
            const categories = [];
            this.companies.forEach(c => {
                const cat = (c.category || "").trim();
                if (cat && !categories.includes(cat)) {
                    categories.push(cat);
                }
            });

            const isAllSelected = !this.selectedCategory || this.selectedCategory === "all";
            const canManage = this.hasPermission("manage_companies") || this.hasPermission("manage_settings");

            let html = `
                <button onclick="app.filterCategory('all')" 
                        class="cat-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 transition shadow-xs ${isAllSelected ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}" 
                        data-cat="all">
                    ทั้งหมด
                </button>
            `;

            categories.forEach(cat => {
                const isSelected = this.selectedCategory === cat;
                const count = this.companies.filter(c => (c.category || "").trim() === cat).length;
                const escapedCat = cat.replace(/'/g, "\\'");
                html += `
                    <button onclick="app.filterCategory('${escapedCat}')" 
                            class="cat-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 transition shadow-xs flex items-center gap-1.5 ${isSelected ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}" 
                            data-cat="${cat.replace(/"/g, '&quot;')}">
                        <span>${cat}</span>
                        <span class="text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}">${count}</span>
                    </button>
                `;
            });

            if (canManage) {
                html += `
                    <button onclick="app.openAddTabModal()" class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-dashed border-blue-300 transition whitespace-nowrap flex-shrink-0 flex items-center gap-1 shadow-xs active:scale-95" title="เพิ่มแท็บ/หมวดหมู่ใหม่">
                        <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                        <span>+ เพิ่มแท็บ</span>
                    </button>
                `;
            }

            catFilterContainer.innerHTML = html;
        }

        const grid = document.getElementById("portal-companies-grid");
        const countBadge = document.getElementById("companies-count-badge");
        if (!grid) return;

        let filtered = [...this.companies];

        // Filter by category
        if (this.selectedCategory && this.selectedCategory !== "all") {
            filtered = filtered.filter(c => (c.category || "").includes(this.selectedCategory));
        }

        // Filter by search query
        if (this.portalSearchQuery.trim()) {
            const q = this.portalSearchQuery.toLowerCase().trim();
            filtered = filtered.filter(c => 
                c.name_th.toLowerCase().includes(q) ||
                (c.name_en && c.name_en.toLowerCase().includes(q)) ||
                (c.website_url && c.website_url.toLowerCase().includes(q)) ||
                (c.description && c.description.toLowerCase().includes(q)) ||
                (c.category && c.category.toLowerCase().includes(q)) ||
                c.code.toLowerCase().includes(q) ||
                (c.website_links && c.website_links.some(l => 
                    (l.title && l.title.toLowerCase().includes(q)) || 
                    (l.url && l.url.toLowerCase().includes(q))
                ))
            );
        }

        const userRestrictedCompId = !this.hasPermission("view_all_companies") ? this.currentUser.company_id : null;
        if (countBadge) countBadge.textContent = `${filtered.length} บริษัท`;

        // If no companies exist at all in the system
        if (this.companies.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full py-16 px-6 text-center bg-white rounded-3xl border border-dashed border-slate-300 max-w-xl mx-auto shadow-xs">
                    <div class="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 text-3xl">
                        🏢
                    </div>
                    <h3 class="text-base font-bold text-slate-900">ยังไม่มีบริษัทหรือลิงก์ระบบงานในระบบ</h3>
                    <p class="text-xs text-slate-500 mt-2 leading-relaxed">
                        เริ่มต้นใช้งานโดยการเพิ่มบริษัทในเครือ พร้อมระบุเว็บไซต์หลักและลิงก์ระบบงานย่อยที่ต้องการรวมศูนย์
                    </p>
                    <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
                        <button onclick="app.openCompanyModal()" class="inline-flex items-center gap-2 px-5 py-2.5 bg-navy-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition shadow-sm">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                            <span>+ เพิ่มบริษัทหรือระบบงานแรก</span>
                        </button>
                    </div>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full py-16 text-center bg-white rounded-3xl border border-dashed border-slate-300">
                    <i data-lucide="search-x" class="w-10 h-10 text-slate-300 mx-auto mb-3"></i>
                    <h3 class="text-sm font-bold text-slate-700">ไม่พบข้อมูลบริษัทหรือระบบงานที่ค้นหา</h3>
                    <p class="text-xs text-slate-400 mt-1">ลองเปลี่ยนคำค้นหา หรือเลือกหมวดหมู่อื่น</p>
                    <button onclick="app.filterCategory('all'); document.getElementById('portal-search-input').value=''; app.handlePortalSearch('');" class="mt-4 px-4 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition">
                        แสดงทั้งหมด
                    </button>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        grid.innerHTML = filtered.map(c => {
            const isUserHome = userRestrictedCompId === c.id;
            const isLocked = userRestrictedCompId && !isUserHome;
            const canEdit = this.hasPermission("manage_settings") || (this.currentUser && this.currentUser.company_id === c.id && this.currentUser.role === "company_manager");
            const links = this.getCompanyLinks(c);
            const primaryLink = links[0] || { title: "เว็บไซต์หลัก", url: c.website_url || "" };
            const subLinks = links.slice(1);
            const primaryClean = (primaryLink.url || "").replace(/^https?:\/\//, '').replace(/\/$/, '');
            const primaryTarget = (primaryLink.url && /^https?:\/\//i.test(primaryLink.url)) ? primaryLink.url : `https://${primaryLink.url || ''}`;

            return `
                <div class="bg-white rounded-2xl sm:rounded-3xl border ${isUserHome ? 'border-blue-500 ring-2 ring-blue-500/10' : 'border-slate-200/80'} p-4 sm:p-6 flex flex-col justify-between hover:shadow-lg hover:border-slate-300 transition duration-200 group ${isLocked ? 'opacity-50 grayscale' : ''}">
                    <div>
                        <!-- Card Header: Logo, Status & Category -->
                        <div class="flex items-start justify-between gap-3">
                            <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-2xl sm:text-3xl shadow-xs overflow-hidden flex-shrink-0 group-hover:scale-105 transition">
                                ${c.logo_image ? `<img src="${c.logo_image}" class="w-full h-full object-cover" />` : `<span>${c.logo_emoji || '🏢'}</span>`}
                            </div>
                            <div class="flex flex-col items-end gap-1.5">
                                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    <span>ออนไลน์</span>
                                </span>
                                <span class="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200/80">
                                    ${c.category || 'ธุรกิจ & บริการ'}
                                </span>
                            </div>
                        </div>

                        <!-- Company Titles -->
                        <div class="mt-3.5 sm:mt-4">
                            <div class="flex items-center gap-1.5">
                                <h3 class="text-base font-bold text-slate-900 leading-snug group-hover:text-blue-600 transition">${c.name_th}</h3>
                                ${isUserHome ? `<span class="text-[9px] font-bold px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded">ของคุณ</span>` : ''}
                            </div>
                            <p class="text-xs text-slate-400 mt-0.5 line-clamp-1 font-normal">${c.name_en || ''}</p>
                            <p class="text-xs text-slate-600 mt-2 line-clamp-2 leading-relaxed">${c.description || 'เว็บไซต์และระบบงานสำหรับบริหารจัดการองค์กร'}</p>
                        </div>

                        <!-- Primary Website Box -->
                        <div class="mt-3.5 sm:mt-4 p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between gap-2.5 hover:border-slate-200 transition">
                            <div class="flex items-center gap-2.5 min-w-0">
                                <div class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                                    <i data-lucide="globe" class="w-4 h-4"></i>
                                </div>
                                <div class="min-w-0">
                                    <span class="text-[10px] text-slate-400 block font-semibold leading-tight">${primaryLink.title || 'เว็บไซต์หลัก'}</span>
                                    ${primaryLink.url ? `
                                        <a href="${primaryTarget}" target="_blank" rel="noopener noreferrer" class="text-xs font-mono font-medium text-blue-600 hover:underline truncate block mt-0.5" title="${primaryLink.url}">
                                            ${primaryClean}
                                        </a>
                                    ` : `
                                        <span class="text-xs text-slate-400 font-mono mt-0.5 block">ยังไม่ได้ระบุลิงก์</span>
                                    `}
                                </div>
                            </div>
                            ${primaryLink.url ? `
                                <div class="flex items-center gap-1 flex-shrink-0">
                                    <button onclick="app.copyCompanyUrl('${primaryTarget}')" title="คัดลอกลิงก์" class="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition active:scale-90">
                                        <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                                    </button>
                                </div>
                            ` : ''}
                        </div>

                        <!-- Sub-systems & Additional Links Section -->
                        <div class="mt-3 sm:mt-3.5">
                            <div class="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1.5">
                                <span class="flex items-center gap-1">
                                    <span>ระบบงานย่อย (${subLinks.length})</span>
                                </span>
                                <span class="text-[10px] text-slate-400 font-normal">คลิกเพื่อเปิด</span>
                            </div>

                            ${subLinks.length === 0 ? `
                                <p class="text-xs text-slate-400 py-1 font-normal">ยังไม่มีระบบงานย่อย</p>
                            ` : `
                                <div class="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                                    ${subLinks.map(s => {
                                        const cleanUrl = (s.url || "").replace(/^https?:\/\//, '').replace(/\/$/, '');
                                        const target = (s.url && /^https?:\/\//i.test(s.url)) ? s.url : `https://${s.url || ''}`;
                                        const isBackoffice = /หลังบ้าน|admin|แอดมิน|จัดการ|สต็อก|internal|บัญชี/i.test(s.title);
                                        const badgeText = s.badge || (isBackoffice ? 'หลังบ้าน' : 'ระบบ');
                                        const badgeClass = isBackoffice 
                                            ? 'bg-amber-100/80 text-amber-800 border-amber-200' 
                                            : 'bg-slate-200/70 text-slate-700 border-slate-300/60';

                                        return `
                                            <div class="p-2 sm:p-2.5 bg-slate-50 hover:bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 transition flex items-center justify-between gap-2 group/sub shadow-2xs">
                                                <div class="min-w-0 flex-1">
                                                    <div class="flex items-center gap-1.5 mb-0.5">
                                                        <span class="px-1.5 py-0.2 rounded text-[9px] font-bold ${badgeClass} border flex-shrink-0">
                                                            ${badgeText}
                                                        </span>
                                                        <span class="text-xs font-bold text-slate-800 truncate">${s.title}</span>
                                                    </div>
                                                    <a href="${target}" target="_blank" rel="noopener noreferrer" class="text-xs font-mono font-medium text-blue-600 hover:underline truncate block" title="${s.url}">
                                                        ${cleanUrl || 'ไม่ได้ระบุ URL'}
                                                    </a>
                                                </div>
                                                <div class="flex items-center gap-1 flex-shrink-0">
                                                    <button onclick="app.copyCompanyUrl('${target}')" title="คัดลอกลิงก์" class="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition active:scale-90">
                                                        <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                                                    </button>
                                                    <a href="${target}" target="_blank" rel="noopener noreferrer" title="เปิดในแท็บใหม่" class="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition active:scale-90">
                                                        <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                                                    </a>
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `}
                        </div>
                    </div>

                    <!-- Card Actions -->
                    <div class="mt-4 sm:mt-5 pt-3.5 sm:pt-4 border-t border-slate-100 flex flex-col gap-2.5">
                        ${links.length <= 1 ? `
                            <a href="${primaryTarget}" target="_blank" rel="noopener noreferrer" 
                                class="w-full py-3 px-4 bg-navy-900 hover:bg-slate-800 active:scale-[0.98] text-white text-sm font-semibold rounded-xl transition shadow-sm flex items-center justify-center gap-2">
                                <span>เปิดระบบ</span>
                                <i data-lucide="external-link" class="w-4 h-4"></i>
                            </a>
                        ` : links.length === 2 ? `
                            <div class="grid grid-cols-2 gap-2">
                                <a href="${primaryTarget}" target="_blank" rel="noopener noreferrer" 
                                    class="py-2.5 px-3 bg-navy-900 hover:bg-slate-800 active:scale-[0.98] text-white text-xs font-semibold rounded-xl transition shadow-sm flex items-center justify-center gap-1.5 truncate" title="เปิด ${primaryLink.title}">
                                    <span class="truncate">เปิด${primaryLink.title}</span>
                                    <i data-lucide="external-link" class="w-3.5 h-3.5 flex-shrink-0"></i>
                                </a>
                                <a href="${(links[1]?.url && /^https?:\/\//i.test(links[1].url)) ? links[1].url : 'https://' + (links[1]?.url || '')}" target="_blank" rel="noopener noreferrer" 
                                    class="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-white text-xs font-semibold rounded-xl transition shadow-sm flex items-center justify-center gap-1.5 truncate border border-slate-700" title="เปิด ${links[1].title}">
                                    <span class="truncate">เปิด${links[1].title}</span>
                                    <i data-lucide="external-link" class="w-3.5 h-3.5 flex-shrink-0"></i>
                                </a>
                            </div>
                        ` : `
                            <div class="grid grid-cols-2 gap-2">
                                ${links.slice(0, 2).map((l, i) => `
                                    <a href="${(l.url && /^https?:\/\//i.test(l.url)) ? l.url : 'https://' + (l.url || '')}" target="_blank" rel="noopener noreferrer" 
                                        class="py-2.5 px-3 ${i === 0 ? 'bg-navy-900 hover:bg-slate-800 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'} active:scale-[0.98] text-xs font-semibold rounded-xl transition shadow-sm flex items-center justify-center gap-1.5 truncate" title="เปิด ${l.title}">
                                        <span class="truncate">เปิด${l.title}</span>
                                        <i data-lucide="external-link" class="w-3.5 h-3.5 flex-shrink-0"></i>
                                    </a>
                                `).join('')}
                            </div>
                            ${links.length > 2 ? `
                                <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
                                    ${links.slice(2).map(l => `
                                        <a href="${(l.url && /^https?:\/\//i.test(l.url)) ? l.url : 'https://' + (l.url || '')}" target="_blank" rel="noopener noreferrer" 
                                            class="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold rounded-lg transition flex items-center justify-center gap-1 truncate border border-slate-200/80" title="เปิด ${l.title}">
                                            <span class="truncate">${l.title}</span>
                                            <i data-lucide="external-link" class="w-3 h-3 flex-shrink-0"></i>
                                        </a>
                                    `).join('')}
                                </div>
                            ` : ''}
                        `}

                        <!-- Utility Footer -->
                        <div class="flex items-center justify-between text-xs pt-1 px-1">
                            ${canEdit ? `
                                <button onclick="app.openEditCompanyModal('${c.id}')" class="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-blue-600 transition p-1">
                                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                                    <span>แก้ไขเว็บ & ข้อมูล</span>
                                </button>
                            ` : '<div></div>'}
                            
                            <div class="flex items-center gap-1.5 sm:gap-2">
                                <button onclick="app.enterWorkspace('${c.id}')" class="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-navy-900 transition p-1" title="ระบบบัญชีและงบการเงิน">
                                    <i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>
                                    <span>บัญชีภายใน</span>
                                </button>
                                <button onclick="app.copyInviteLink('${c.id}')" title="คัดลอกลิงก์ตรง" class="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg transition active:scale-90">
                                    <i data-lucide="share-2" class="w-3.5 h-3.5"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    }

    filterCategory(cat) {
        this.selectedCategory = cat;
        this.renderPortalScreen();
        if (window.lucide) window.lucide.createIcons();
    }

    openAddTabModal() {
        const modal = document.getElementById("modal-container");
        const modalContent = document.getElementById("modal-content");
        if (!modal || !modalContent) return;

        // Existing categories
        const existingCats = [];
        this.companies.forEach(c => {
            const cat = (c.category || "").trim();
            if (cat && !existingCats.includes(cat)) existingCats.push(cat);
        });

        modalContent.innerHTML = `
            <div class="p-6 sm:p-8">
                <div class="flex items-center justify-between pb-4 border-b border-slate-100">
                    <div class="flex items-center gap-2.5">
                        <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg">
                            📑
                        </div>
                        <div>
                            <h2 class="text-base sm:text-lg font-bold text-slate-900">เพิ่มแท็บ / หมวดหมู่ใหม่</h2>
                            <p class="text-xs text-slate-400">สร้างแท็บสำหรับจัดกลุ่มและกรองบริษัทข้างๆ ปุ่ม "ทั้งหมด"</p>
                        </div>
                    </div>
                    <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>

                <form onsubmit="app.handleCreateTab(event)" class="mt-5 space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อแท็บใหม่ (Category Name) *</label>
                        <input type="text" id="new-tab-name" placeholder="เช่น ระบบงานภายใน, เว็บไซต์ลูกค้า, แดชบอร์ด" class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" required />
                        ${existingCats.length > 0 ? `
                            <div class="mt-2 flex flex-wrap items-center gap-1.5">
                                <span class="text-[11px] text-slate-400">แท็บเดิมที่มีอยู่:</span>
                                ${existingCats.map(cat => `
                                    <button type="button" onclick="document.getElementById('new-tab-name').value='${cat.replace(/'/g, "\\'")}'" class="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 hover:bg-slate-200 transition">
                                        ${cat}
                                    </button>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1.5">เลือกบริษัทที่ต้องการให้อยู่ในแท็บนี้:</label>
                        <p class="text-[11px] text-slate-400 mb-2.5">ติ๊กเลือกบริษัทที่ต้องการให้แสดงเมื่อคลิกแท็บนี้</p>
                        <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
                            ${this.companies.map(c => `
                                <label class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition">
                                    <div class="flex items-center gap-2.5 min-w-0">
                                        <div class="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-sm overflow-hidden flex-shrink-0">
                                            ${c.logo_image ? `<img src="${c.logo_image}" class="w-full h-full object-cover" />` : (c.logo_emoji || '🏢')}
                                        </div>
                                        <div class="min-w-0">
                                            <div class="text-xs font-bold text-slate-800 truncate">${c.name_th}</div>
                                            <div class="text-[10px] text-slate-400 truncate">หมวดหมู่ปัจจุบัน: ${c.category || 'ไม่มี'}</div>
                                        </div>
                                    </div>
                                    <input type="checkbox" name="selected_tab_companies" value="${c.id}" class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 ml-2" />
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                        <button type="button" onclick="app.closeModal()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition">ยกเลิก</button>
                        <button type="submit" class="px-5 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm">+ บันทึกสร้างแท็บ</button>
                    </div>
                </form>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        modal.classList.remove("hidden");
    }

    handleCreateTab(e) {
        e.preventDefault();
        const tabName = (document.getElementById("new-tab-name").value || "").trim();
        if (!tabName) return;

        const checkboxes = document.querySelectorAll("input[name='selected_tab_companies']:checked");
        const selectedIds = Array.from(checkboxes).map(cb => cb.value);

        if (selectedIds.length === 0) {
            this.showToast("กรุณาเลือกอย่างน้อย 1 บริษัทเพื่อจัดเข้าแท็บนี้", "error");
            return;
        }

        this.companies = this.companies.map(c => {
            if (selectedIds.includes(c.id)) {
                return { ...c, category: tabName };
            }
            return c;
        });

        this.selectedCategory = tabName;
        this.saveLocalData(true);
        this.closeModal();
        this.renderPortalScreen();
        if (window.lucide) window.lucide.createIcons();
        this.showToast(`สร้างแท็บ "${tabName}" เรียบร้อยแล้ว`, "success");
    }

    handlePortalSearch(val) {
        this.portalSearchQuery = val;
        this.renderPortalScreen();
        if (window.lucide) window.lucide.createIcons();
    }

    // =========================================================================
    // VIEW 3: EMBEDDED VIEWER LOGIC & CONTROLS
    // =========================================================================
    openEmbeddedViewer(companyId, targetUrl, title = "เว็บไซต์หลัก") {
        this.viewerCurrentCompanyId = companyId;
        this.viewerCurrentUrl = targetUrl || "https://www.google.com";
        this.viewerCurrentTitle = title;
        this.viewMode = "viewer";
        this.render();
    }

    closeEmbeddedViewer() {
        this.viewMode = "portal";
        const iframe = document.getElementById("viewer-iframe");
        if (iframe) iframe.src = "about:blank";
        this.render();
    }

    renderEmbeddedViewerScreen() {
        const comp = this.companies.find(c => c.id === this.viewerCurrentCompanyId) || this.companies[0];
        if (!comp) return;

        const nameEl = document.getElementById("viewer-company-name");
        const logoEl = document.getElementById("viewer-company-logo");
        const titleEl = document.getElementById("viewer-link-title");
        const urlInput = document.getElementById("viewer-url-input");
        const externalBtn = document.getElementById("viewer-open-external-btn");
        const sublinksSelect = document.getElementById("viewer-sublinks-select");
        const iframe = document.getElementById("viewer-iframe");

        if (nameEl) nameEl.textContent = comp.name_th;
        if (titleEl) titleEl.textContent = this.viewerCurrentTitle || "เว็บไซต์หลัก";
        if (logoEl) {
            logoEl.innerHTML = comp.logo_image 
                ? `<img src="${comp.logo_image}" class="w-full h-full object-cover" />`
                : `<span>${comp.logo_emoji || '🏢'}</span>`;
        }

        if (urlInput) urlInput.value = this.viewerCurrentUrl;
        if (externalBtn) externalBtn.href = this.viewerCurrentUrl;

        // Sublinks dropdown
        if (sublinksSelect) {
            const allLinks = this.getCompanyLinks(comp);
            let options = "";
            allLinks.forEach((lnk, i) => {
                options += `<option value="${lnk.url}" ${this.viewerCurrentUrl === lnk.url ? 'selected' : ''}>${i === 0 ? '🌐' : '🔗'} [${lnk.title}] ${lnk.url}</option>`;
            });
            sublinksSelect.innerHTML = options;
        }

        // Set iframe URL if changed
        if (iframe && iframe.src !== this.viewerCurrentUrl) {
            iframe.src = this.viewerCurrentUrl;
        }
    }

    switchViewerUrl(newUrl) {
        if (!newUrl) return;
        this.viewerCurrentUrl = newUrl;
        const comp = this.companies.find(c => c.id === this.viewerCurrentCompanyId);
        let title = "เว็บไซต์หลัก";
        if (comp) {
            const foundSub = (comp.sub_links || []).find(s => s.url === newUrl);
            if (foundSub) title = foundSub.title;
        }
        this.viewerCurrentTitle = title;
        this.renderEmbeddedViewerScreen();
    }

    reloadViewerIframe() {
        const iframe = document.getElementById("viewer-iframe");
        if (iframe) {
            const current = iframe.src;
            iframe.src = "about:blank";
            setTimeout(() => { iframe.src = current; }, 100);
            this.showToast("กำลังรีโหลดหน้าเว็บ...", "info");
        }
    }

    copyCurrentViewerUrl() {
        if (this.viewerCurrentUrl) {
            this.copyCompanyUrl(this.viewerCurrentUrl);
        }
    }

    copyCompanyUrl(url) {
        if (!url) return;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => {
                this.showToast("📋 คัดลอกลิงก์เรียบร้อยแล้ว: " + url, "success");
            }).catch(() => {
                prompt("คัดลอกลิงก์:", url);
            });
        } else {
            prompt("คัดลอกลิงก์:", url);
        }
    }

    loadDemoData() {
        this.companies = typeof DEMO_COMPANIES !== "undefined" ? JSON.parse(JSON.stringify(DEMO_COMPANIES)) : [];
        this.currentCompanyId = this.companies[0] ? this.companies[0].id : null;
        this.saveLocalData();
        this.showToast("✨ โหลดข้อมูลตัวอย่างสำหรับเดโม่เรียบร้อยแล้ว", "success");
        this.render();
    }

    clearAllData() {
        if (confirm("คุณต้องการล้างข้อมูลบริษัททั้งหมดเพื่อเริ่มใช้งานจริงใช่หรือไม่?")) {
            this.companies = [];
            this.currentCompanyId = null;
            this.saveLocalData();
            this.showToast("ล้างข้อมูลบริษัทเรียบร้อยแล้ว (โหมดพร้อมใช้จริง)", "info");
            this.render();
        }
    }

    toggleDataMode() {
        if (this.companies.length > 0) {
            this.clearAllData();
        } else {
            this.loadDemoData();
        }
    }

    redeemInviteCode() {
        const input = document.getElementById("portal-invite-input");
        if (!input) return;
        const code = input.value.trim().toUpperCase();
        if (!code) return;

        const comp = this.companies.find(c => c.invite_code.toUpperCase() === code);
        if (comp) {
            this.enterWorkspace(comp.id);
            this.showToast(`เข้าสู่ระบบบัญชี ${comp.name_th} สำเร็จ!`, "success");
        } else {
            alert(`ไม่พบรหัสเชิญ "${code}" ในระบบ กรุณาตรวจสอบรหัสอีกครั้ง`);
        }
    }

    enterWorkspace(companyId) {
        this.currentCompanyId = companyId;
        this.viewMode = "workspace";
        this.activeTab = "dashboard";
        this.render();
    }

    exitToPortal() {
        this.viewMode = "portal";
        this.render();
    }

    // =========================================================================
    // VIEW 2: DEDICATED WORKSPACE VIEW
    // =========================================================================
    renderWorkspaceScreen() {
        this.updateWorkspaceHeaders();
        this.updateSidebarNav();
        this.renderActiveTab();
    }

    updateWorkspaceHeaders() {
        const comp = this.getCurrentCompany();

        const sbEmoji = document.getElementById("sidebar-comp-emoji");
        const sbName = document.getElementById("sidebar-comp-name");
        if (sbEmoji) {
            if (comp.logo_image) {
                sbEmoji.innerHTML = `<img src="${comp.logo_image}" class="w-6 h-6 rounded-md object-cover inline-block" />`;
            } else {
                sbEmoji.textContent = comp.logo_emoji || "🏢";
            }
        }
        if (sbName) sbName.textContent = comp.name_th;

        const breadcrumbName = document.getElementById("breadcrumb-company-name");
        if (breadcrumbName) {
            breadcrumbName.textContent = comp.name_th;
        }

        // Top navigation user profile chip and actions
        const topNavActions = document.getElementById("workspace-user-header-actions");
        if (topNavActions) {
            topNavActions.innerHTML = `
                <button onclick="app.exitToPortal()" class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition shadow-xs" title="กลับหน้าศูนย์รวมลิงก์">
                    <i data-lucide="grid" class="w-3.5 h-3.5 text-blue-600"></i>
                    <span>กลับหน้ารวมลิงก์</span>
                </button>

                <button onclick="app.copyCurrentInvite()" class="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition" title="คัดลอกลิงก์ตรงเข้าบริษัท">
                    <i data-lucide="share-2" class="w-4 h-4"></i>
                </button>
            `;
        }

        const avatar = document.getElementById("user-avatar-img");
        const nameDisplay = document.getElementById("user-name-display");
        const roleBadge = document.getElementById("user-role-badge");
        if (avatar) avatar.src = this.currentUser.avatar;
        if (nameDisplay) nameDisplay.textContent = this.currentUser.full_name;
        if (roleBadge) roleBadge.textContent = this.getRoleThaiName(this.currentUser.role);
    }

    getRoleThaiName(role) {
        const roleMap = {
            super_admin: "Super Admin (บัญชีกลาง)",
            company_manager: "ผู้บริหารบริษัท (Manager)",
            accountant: "เจ้าหน้าที่บัญชี (Accountant)",
            auditor: "ผู้ตรวจสอบบัญชี (Auditor)"
        };
        return roleMap[role] || role;
    }

    getRoleThaiShortName(role) {
        const roleMap = {
            super_admin: "HQ Admin",
            company_manager: "Manager",
            accountant: "Accountant",
            auditor: "Auditor"
        };
        return roleMap[role] || role;
    }

    updateSidebarNav() {
        const isSuperAdmin = this.currentUser.role === "super_admin";
        const canApprove = this.hasPermission("approve_transaction");
        const metrics = this.calculateMetrics();

        const pendingBadge = document.getElementById("nav-pending-badge");
        if (pendingBadge) {
            if (metrics.pendingCount > 0) {
                pendingBadge.textContent = metrics.pendingCount;
                pendingBadge.classList.remove("hidden");
            } else {
                pendingBadge.classList.add("hidden");
            }
        }

        const adminElements = document.querySelectorAll(".menu-superadmin-only");
        if (adminElements) {
            adminElements.forEach(el => {
                if (el && el.style) el.style.display = isSuperAdmin ? "flex" : "none";
            });
        }

        const approvalNav = document.getElementById("nav-approvals");
        if (approvalNav && approvalNav.style) {
            approvalNav.style.display = (canApprove || isSuperAdmin) ? "flex" : "none";
        }

        document.querySelectorAll(".nav-item").forEach(item => {
            if (item.dataset.tab === this.activeTab) {
                item.classList.add("bg-slate-100", "text-navy-900", "font-bold");
                item.classList.remove("text-slate-600");
            } else {
                item.classList.remove("bg-slate-100", "text-navy-900", "font-bold");
                item.classList.add("text-slate-600");
            }
        });
    }

    renderActiveTab() {
        const container = document.getElementById("tab-content-container");
        if (!container) return;

        switch (this.activeTab) {
            case "dashboard":
                container.innerHTML = this.renderCompanyDashboardView();
                this.initDashboardCharts();
                break;
            case "transactions":
                container.innerHTML = this.renderTransactionsView();
                break;
            case "approvals":
                container.innerHTML = this.renderApprovalsView();
                break;
            case "pnl_report":
                container.innerHTML = this.renderPnLReportView();
                break;
            case "tax_report":
                container.innerHTML = this.renderTaxReportView();
                break;
            case "companies":
                container.innerHTML = this.renderCompaniesView();
                break;
            case "users":
                container.innerHTML = this.renderUsersView();
                break;
            case "settings":
                container.innerHTML = this.renderSettingsView();
                break;
            default:
                container.innerHTML = this.renderCompanyDashboardView();
                this.initDashboardCharts();
        }
    }

    // =========================================================================
    // DEDICATED COMPANY DASHBOARD (With Period Filter & Clean Layout)
    // =========================================================================
    renderCompanyDashboardView() {
        const currentComp = this.getCurrentCompany() || this.companies[0];
        const metrics = this.calculateMetrics(currentComp.id);

        return `
            <div class="space-y-6">
                <!-- Clean Hero Header -->
                <div class="bg-white p-6 md:p-8 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div class="flex items-start gap-4">
                        <div class="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-3xl shadow-inner flex-shrink-0 overflow-hidden">
                            ${currentComp.logo_image ? `<img src="${currentComp.logo_image}" class="w-full h-full object-cover" />` : `<span>${currentComp.logo_emoji || '🏢'}</span>`}
                        </div>
                        <div class="space-y-1">
                            <div class="flex items-center gap-2">
                                <h1 class="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
                                    ${currentComp.name_th}
                                </h1>
                                <button onclick="app.openEditCompanyModal('${currentComp.id}')" title="แก้ไขชื่อและภาพบริษัท" class="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition">
                                    <i data-lucide="edit-3" class="w-4 h-4"></i>
                                </button>
                            </div>
                            <p class="text-xs text-slate-500">
                                เลขผู้เสียภาษี: ${currentComp.tax_id} | สาขา ${currentComp.branch_code} | ${currentComp.address}
                            </p>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2.5">
                        <button onclick="app.exitToPortal()" class="px-3.5 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition flex items-center gap-1.5">
                            <i data-lucide="arrow-left" class="w-3.5 h-3.5"></i>
                            <span>เลือกบริษัทอื่น</span>
                        </button>

                        <button onclick="app.copyCurrentInvite()" class="px-3.5 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition flex items-center gap-1.5">
                            <i data-lucide="share-2" class="w-3.5 h-3.5"></i>
                            <span>แชร์ลิงก์บริษัท</span>
                        </button>

                        ${this.hasPermission("create_transaction") ? `
                            <button onclick="app.openRecordModal()" class="px-4 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm flex items-center gap-1.5">
                                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                                <span>บันทึกรายรับ-รายจ่าย</span>
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- Financial Period Selector Pill -->
                <div class="flex items-center justify-between bg-white px-5 py-3 rounded-2xl border border-slate-200/80 shadow-sm text-xs">
                    <div class="flex items-center gap-2 text-slate-500">
                        <i data-lucide="calendar" class="w-4 h-4 text-slate-400"></i>
                        <span>ช่วงเวลารายงาน:</span>
                    </div>
                    <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                        <button onclick="app.setPeriodFilter('all')" class="px-3 py-1 rounded-lg font-medium transition ${this.filterPeriod === 'all' ? 'bg-white text-navy-900 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
                            ทั้งหมด
                        </button>
                        <button onclick="app.setPeriodFilter('2026-Q1')" class="px-3 py-1 rounded-lg font-medium transition ${this.filterPeriod === '2026-Q1' ? 'bg-white text-navy-900 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
                            ไตรมาส 1/2026
                        </button>
                        <button onclick="app.setPeriodFilter('2026-03')" class="px-3 py-1 rounded-lg font-medium transition ${this.filterPeriod === '2026-03' ? 'bg-white text-navy-900 font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900'}">
                            มีนาคม 2026
                        </button>
                    </div>
                </div>

                <!-- 4 KPI Cards (Spacious, Tabular figures, Elegant) -->
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    <!-- รายรับรวม -->
                    <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-500">รายรับสะสม (Revenue)</span>
                            <span class="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                                <i data-lucide="trending-up" class="w-4 h-4"></i>
                            </span>
                        </div>
                        <div class="mt-4">
                            <div class="text-2xl font-bold text-slate-900 tabular-nums">฿${this.formatCurrency(metrics.totalIncome)}</div>
                            <div class="text-[11px] text-emerald-600 mt-1 flex items-center gap-1 font-medium">
                                <i data-lucide="arrow-up-right" class="w-3 h-3"></i>
                                <span>ยอดขายและบริการสุทธิ</span>
                            </div>
                        </div>
                    </div>

                    <!-- รายจ่ายรวม -->
                    <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-500">รายจ่ายรวม (Expenses)</span>
                            <span class="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
                                <i data-lucide="trending-down" class="w-4 h-4"></i>
                            </span>
                        </div>
                        <div class="mt-4">
                            <div class="text-2xl font-bold text-slate-900 tabular-nums">฿${this.formatCurrency(metrics.totalExpense)}</div>
                            <div class="text-[11px] text-rose-500 mt-1 flex items-center gap-1 font-medium">
                                <i data-lucide="arrow-down-right" class="w-3 h-3"></i>
                                <span>ต้นทุน & ค่าใช้จ่ายดำเนินงาน</span>
                            </div>
                        </div>
                    </div>

                    <!-- กำไรสุทธิ -->
                    <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-500">กำไรสุทธิ (Net Profit)</span>
                            <span class="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                                <i data-lucide="pie-chart" class="w-4 h-4"></i>
                            </span>
                        </div>
                        <div class="mt-4">
                            <div class="text-2xl font-bold ${metrics.netProfit >= 0 ? 'text-blue-600' : 'text-rose-600'} tabular-nums">
                                ฿${this.formatCurrency(metrics.netProfit)}
                            </div>
                            <div class="text-[11px] text-slate-500 mt-1 font-medium">
                                อัตรากำไร: <strong class="text-slate-700">${metrics.profitMargin}%</strong>
                            </div>
                        </div>
                    </div>

                    <!-- รายการรออนุมัติ -->
                    <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-500">รายการรอดำเนินการ (Pending)</span>
                            <span class="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                                <i data-lucide="clock" class="w-4 h-4"></i>
                            </span>
                        </div>
                        <div class="mt-4">
                            <div class="text-2xl font-bold text-amber-600 tabular-nums">
                                ${metrics.pendingCount} <span class="text-xs font-normal text-slate-400">รายการ</span>
                            </div>
                            <div class="text-[11px] text-slate-500 mt-1 font-medium">
                                มูลค่ารอเบิก: ฿${this.formatCurrency(metrics.totalPending)}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Charts Section: Cash Flow & Expense Structure -->
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div class="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                        <div class="flex items-center justify-between mb-4">
                            <div>
                                <h3 class="text-sm font-bold text-slate-900">
                                    แนวโน้มกระแสเงินสดรายเดือน (Cash Flow Trend)
                                </h3>
                                <p class="text-xs text-slate-400">แสดงภาพรวมรายรับเทียบรายจ่าย</p>
                            </div>
                        </div>
                        <div class="h-64">
                            <canvas id="mainDashboardChart"></canvas>
                        </div>
                    </div>

                    <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                        <div class="flex items-center justify-between mb-4">
                            <div>
                                <h3 class="text-sm font-bold text-slate-900">โครงสร้างค่าใช้จ่าย (Expense Structure)</h3>
                                <p class="text-xs text-slate-400">สัดส่วนค่าใช้จ่ายตามหมวดหมู่</p>
                            </div>
                        </div>
                        <div class="h-64 flex items-center justify-center">
                            <canvas id="expenseDoughnutChart"></canvas>
                        </div>
                    </div>
                </div>

                <!-- Recent Transactions Card -->
                <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                    <div class="p-5 border-b border-slate-100 flex items-center justify-between">
                        <div>
                            <h3 class="text-sm font-bold text-slate-900">รายการธุรกรรมล่าสุด</h3>
                            <p class="text-xs text-slate-400">คลิกที่รายการเพื่อดูใบสำคัญ (Voucher) และรายละเอียด</p>
                        </div>
                        <button onclick="app.switchTab('transactions')" class="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                            <span>ดูรายการทั้งหมด</span>
                            <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                    ${this.renderTransactionTableHTML(this.getVisibleTransactions().slice(0, 5), true)}
                </div>
            </div>
        `;
    }

    setPeriodFilter(p) {
        this.filterPeriod = p;
        this.render();
    }

    initDashboardCharts() {
        const ctxMain = document.getElementById("mainDashboardChart");
        if (ctxMain) {
            if (this.charts.main) this.charts.main.destroy();

            const history = INITIAL_MOCK_DATA.historicalData;
            this.charts.main = new Chart(ctxMain, {
                type: "line",
                data: {
                    labels: history.map(h => h.month),
                    datasets: [
                        {
                            label: "เงินสดรับ",
                            data: history.map(h => h.income * 0.35),
                            borderColor: "#10b981",
                            backgroundColor: "rgba(16, 185, 129, 0.08)",
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: "เงินสดจ่าย",
                            data: history.map(h => h.expense * 0.35),
                            borderColor: "#f43f5e",
                            backgroundColor: "rgba(244, 63, 94, 0.04)",
                            fill: true,
                            tension: 0.3
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: "top", labels: { boxWidth: 12, font: { size: 11 } } } }
                }
            });
        }

        const ctxDoughnut = document.getElementById("expenseDoughnutChart");
        if (ctxDoughnut) {
            if (this.charts.doughnut) this.charts.doughnut.destroy();

            const txs = this.getVisibleTransactions().filter(t => t.type === "expense");
            const catMap = {};
            txs.forEach(t => {
                catMap[t.category_name] = (catMap[t.category_name] || 0) + Number(t.subtotal);
            });

            const labels = Object.keys(catMap);
            const data = Object.values(catMap);

            this.charts.doughnut = new Chart(ctxDoughnut, {
                type: "doughnut",
                data: {
                    labels: labels.length ? labels : ["ไม่มีข้อมูล"],
                    datasets: [{
                        data: data.length ? data : [1],
                        backgroundColor: ["#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#64748b"],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } }
                }
            });
        }
    }

    // =========================================================================
    // TRANSACTIONS VIEW
    // =========================================================================
    renderTransactionsView() {
        const transactions = this.getVisibleTransactions();

        return `
            <div class="space-y-6">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                    <div>
                        <h1 class="text-xl font-bold text-slate-900">บันทึกรายการบัญชี & บิลเอกสาร</h1>
                        <p class="text-xs text-slate-500 mt-1">
                            จัดการรายรับ-รายจ่าย คำนวณ VAT 7% และหัก ณ ที่จ่าย (WHT)
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="app.exportToCSV()" class="px-3.5 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition flex items-center gap-1.5">
                            <i data-lucide="download" class="w-3.5 h-3.5"></i>
                            <span>ส่งออก Excel</span>
                        </button>
                        ${this.hasPermission("create_transaction") ? `
                            <button onclick="app.openRecordModal()" class="px-4 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm flex items-center gap-1.5">
                                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                                <span>สร้างรายการ</span>
                            </button>
                        ` : ''}
                    </div>
                </div>

                <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-center gap-3">
                    <div class="relative flex-1 w-full">
                        <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input type="text" value="${this.filterSearch}" placeholder="ค้นหาเลขที่รายการ, รายละเอียด, คู่ค้า..." 
                            oninput="app.handleSearchInput(this.value)"
                            class="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white" />
                    </div>

                    <select onchange="app.handleStatusFilter(this.value)" class="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-none">
                        <option value="all" ${this.filterStatus === 'all' ? 'selected' : ''}>สถานะทั้งหมด</option>
                        <option value="pending" ${this.filterStatus === 'pending' ? 'selected' : ''}>รออนุมัติ</option>
                        <option value="approved" ${this.filterStatus === 'approved' ? 'selected' : ''}>อนุมัติแล้ว</option>
                        <option value="paid" ${this.filterStatus === 'paid' ? 'selected' : ''}>ชำระแล้ว</option>
                        <option value="rejected" ${this.filterStatus === 'rejected' ? 'selected' : ''}>ปฏิเสธ</option>
                    </select>
                </div>

                <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                    ${this.renderTransactionTableHTML(transactions, true)}
                </div>
            </div>
        `;
    }

    renderTransactionTableHTML(transactions, allowActions = true) {
        if (!transactions || transactions.length === 0) {
            return `
                <div class="p-12 text-center text-slate-400">
                    <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 stroke-1 text-slate-300"></i>
                    <p class="text-xs font-medium">ไม่พบรายการธุรกรรมตามเงื่อนไข</p>
                </div>
            `;
        }

        return `
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                            <th class="py-3 px-4">เลขที่ / วันที่</th>
                            <th class="py-3 px-4">หมวดหมู่</th>
                            <th class="py-3 px-4">รายละเอียด & คู่ค้า</th>
                            <th class="py-3 px-4 text-right">ยอดก่อนภาษี</th>
                            <th class="py-3 px-4 text-center">ภาษี VAT / WHT</th>
                            <th class="py-3 px-4 text-right">ยอดสุทธิ</th>
                            <th class="py-3 px-4 text-center">สถานะ</th>
                            <th class="py-3 px-4 text-center">ใบสำคัญ</th>
                            ${allowActions ? '<th class="py-3 px-4 text-center">จัดการ</th>' : ''}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 text-xs text-slate-700">
                        ${transactions.map(t => {
                            const comp = this.companies.find(c => c.id === t.company_id);
                            const isIncome = t.type === "income";

                            return `
                                <tr class="hover:bg-slate-50/70 transition cursor-pointer" onclick="if(!event.target.closest('button')) app.openVoucherModal('${t.id}')">
                                    <td class="py-3 px-4 whitespace-nowrap">
                                        <div class="font-bold text-slate-900 hover:text-blue-600 transition">${t.transaction_no}</div>
                                        <div class="text-[11px] text-slate-400">${t.transaction_date}</div>
                                    </td>

                                    <td class="py-3 px-4 whitespace-nowrap">
                                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${isIncome ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                                            ${isIncome ? 'รายรับ' : 'รายจ่าย'}
                                        </span>
                                        <div class="text-[11px] text-slate-500 mt-0.5">${t.category_name}</div>
                                    </td>

                                    <td class="py-3 px-4">
                                        <div class="font-medium text-slate-900 line-clamp-1">${t.description}</div>
                                        <div class="text-[11px] text-slate-400 line-clamp-1">คู่ค้า: ${t.counterparty_name}</div>
                                    </td>

                                    <td class="py-3 px-4 text-right whitespace-nowrap font-medium text-slate-700 tabular-nums">
                                        ฿${this.formatCurrency(t.subtotal)}
                                    </td>

                                    <td class="py-3 px-4 text-center whitespace-nowrap text-[11px]">
                                        <div>${t.has_vat ? `<span class="text-emerald-700 font-medium">VAT: ฿${this.formatCurrency(t.vat_amount)}</span>` : '<span class="text-slate-300">-</span>'}</div>
                                        <div>${t.has_wht ? `<span class="text-amber-700 font-medium">WHT ${t.wht_rate}%: ฿${this.formatCurrency(t.wht_amount)}</span>` : ''}</div>
                                    </td>

                                    <td class="py-3 px-4 text-right whitespace-nowrap tabular-nums">
                                        <span class="font-bold ${isIncome ? 'text-emerald-600' : 'text-slate-900'}">
                                            ฿${this.formatCurrency(t.total_amount)}
                                        </span>
                                    </td>

                                    <td class="py-3 px-4 text-center whitespace-nowrap">
                                        ${this.renderStatusBadge(t.status)}
                                    </td>

                                    <td class="py-3 px-4 text-center whitespace-nowrap">
                                        <button onclick="event.stopPropagation(); app.openVoucherModal('${t.id}')" class="text-[11px] text-blue-600 hover:text-blue-800 font-medium bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition">
                                            ใบสำคัญ
                                        </button>
                                    </td>

                                    ${allowActions ? `
                                        <td class="py-3 px-4 text-center whitespace-nowrap">
                                            <div class="flex items-center justify-center gap-1">
                                                ${(t.status === "pending" && this.hasPermission("approve_transaction")) ? `
                                                    <button onclick="event.stopPropagation(); app.approveTransaction('${t.id}')" title="อนุมัติ" class="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                                                        <i data-lucide="check" class="w-4 h-4"></i>
                                                    </button>
                                                    <button onclick="event.stopPropagation(); app.rejectTransaction('${t.id}')" title="ปฏิเสธ" class="p-1 text-rose-600 hover:bg-rose-50 rounded">
                                                        <i data-lucide="x" class="w-4 h-4"></i>
                                                    </button>
                                                ` : ''}

                                                ${(t.status === "approved" && this.hasPermission("create_transaction")) ? `
                                                    <button onclick="event.stopPropagation(); app.markAsPaid('${t.id}')" title="ลงบันทึกชำระเงิน" class="p-1 text-blue-600 hover:bg-blue-50 rounded">
                                                        <i data-lucide="check-check" class="w-4 h-4"></i>
                                                    </button>
                                                ` : ''}

                                                ${(this.currentUser.role === "super_admin" || (this.currentUser.role === "accountant" && t.status === "pending")) ? `
                                                    <button onclick="event.stopPropagation(); app.deleteTransaction('${t.id}')" title="ลบ" class="p-1 text-slate-400 hover:text-rose-600 rounded">
                                                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                                    </button>
                                                ` : ''}
                                            </div>
                                        </td>
                                    ` : ''}
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderStatusBadge(status) {
        const map = {
            pending: { label: "รออนุมัติ", bg: "bg-amber-50 text-amber-700 border-amber-200" },
            approved: { label: "อนุมัติแล้ว", bg: "bg-blue-50 text-blue-700 border-blue-200" },
            paid: { label: "ชำระแล้ว", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            rejected: { label: "ปฏิเสธ", bg: "bg-rose-50 text-rose-700 border-rose-200" }
        };
        const s = map[status] || { label: status, bg: "bg-slate-100 text-slate-700 border-slate-200" };
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${s.bg}">${s.label}</span>`;
    }

    // =========================================================================
    // APPROVALS VIEW (With Batch Approve)
    // =========================================================================
    renderApprovalsView() {
        const pendingTxs = this.getVisibleTransactions().filter(t => t.status === "pending");
        const totalPending = pendingTxs.reduce((sum, t) => sum + Number(t.total_amount || 0), 0);

        return `
            <div class="space-y-6">
                <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 class="text-xl font-bold text-slate-900">ศูนย์อนุมัติรายการเบิกจ่าย</h1>
                        <p class="text-xs text-slate-500 mt-1">
                            ตรวจสอบเอกสารแนบและอนุมัติใบแจ้งหนี้ก่อนจ่ายเงินจริง
                        </p>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-xs bg-amber-50 text-amber-800 px-3 py-1.5 rounded-xl border border-amber-200">
                            รออนุมัติ <strong>${pendingTxs.length}</strong> รายการ (฿${this.formatCurrency(totalPending)})
                        </div>
                        ${(pendingTxs.length > 0 && this.hasPermission("approve_transaction")) ? `
                            <button onclick="app.approveAllPending()" class="px-3.5 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm transition flex items-center gap-1.5">
                                <i data-lucide="check-check" class="w-3.5 h-3.5"></i>
                                <span>อนุมัติทั้งหมด</span>
                            </button>
                        ` : ''}
                    </div>
                </div>

                <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                    ${this.renderTransactionTableHTML(pendingTxs, true)}
                </div>
            </div>
        `;
    }

    approveAllPending() {
        const pendingTxs = this.getVisibleTransactions().filter(t => t.status === "pending");
        if (pendingTxs.length === 0) return;
        if (!confirm(`คุณต้องการอนุมัติรายการที่รออนุมัติทั้ง ${pendingTxs.length} รายการใช่หรือไม่?`)) return;

        pendingTxs.forEach(t => {
            t.status = "approved";
            t.approved_by = this.currentUser.id;
            t.approved_at = new Date().toISOString();
        });

        this.saveLocalData();
        this.showToast(`อนุมัติสำเร็จทั้ง ${pendingTxs.length} รายการ`, "success");
        this.render();
    }

    // =========================================================================
    // VOUCHER DETAIL MODAL (ใบสำคัญรับ / ใบสำคัญจ่าย)
    // =========================================================================
    openVoucherModal(txId) {
        const tx = this.transactions.find(t => t.id === txId);
        if (!tx) return;

        const comp = this.companies.find(c => c.id === tx.company_id);
        const modal = document.getElementById("modal-container");
        const modalContent = document.getElementById("modal-content");
        if (!modal || !modalContent) return;

        const isIncome = tx.type === "income";
        const voucherTitle = isIncome ? "ใบสำคัญรับ (RECEIPT VOUCHER)" : "ใบสำคัญจ่าย (PAYMENT VOUCHER)";
        const thaiBaht = this.bahtText(tx.total_amount);

        modalContent.innerHTML = `
            <div class="p-8 space-y-6">
                <div class="flex items-center justify-between pb-4 border-b border-slate-200">
                    <div class="flex items-center gap-3">
                        <span class="text-2xl">${comp ? comp.logo_emoji : '🏢'}</span>
                        <div>
                            <div class="font-bold text-sm text-slate-900">${comp ? comp.name_th : 'กลุ่มบริษัทในเครือ'}</div>
                            <div class="text-[11px] text-slate-400">${voucherTitle}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="window.print()" class="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition flex items-center gap-1">
                            <i data-lucide="printer" class="w-3.5 h-3.5"></i>
                            <span>พิมพ์</span>
                        </button>
                        <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-600 p-1"><i data-lucide="x" class="w-4 h-4"></i></button>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4 text-xs">
                    <div class="space-y-1">
                        <div><span class="text-slate-400">เลขที่ใบสำคัญ:</span> <strong class="font-mono text-slate-800">${tx.transaction_no}</strong></div>
                        <div><span class="text-slate-400">วันที่ทำรายการ:</span> <span class="text-slate-700 font-medium">${tx.transaction_date}</span></div>
                        <div><span class="text-slate-400">เลขอ้างอิง:</span> <span class="font-mono text-slate-700">${tx.reference_no || '-'}</span></div>
                    </div>
                    <div class="space-y-1 text-right">
                        <div><span class="text-slate-400">คู่ค้า/ผู้รับเงิน:</span> <strong class="text-slate-800">${tx.counterparty_name}</strong></div>
                        <div><span class="text-slate-400">เลขผู้เสียภาษี:</span> <span class="font-mono text-slate-700">${tx.counterparty_tax_id || '-'}</span></div>
                        <div><span class="text-slate-400">สถานะ:</span> ${this.renderStatusBadge(tx.status)}</div>
                    </div>
                </div>

                <div class="border border-slate-200 rounded-xl overflow-hidden">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                            <tr>
                                <th class="py-2.5 px-4">รายการบัญชี & คำอธิบาย</th>
                                <th class="py-2.5 px-4 text-right">จำนวนเงิน (บาท)</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            <tr>
                                <td class="py-3 px-4">
                                    <div class="font-semibold text-slate-800">[${tx.category_name}]</div>
                                    <div class="text-slate-500 text-[11px]">${tx.description}</div>
                                </td>
                                <td class="py-3 px-4 text-right font-medium tabular-nums">฿${this.formatCurrency(tx.subtotal)}</td>
                            </tr>
                            ${tx.has_vat ? `
                                <tr class="text-slate-600">
                                    <td class="py-2 px-4 text-[11px]">ภาษีมูลค่าเพิ่ม (VAT 7%)</td>
                                    <td class="py-2 px-4 text-right tabular-nums text-emerald-700">+฿${this.formatCurrency(tx.vat_amount)}</td>
                                </tr>
                            ` : ''}
                            ${tx.has_wht ? `
                                <tr class="text-slate-600">
                                    <td class="py-2 px-4 text-[11px]">หัก: ภาษีเงินได้หัก ณ ที่จ่าย (${tx.wht_rate}%)</td>
                                    <td class="py-2 px-4 text-right tabular-nums text-amber-700">-฿${this.formatCurrency(tx.wht_amount)}</td>
                                </tr>
                            ` : ''}
                            <tr class="bg-slate-50 font-bold border-t border-slate-200 text-slate-900">
                                <td class="py-3 px-4">ยอดเงินสุทธิทั้งสิ้น</td>
                                <td class="py-3 px-4 text-right text-base text-blue-700 tabular-nums">฿${this.formatCurrency(tx.total_amount)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-xs text-blue-900 flex items-center justify-between">
                    <span class="font-medium">จำนวนเงินตัวอักษร:</span>
                    <strong class="font-bold">(${thaiBaht})</strong>
                </div>

                ${tx.attachment_name ? `
                    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                        <div class="flex items-center gap-2 text-slate-600">
                            <i data-lucide="paperclip" class="w-4 h-4 text-blue-600"></i>
                            <span>เอกสารแนบ: <strong>${tx.attachment_name}</strong></span>
                        </div>
                        <span class="text-emerald-600 font-bold text-[10px] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">ตรวจสอบแล้ว</span>
                    </div>
                ` : ''}

                <div class="pt-6 grid grid-cols-2 gap-8 text-center text-xs text-slate-500 border-t border-slate-100">
                    <div>
                        <div class="border-b border-dashed border-slate-300 h-10 mb-2"></div>
                        <p class="font-semibold text-slate-700">ผู้จัดทำ / เจ้าหน้าที่บัญชี</p>
                    </div>
                    <div>
                        <div class="border-b border-dashed border-slate-300 h-10 mb-2"></div>
                        <p class="font-semibold text-slate-700">ผู้อนุมัติ / ผู้บริหาร</p>
                    </div>
                </div>
            </div>
        `;

        modal.classList.remove("hidden");
        if (window.lucide) window.lucide.createIcons();
    }

    // =========================================================================
    // P&L REPORT VIEW (A4 Printable with Baht Text)
    // =========================================================================
    renderPnLReportView() {
        const targetCompId = (this.activeReportCompany && this.activeReportCompany !== "all") ? this.activeReportCompany : this.currentCompanyId;
        const comp = this.companies.find(c => c.id === targetCompId) || this.companies[0];
        const metrics = this.calculateMetrics(targetCompId);

        let txs = this.transactions.filter(t => t.status !== "rejected" && t.company_id === targetCompId);

        const incomeCategories = {};
        const expenseCategories = {};
        txs.forEach(t => {
            const sub = Number(t.subtotal) || 0;
            if (t.type === "income") incomeCategories[t.category_name] = (incomeCategories[t.category_name] || 0) + sub;
            else if (t.type === "expense") expenseCategories[t.category_name] = (expenseCategories[t.category_name] || 0) + sub;
        });

        const netProfitBahtText = this.bahtText(metrics.netProfit);

        return `
            <div class="space-y-6">
                <div class="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                    <div>
                        <h1 class="text-xl font-bold text-slate-900">งบกำไรขาดทุน (P&L Statement)</h1>
                        <p class="text-xs text-slate-500 mt-1">รายงานผลการดำเนินงานทางการเงิน จัดรูปแบบมาตรฐาน A4 สำหรับการพิมพ์</p>
                    </div>

                    <div class="flex items-center gap-2.5">
                        <select onchange="app.handleReportCompanyChange(this.value)" class="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl text-slate-700">
                            ${this.companies.map(c => `<option value="${c.id}" ${targetCompId === c.id ? "selected" : ""}>${c.name_th}</option>`).join("")}
                        </select>

                        <button onclick="window.print()" class="px-4 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm flex items-center gap-1.5">
                            <i data-lucide="printer" class="w-3.5 h-3.5"></i>
                            <span>พิมพ์รายงาน A4</span>
                        </button>
                    </div>
                </div>

                <div class="bg-white p-8 md:p-12 rounded-2xl border border-slate-200 shadow-sm printable-report max-w-4xl mx-auto">
                    <div class="official-header pb-4 mb-6 border-b-2 border-slate-900 text-center">
                        <h1 class="text-lg font-bold text-slate-900">${comp.name_th}</h1>
                        <h2 class="text-sm font-semibold text-slate-700 mt-1">งบกำไรขาดทุน (Profit and Loss Statement)</h2>
                        <p class="text-xs text-slate-500 mt-1">สำหรับไตรมาสที่ 1 สิ้นสุดวันที่ 31 มีนาคม 2026</p>
                    </div>

                    <table class="w-full text-xs print-table border-collapse">
                        <thead>
                            <tr class="border-b border-slate-300 bg-slate-50 text-slate-700 font-bold">
                                <th class="py-2.5 px-4 text-left">รายการบัญชี</th>
                                <th class="py-2.5 px-4 text-right w-36">จำนวนเงิน (บาท)</th>
                                <th class="py-2.5 px-4 text-right w-20">%</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            <tr class="font-bold bg-slate-50/50"><td colspan="3" class="py-2 px-4 text-slate-900">1. รายได้ (Revenues)</td></tr>
                            ${Object.entries(incomeCategories).map(([name, amount]) => `
                                <tr>
                                    <td class="py-2 px-8 text-slate-600">${name}</td>
                                    <td class="py-2 px-4 text-right tabular-nums">${this.formatCurrency(amount)}</td>
                                    <td class="py-2 px-4 text-right text-slate-400">${metrics.totalIncome > 0 ? ((amount/metrics.totalIncome)*100).toFixed(1) : 0}%</td>
                                </tr>
                            `).join("")}
                            <tr class="font-bold border-t border-slate-300">
                                <td class="py-2 px-4">รวมรายได้ทั้งสิ้น</td>
                                <td class="py-2 px-4 text-right text-emerald-700 tabular-nums">${this.formatCurrency(metrics.totalIncome)}</td>
                                <td class="py-2 px-4 text-right">100%</td>
                            </tr>

                            <tr class="font-bold bg-slate-50/50"><td colspan="3" class="py-2 px-4 text-slate-900 mt-4">2. ค่าใช้จ่าย (Expenses)</td></tr>
                            ${Object.entries(expenseCategories).map(([name, amount]) => `
                                <tr>
                                    <td class="py-2 px-8 text-slate-600">${name}</td>
                                    <td class="py-2 px-4 text-right tabular-nums">${this.formatCurrency(amount)}</td>
                                    <td class="py-2 px-4 text-right text-slate-400">${metrics.totalIncome > 0 ? ((amount/metrics.totalIncome)*100).toFixed(1) : 0}%</td>
                                </tr>
                            `).join("")}
                            <tr class="font-bold border-t border-slate-300">
                                <td class="py-2 px-4">รวมค่าใช้จ่ายทั้งสิ้น</td>
                                <td class="py-2 px-4 text-right text-rose-700 tabular-nums">${this.formatCurrency(metrics.totalExpense)}</td>
                                <td class="py-2 px-4 text-right">${metrics.totalIncome > 0 ? ((metrics.totalExpense/metrics.totalIncome)*100).toFixed(1) : 0}%</td>
                            </tr>

                            <tr class="print-total-row font-bold text-sm bg-slate-50 border-t-2 border-b-2 border-slate-900">
                                <td class="py-3 px-4">กำไรสุทธิประจำงวด (Net Profit)</td>
                                <td class="py-3 px-4 text-right text-blue-800 tabular-nums">฿${this.formatCurrency(metrics.netProfit)}</td>
                                <td class="py-3 px-4 text-right">${metrics.profitMargin}%</td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="mt-4 p-2.5 bg-slate-50 border border-slate-200 rounded text-xs text-center font-medium text-slate-700">
                        (${netProfitBahtText})
                    </div>

                    <div class="print-signature-section mt-14 pt-6 grid grid-cols-3 gap-6 text-center text-xs text-slate-600">
                        <div>
                            <div class="signature-line border-b border-dashed border-slate-400 h-10 mb-2"></div>
                            <p class="font-semibold text-slate-800">ผู้จัดทำบัญชี</p>
                        </div>
                        <div>
                            <div class="signature-line border-b border-dashed border-slate-400 h-10 mb-2"></div>
                            <p class="font-semibold text-slate-800">ผู้ตรวจสอบบัญชี (CPA)</p>
                        </div>
                        <div>
                            <div class="signature-line border-b border-dashed border-slate-400 h-10 mb-2"></div>
                            <p class="font-semibold text-slate-800">กรรมการผู้มีอำนาจลงนาม</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // TAX REPORT VIEW (With Thai Baht Text)
    // =========================================================================
    renderTaxReportView() {
        const targetCompId = (this.activeReportCompany && this.activeReportCompany !== "all") ? this.activeReportCompany : this.currentCompanyId;
        const comp = this.companies.find(c => c.id === targetCompId) || this.companies[0];

        let txs = this.transactions.filter(t => (t.has_vat || t.has_wht) && t.company_id === targetCompId);
        const metrics = this.calculateMetrics(targetCompId);
        const netVatBahtText = this.bahtText(Math.abs(metrics.netVat));

        return `
            <div class="space-y-6">
                <div class="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                    <div>
                        <h1 class="text-xl font-bold text-slate-900">รายงานภาษีมูลค่าเพิ่ม (VAT 7%) และหัก ณ ที่จ่าย (WHT)</h1>
                        <p class="text-xs text-slate-500 mt-1">สรุปข้อมูลสำหรับแบบ ภ.พ. 30 และ ภ.ง.ด. 3/53</p>
                    </div>

                    <div class="flex items-center gap-2.5">
                        <select onchange="app.handleReportCompanyChange(this.value)" class="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl text-slate-700">
                            ${this.companies.map(c => `<option value="${c.id}" ${targetCompId === c.id ? "selected" : ""}>${c.name_th}</option>`).join("")}
                        </select>
                        <button onclick="window.print()" class="px-4 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm flex items-center gap-1.5">
                            <i data-lucide="printer" class="w-3.5 h-3.5"></i>
                            <span>พิมพ์รายงาน A4</span>
                        </button>
                    </div>
                </div>

                <div class="bg-white p-8 md:p-12 rounded-2xl border border-slate-200 shadow-sm printable-report max-w-5xl mx-auto">
                    <div class="official-header pb-4 mb-6 border-b-2 border-slate-900 text-center">
                        <h1 class="text-lg font-bold text-slate-900">${comp.name_th}</h1>
                        <h2 class="text-sm font-semibold text-slate-700 mt-1">รายงานภาษีซื้อและภาษีขาย ประจำเดือน มีนาคม 2026</h2>
                    </div>

                    <div class="grid grid-cols-3 gap-4 mb-6 text-center text-xs">
                        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <span class="text-slate-400">ภาษีขาย (Output Tax)</span>
                            <div class="text-base font-bold text-emerald-700 mt-1 tabular-nums">฿${this.formatCurrency(metrics.totalVatOutput)}</div>
                        </div>
                        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <span class="text-slate-400">ภาษีซื้อ (Input Tax)</span>
                            <div class="text-base font-bold text-rose-700 mt-1 tabular-nums">฿${this.formatCurrency(metrics.totalVatInput)}</div>
                        </div>
                        <div class="p-3 bg-blue-50 rounded-xl border border-blue-200">
                            <span class="text-blue-600 font-medium">ภาษีที่ต้องชำระ/(ขอคืน) สุทธิ</span>
                            <div class="text-base font-bold text-blue-800 mt-1 tabular-nums">฿${this.formatCurrency(metrics.netVat)}</div>
                        </div>
                    </div>

                    <table class="w-full text-xs print-table border-collapse">
                        <thead>
                            <tr class="bg-slate-100 text-slate-700 font-bold border-b border-slate-300">
                                <th class="py-2 px-3 text-center">ลำดับ</th>
                                <th class="py-2 px-3 text-left">วันที่</th>
                                <th class="py-2 px-3 text-left">เลขที่ใบกำกับ</th>
                                <th class="py-2 px-3 text-left">ชื่อคู่ค้า</th>
                                <th class="py-2 px-3 text-right">มูลค่าสินค้า</th>
                                <th class="py-2 px-3 text-right">VAT 7%</th>
                                <th class="py-2 px-3 text-right">หัก ณ ที่จ่าย</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${txs.map((t, index) => `
                                <tr>
                                    <td class="py-2 px-3 text-center">${index + 1}</td>
                                    <td class="py-2 px-3">${t.transaction_date}</td>
                                    <td class="py-2 px-3 font-medium">${t.reference_no || t.transaction_no}</td>
                                    <td class="py-2 px-3">${t.counterparty_name}</td>
                                    <td class="py-2 px-3 text-right tabular-nums">฿${this.formatCurrency(t.subtotal)}</td>
                                    <td class="py-2 px-3 text-right font-semibold ${t.type === 'income' ? 'text-emerald-700' : 'text-rose-700'} tabular-nums">฿${this.formatCurrency(t.vat_amount)}</td>
                                    <td class="py-2 px-3 text-right tabular-nums">${t.has_wht ? `฿${this.formatCurrency(t.wht_amount)}` : '-'}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>

                    <div class="mt-4 p-2.5 bg-slate-50 border border-slate-200 rounded text-xs text-center font-medium text-slate-700">
                        ภาษีสุทธิ: (${netVatBahtText})
                    </div>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // COMPANIES MANAGEMENT
    // =========================================================================
    renderCompaniesView() {
        return `
            <div class="space-y-6">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                    <div>
                        <h1 class="text-xl font-bold text-slate-900">จัดการบริษัทในเครือ (Multi-Tenants)</h1>
                        <p class="text-xs text-slate-500 mt-1">เพิ่มบริษัทใหม่และออกลิงก์เชิญเฉพาะบริษัท</p>
                    </div>
                    ${this.hasPermission("manage_companies") ? `
                        <button onclick="app.openCompanyModal()" class="px-4 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm flex items-center gap-1.5">
                            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                            <span>เพิ่มบริษัทใหม่</span>
                        </button>
                    ` : ''}
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${this.companies.map(c => `
                        <div class="bg-white rounded-2xl border border-slate-200/80 p-6 flex flex-col justify-between shadow-sm">
                            <div>
                                <div class="flex items-start justify-between">
                                    <div class="w-12 h-12 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-2xl shadow-inner overflow-hidden flex-shrink-0">
                                        ${c.logo_image ? `<img src="${c.logo_image}" class="w-full h-full object-cover" />` : `<span>${c.logo_emoji || '🏢'}</span>`}
                                    </div>
                                    <span class="text-xs font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">${c.code}</span>
                                </div>
                                <h3 class="text-base font-bold text-slate-900 mt-3">${c.name_th}</h3>
                                <p class="text-xs text-slate-400">${c.tax_id}</p>
                                <div class="mt-3 text-xs text-slate-500 line-clamp-2">${c.address}</div>
                            </div>
                            <div class="mt-6 pt-4 border-t border-slate-100 flex items-center gap-2">
                                <button onclick="app.copyInviteLink('${c.id}')" class="flex-1 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition">
                                    คัดลอกลิงก์
                                </button>
                                <button onclick="app.openEditCompanyModal('${c.id}')" class="px-3 py-2 text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition flex items-center gap-1">
                                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                                    <span>แก้ไข</span>
                                </button>
                                <button onclick="app.enterWorkspace('${c.id}')" class="px-3 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-lg transition">
                                    เข้าทำงาน
                                </button>
                            </div>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
    }

    // =========================================================================
    // USERS MANAGEMENT
    // =========================================================================
    renderUsersView() {
        return `
            <div class="space-y-6">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                    <div>
                        <h1 class="text-xl font-bold text-slate-900">จัดการผู้ใช้งานและสิทธิ์ (Users & RBAC)</h1>
                        <p class="text-xs text-slate-500 mt-1">กำหนดบทบาทผู้ใช้งานในแต่ละบริษัท</p>
                    </div>
                    ${this.hasPermission("manage_users") ? `
                        <button onclick="app.openUserModal()" class="px-4 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl transition shadow-sm flex items-center gap-1.5">
                            <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
                            <span>เพิ่มผู้ใช้งาน</span>
                        </button>
                    ` : ''}
                </div>

                <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                    <table class="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr class="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold">
                                <th class="py-3 px-4">ผู้ใช้งาน</th>
                                <th class="py-3 px-4">บทบาท (Role)</th>
                                <th class="py-3 px-4">สังกัดบริษัท</th>
                                <th class="py-3 px-4 text-center">สลับใช้งาน</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${this.users.map(u => {
                                const comp = this.companies.find(c => c.id === u.company_id);
                                const isCurrent = u.id === this.currentUser.id;
                                return `
                                    <tr class="hover:bg-slate-50 transition">
                                        <td class="py-3 px-4 flex items-center gap-3">
                                            <img src="${u.avatar}" class="w-8 h-8 rounded-lg object-cover" />
                                            <div>
                                                <div class="font-bold text-slate-900">${u.full_name}</div>
                                                <div class="text-[11px] text-slate-400">${u.email}</div>
                                            </div>
                                        </td>
                                        <td class="py-3 px-4">
                                            <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                                                ${this.getRoleThaiName(u.role)}
                                            </span>
                                        </td>
                                        <td class="py-3 px-4">
                                            ${comp ? `${comp.logo_emoji} ${comp.name_th}` : '🏢 HQ ส่วนกลาง'}
                                        </td>
                                        <td class="py-3 px-4 text-center">
                                            ${!isCurrent ? `
                                                <button onclick="app.switchUser('${u.id}')" class="px-3 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg">สลับโปรไฟล์</button>
                                            ` : '<span class="text-slate-400 font-medium">ปัจจุบัน</span>'}
                                        </td>
                                    </tr>
                                `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // SETTINGS VIEW (Firebase Cloud Settings & Reset)
    // =========================================================================
    renderSettingsView() {
        const isConnected = !!this.db;
        const currentCfg = this.firebaseCfg ? JSON.stringify(this.firebaseCfg, null, 2) : "";

        return `
            <div class="space-y-6 max-w-3xl">
                <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
                    <div>
                        <h1 class="text-xl font-bold text-slate-900">การตั้งค่าฐานข้อมูล Firebase Cloud</h1>
                        <p class="text-xs text-slate-500 mt-1">เชื่อมต่อ Firebase Firestore เพื่อจัดเก็บและซิงค์ข้อมูลถาวรข้ามอุปกรณ์</p>
                    </div>
                    <span class="px-3 py-1 text-xs font-bold rounded-full ${isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                        ${isConnected ? '🟢 Firebase Active' : '⚪ Local Mode'}
                    </span>
                </div>

                <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4 text-xs">
                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">Firebase Configuration (จาก Firebase Project Settings)</label>
                        <textarea id="settings-firebase-cfg" rows="9" placeholder='const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "my-project.firebaseapp.com",
  projectId: "my-project",
  storageBucket: "my-project.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};' class="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500">${currentCfg}</textarea>
                        <p class="text-[11px] text-slate-400 mt-1">สามารถก๊อปปี้ทั้งบล็อกหรือเฉพาะ JSON จากหน้า Firebase Console มาวางได้ทันที</p>
                    </div>

                    <div class="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                        <button onclick="app.resetMockData()" class="text-rose-600 hover:underline">รีเซ็ตข้อมูลเริ่มต้น</button>
                        <div class="flex items-center gap-2">
                            <button onclick="app.syncWithFirebase()" class="px-3.5 py-2 text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl transition">
                                ซิงค์ข้อมูลกับ Firebase
                            </button>
                            <button onclick="app.saveFirebaseSettingsView()" class="px-4 py-2 text-xs font-semibold bg-navy-900 hover:bg-slate-800 text-white rounded-xl shadow-sm transition">
                                บันทึกการเชื่อมต่อ
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    saveFirebaseSettingsView() {
        const input = document.getElementById("settings-firebase-cfg")?.value.trim();
        if (!input) {
            this.showToast("กรุณาระบุ Firebase Config", "error");
            return;
        }

        try {
            let cfg = null;
            const match = input.match(/\{[\s\S]*\}/);
            if (match) {
                const jsonStr = match[0]
                    .replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":')
                    .replace(/'([^']*)'/g, '"$1"')
                    .replace(/,\s*\}/g, '}');
                cfg = JSON.parse(jsonStr);
            } else {
                cfg = JSON.parse(input);
            }

            if (!cfg || !cfg.projectId) {
                throw new Error("ต้องมี projectId ใน config");
            }

            localStorage.setItem("mc_firebase_cfg", JSON.stringify(cfg));
            this.firebaseCfg = cfg;
            this.initFirebase();
            this.showToast("🔥 บันทึกและเชื่อมต่อ Firebase สำเร็จ", "success");
            this.syncWithFirebase();
            this.render();
        } catch (e) {
            alert("รูปแบบ Firebase Config ไม่ถูกต้อง: " + e.message);
        }
    }

    // =========================================================================
    // MODALS: Record Transaction, Add Company, Add User
    // =========================================================================
    openRecordModal() {
        const modal = document.getElementById("modal-container");
        const modalContent = document.getElementById("modal-content");
        if (!modal || !modalContent) return;

        const targetCompanies = this.hasPermission("view_all_companies") ? this.companies : [this.getCurrentCompany()];

        modalContent.innerHTML = `
            <div class="p-6">
                <div class="flex items-center justify-between pb-4 border-b border-slate-100">
                    <h2 class="text-base font-bold text-slate-900 flex items-center gap-2">
                        <i data-lucide="plus-circle" class="w-4 h-4 text-blue-600"></i>
                        <span>บันทึกรายการบัญชี & บิลเอกสาร</span>
                    </h2>
                    <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>

                <form onsubmit="app.handleSaveTransaction(event)" class="mt-4 space-y-3.5 text-xs">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">บริษัท *</label>
                            <select id="tx-company-id" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl" required>
                                ${targetCompanies.map(c => `<option value="${c.id}" ${c.id === this.currentCompanyId ? 'selected' : ''}>${c.logo_emoji} ${c.name_th}</option>`).join("")}
                            </select>
                        </div>
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">วันที่ทำรายการ *</label>
                            <input type="date" id="tx-date" value="${new Date().toISOString().split('T')[0]}" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl" required />
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">ประเภท *</label>
                            <select id="tx-type" onchange="app.updateCategoriesDropdown()" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl" required>
                                <option value="expense">รายจ่าย (Expense)</option>
                                <option value="income">รายรับ (Income)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">หมวดหมู่บัญชี *</label>
                            <select id="tx-category" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl" required>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">รายละเอียดรายการ *</label>
                        <input type="text" id="tx-description" placeholder="ระบุรายละเอียด เช่น ค่าบริการระบบ, ซื้อสินค้า" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl" required />
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">ชื่อคู่ค้า / ลูกค้า *</label>
                            <input type="text" id="tx-counterparty" placeholder="ชื่อบริษัท หรือ บุคคล" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl" required />
                        </div>
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">เลขประจำตัวผู้เสียภาษีคู่ค้า</label>
                            <input type="text" id="tx-counterparty-taxid" maxlength="13" placeholder="13 หลัก (ถ้ามี)" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl" />
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">เลขอ้างอิง (ใบเสร็จ/ใบแจ้งหนี้)</label>
                            <input type="text" id="tx-ref-no" placeholder="INV-XXXX" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl" />
                        </div>
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">ยอดก่อนภาษี (บาท) *</label>
                            <input type="number" step="0.01" id="tx-subtotal" value="10000.00" oninput="app.recalculateTaxes()" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold tabular-nums" required />
                        </div>
                    </div>

                    <!-- Tax Box -->
                    <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                        <div class="font-bold text-slate-800 flex items-center gap-1.5">
                            <i data-lucide="calculator" class="w-3.5 h-3.5 text-blue-600"></i>
                            <span>การคำนวณภาษี (VAT & WHT)</span>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-[11px] text-slate-500 mb-1">ภาษี VAT 7%</label>
                                <select id="tx-vat-type" onchange="app.recalculateTaxes()" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs">
                                    <option value="exclude">แยกนอก (Excl. VAT 7%)</option>
                                    <option value="include">รวมใน (Incl. VAT 7%)</option>
                                    <option value="none">ไม่มี VAT</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-[11px] text-slate-500 mb-1">หัก ณ ที่จ่าย (WHT)</label>
                                <select id="tx-wht-rate" onchange="app.recalculateTaxes()" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs">
                                    <option value="0">ไม่หัก (0%)</option>
                                    <option value="1">1% (ค่าขนส่ง)</option>
                                    <option value="2">2% (ค่าโฆษณา)</option>
                                    <option value="3">3% (ค่าบริการ / จ้างทำของ)</option>
                                    <option value="5">5% (ค่าเช่า)</option>
                                </select>
                            </div>
                        </div>

                        <div class="pt-2 border-t border-slate-200 grid grid-cols-3 gap-2 text-center text-xs">
                            <div>
                                <span class="text-[10px] text-slate-400">VAT:</span>
                                <div id="calc-vat-display" class="font-bold text-emerald-700">฿700.00</div>
                            </div>
                            <div>
                                <span class="text-[10px] text-slate-400">หัก ณ ที่จ่าย:</span>
                                <div id="calc-wht-display" class="font-bold text-amber-700">฿0.00</div>
                            </div>
                            <div>
                                <span class="text-[10px] text-slate-400">ยอดรวมสุทธิ:</span>
                                <div id="calc-total-display" class="font-bold text-slate-900 text-sm">฿10,700.00</div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">แนบไฟล์สลิป / ใบกำกับภาษี</label>
                        <input type="file" id="tx-file-input" onchange="app.handleFileSelect(event)" class="text-xs text-slate-500" />
                        <div id="tx-file-preview-name" class="text-[11px] text-slate-400 mt-1">จำลองการแนบไฟล์หลักฐาน</div>
                    </div>

                    <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                        <button type="button" onclick="app.closeModal()" class="px-3.5 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg">ยกเลิก</button>
                        <button type="submit" class="px-4 py-1.5 bg-navy-900 hover:bg-slate-800 text-white font-semibold rounded-lg shadow-sm">บันทึกรายการ</button>
                    </div>
                </form>
            </div>
        `;

        modal.classList.remove("hidden");
        this.updateCategoriesDropdown();
        this.recalculateTaxes();
        if (window.lucide) window.lucide.createIcons();
    }

    updateCategoriesDropdown() {
        const type = document.getElementById("tx-type").value;
        const catSelect = document.getElementById("tx-category");
        if (!catSelect) return;

        const filtered = this.categories.filter(c => c.type === type);
        catSelect.innerHTML = filtered.map(c => `<option value="${c.id}" data-name="${c.name}">[${c.code}] ${c.name}</option>`).join("");
    }

    recalculateTaxes() {
        const subtotalInput = document.getElementById("tx-subtotal");
        const vatTypeInput = document.getElementById("tx-vat-type");
        const whtRateInput = document.getElementById("tx-wht-rate");

        if (!subtotalInput || !vatTypeInput || !whtRateInput) return;

        const subtotal = parseFloat(subtotalInput.value) || 0;
        const vatType = vatTypeInput.value;
        const whtRate = parseFloat(whtRateInput.value) || 0;

        let vatAmount = 0;
        let baseForWht = subtotal;

        if (vatType === "exclude") {
            vatAmount = subtotal * 0.07;
            baseForWht = subtotal;
        } else if (vatType === "include") {
            vatAmount = subtotal * 7 / 107;
            baseForWht = subtotal - vatAmount;
        }

        const whtAmount = baseForWht * (whtRate / 100);

        let totalAmount = 0;
        if (vatType === "exclude") totalAmount = subtotal + vatAmount - whtAmount;
        else totalAmount = subtotal - whtAmount;

        document.getElementById("calc-vat-display").textContent = "฿" + this.formatCurrency(vatAmount);
        document.getElementById("calc-wht-display").textContent = "฿" + this.formatCurrency(whtAmount);
        document.getElementById("calc-total-display").textContent = "฿" + this.formatCurrency(totalAmount);

        this.tempCalculations = {
            subtotal,
            vatType,
            has_vat: vatType !== "none",
            vat_amount: vatAmount,
            has_wht: whtRate > 0,
            wht_rate: whtRate,
            wht_amount: whtAmount,
            total_amount: totalAmount
        };
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            document.getElementById("tx-file-preview-name").textContent = `ไฟล์: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
            this.tempAttachmentName = file.name;
        }
    }

    handleSaveTransaction(e) {
        e.preventDefault();
        const compId = document.getElementById("tx-company-id").value;
        const txDate = document.getElementById("tx-date").value;
        const txType = document.getElementById("tx-type").value;
        const catSelect = document.getElementById("tx-category");
        const categoryId = catSelect.value;
        const categoryName = catSelect.options[catSelect.selectedIndex].getAttribute("data-name");
        const description = document.getElementById("tx-description").value;
        const counterparty = document.getElementById("tx-counterparty").value;
        const counterpartyTaxId = document.getElementById("tx-counterparty-taxid").value;
        const refNo = document.getElementById("tx-ref-no").value;

        this.recalculateTaxes();
        const calc = this.tempCalculations;

        const comp = this.companies.find(c => c.id === compId);
        const codePrefix = comp ? comp.code.toUpperCase().replace("COMP_", "") : "TX";
        const autoNo = `TX-${codePrefix}-${new Date().toISOString().slice(0,7).replace("-","")}-${Math.floor(100 + Math.random() * 900)}`;

        const newTx = {
            id: "tx_" + Date.now(),
            company_id: compId,
            transaction_no: autoNo,
            transaction_date: txDate,
            type: txType,
            category_id: categoryId,
            category_name: categoryName,
            description: description,
            reference_no: refNo || autoNo,
            counterparty_name: counterparty,
            counterparty_tax_id: counterpartyTaxId || "-",
            subtotal: calc.subtotal,
            has_vat: calc.has_vat,
            vat_type: calc.vatType,
            vat_rate: 7,
            vat_amount: calc.vat_amount,
            has_wht: calc.has_wht,
            wht_rate: calc.wht_rate,
            wht_amount: calc.wht_amount,
            total_amount: calc.total_amount,
            status: (this.currentUser.role === "company_manager" || this.currentUser.role === "super_admin") ? "approved" : "pending",
            payment_method: "bank_transfer",
            created_by: this.currentUser.id,
            approved_by: this.currentUser.role === "company_manager" ? this.currentUser.id : null,
            approved_at: this.currentUser.role === "company_manager" ? new Date().toISOString() : null,
            attachment_name: this.tempAttachmentName || (txType === "expense" ? "Payment_Slip.pdf" : "Receipt_Voucher.pdf"),
            created_at: new Date().toISOString()
        };

        this.transactions.unshift(newTx);
        this.saveLocalData();
        this.closeModal();
        this.showToast(`บันทึกรายการ ${autoNo} สำเร็จ`, "success");
        this.render();
    }

    getCompanyLinks(comp) {
        if (!comp) return [];
        if (Array.isArray(comp.website_links) && comp.website_links.length > 0) {
            return comp.website_links;
        }
        const links = [];
        if (comp.website_url) {
            links.push({
                id: "link_main",
                title: "เว็บไซต์หลัก",
                url: comp.website_url
            });
        }
        if (Array.isArray(comp.sub_links)) {
            comp.sub_links.forEach((s, idx) => {
                if (s && (s.url || s.title)) {
                    links.push({
                        id: s.id || `sub_${idx}`,
                        title: s.title || (s.badge ? `เว็บ${s.badge}` : `ระบบงานย่อย ${idx + 1}`),
                        url: s.url || "",
                        badge: s.badge || (/หลังบ้าน|admin|แอดมิน|จัดการ|สต็อก/i.test(s.title || '') ? "หลังบ้าน" : "ระบบ")
                    });
                }
            });
        }
        return links.length > 0 ? links : [{ id: "link_1", title: "เว็บไซต์หลัก", url: "" }];
    }

    renderEditingLinksRows(containerId = "edit-links-container") {
        const container = document.getElementById(containerId);
        if (!container) return;
        this.activeLinksContainerId = containerId;

        if (!this.tempEditingLinks || this.tempEditingLinks.length === 0) {
            this.tempEditingLinks = [{ id: "link_1", title: "เว็บหน้าบ้าน", url: "https://" }];
        }

        container.innerHTML = this.tempEditingLinks.map((link, idx) => {
            const canDelete = this.tempEditingLinks.length > 1;
            const safeTitle = (link.title || '').replace(/"/g, '&quot;');
            const safeUrl = (link.url || '').replace(/"/g, '&quot;');

            return `
                <div class="p-3 bg-white rounded-xl border border-slate-200/90 shadow-2xs space-y-2 group/row transition hover:border-slate-300">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">${idx + 1}</span>
                            <span class="text-xs font-bold text-slate-800 truncate">ลิงก์ที่ ${idx + 1}</span>
                            ${idx === 0 ? '<span class="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex-shrink-0">ลิงก์หลัก</span>' : ''}
                        </div>
                        <div class="flex items-center gap-1 flex-shrink-0">
                            <button type="button" onclick="app.testLinkUrl(${idx})" class="px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition flex items-center gap-1" title="ทดสอบเปิดลิงก์นี้">
                                <span>ทดสอบ</span>
                                <i data-lucide="external-link" class="w-3 h-3"></i>
                            </button>
                            ${canDelete ? `
                                <button type="button" onclick="app.removeEditingLinkRow(${idx})" class="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition active:scale-90" title="ลบช่องนี้">
                                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div class="sm:col-span-4">
                            <label class="block text-[10px] font-semibold text-slate-500 mb-0.5">ชื่อกำกับลิงก์เว็บ *</label>
                            <input type="text" value="${safeTitle}" placeholder="เช่น เว็บหน้าบ้าน, เว็บหลังบ้าน" oninput="app.updateEditingLinkField(${idx}, 'title', this.value)" class="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 transition" required />
                        </div>
                        <div class="sm:col-span-8">
                            <label class="block text-[10px] font-semibold text-slate-500 mb-0.5">URL เว็บไซต์ (https://...) *</label>
                            <input type="url" value="${safeUrl}" placeholder="https://example.com" oninput="app.updateEditingLinkField(${idx}, 'url', this.value)" class="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-blue-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 transition" required />
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        if (window.lucide) window.lucide.createIcons();
    }

    addEditingLinkRow(presetTitle = "") {
        if (!this.tempEditingLinks) this.tempEditingLinks = [];
        const nextTitle = presetTitle || (this.tempEditingLinks.length === 1 ? "เว็บหลังบ้าน" : `ลิงก์ที่ ${this.tempEditingLinks.length + 1}`);
        this.tempEditingLinks.push({
            id: "link_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
            title: nextTitle,
            url: "https://"
        });
        this.renderEditingLinksRows(this.activeLinksContainerId || "edit-links-container");
    }

    addEditingLinkPreset(presetTitle) {
        this.addEditingLinkRow(presetTitle);
    }

    removeEditingLinkRow(index) {
        if (!this.tempEditingLinks || this.tempEditingLinks.length <= 1) return;
        this.tempEditingLinks.splice(index, 1);
        this.renderEditingLinksRows(this.activeLinksContainerId || "edit-links-container");
    }

    updateEditingLinkField(index, field, value) {
        if (this.tempEditingLinks && this.tempEditingLinks[index]) {
            this.tempEditingLinks[index][field] = value;
        }
    }

    testLinkUrl(index) {
        if (!this.tempEditingLinks || !this.tempEditingLinks[index]) return;
        let url = (this.tempEditingLinks[index].url || "").trim();
        if (!url || url === "https://") {
            this.showToast("กรุณากรอก URL เว็บไซต์ก่อนทดสอบ", "error");
            return;
        }
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        window.open(url, "_blank");
    }

    openCompanyModal() {
        const modal = document.getElementById("modal-container");
        const modalContent = document.getElementById("modal-content");
        if (!modal || !modalContent) return;

        this.tempEditingLogo = null;
        this.tempEditingLinks = [
            { id: "link_1", title: "เว็บหน้าบ้าน", url: "https://" }
        ];

        modalContent.innerHTML = `
            <div class="p-4 sm:p-8">
                <div class="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-100">
                    <div class="flex items-center gap-2 sm:gap-2.5 min-w-0">
                        <div class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                            <i data-lucide="building-2" class="w-4 h-4"></i>
                        </div>
                        <div class="min-w-0">
                            <h2 class="text-sm sm:text-base font-bold text-slate-900 truncate">+ เพิ่มบริษัทหรือระบบงานใหม่</h2>
                            <p class="text-[11px] sm:text-xs text-slate-400 truncate">เพิ่มบริษัทในเครือ พร้อมระบุลิงก์เว็บไซต์หน้าบ้านและหลังบ้าน</p>
                        </div>
                    </div>
                    <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>

                <form onsubmit="app.handleSaveCompany(event)" class="mt-4 sm:mt-5 space-y-3.5 sm:space-y-4 text-xs">
                    <!-- Logo Section -->
                    <div class="p-3.5 sm:p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-3">
                        <label class="block font-bold text-slate-800 text-xs">โลโก้และรูปภาพบริษัท (Company Logo)</label>
                        
                        <div class="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
                            <div id="edit-logo-preview-box" class="w-16 h-16 rounded-2xl bg-white border-2 border-dashed border-slate-200 flex items-center justify-center text-3xl shadow-xs overflow-hidden flex-shrink-0">
                                <span id="edit-preview-emoji">🏢</span>
                            </div>

                            <div class="flex-1 space-y-2 w-full">
                                <input type="file" id="edit-comp-file" accept="image/*" onchange="app.handleLogoFileUpload(event)" class="w-full text-xs text-slate-500 file:mr-2.5 file:py-1 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-navy-900 file:text-white hover:file:bg-slate-800 cursor-pointer" />
                                <input type="url" id="edit-comp-logo-url" oninput="app.handleLogoUrlInput(this.value)" placeholder="หรือใส่ URL รูปภาพ (https://...)" class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-600" />
                            </div>
                        </div>

                        <div class="pt-2 border-t border-slate-200/60 flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <span class="text-[11px] font-semibold text-slate-500">หรือเลือก Emoji:</span>
                            <input type="text" id="new-comp-emoji" value="🏢" maxlength="4" oninput="app.handleEmojiInput(this.value)" class="w-10 px-2 py-1 bg-white border border-slate-200 rounded-lg text-center text-sm font-semibold" />
                            <div class="flex flex-wrap items-center gap-1">
                                ${['🏢', '💻', '🚚', '🛍️', '⚡', '🏥', '🌾', '🏗️', '☕', '📱'].map(e => `
                                    <button type="button" onclick="document.getElementById('new-comp-emoji').value='${e}'; app.clearLogoImage();" class="p-1 hover:bg-slate-200 rounded-lg transition text-sm">${e}</button>
                                `).join('')}
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">รหัสย่อบริษัท (Code) *</label>
                            <input type="text" id="new-comp-code" placeholder="เช่น comp_energy" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" required />
                        </div>
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">หมวดหมู่ธุรกิจ (Category)</label>
                            <input type="text" id="new-comp-category" placeholder="เช่น พลังงาน & สิ่งแวดล้อม" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" />
                        </div>
                    </div>

                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">ชื่อบริษัท (ภาษาไทย) *</label>
                        <input type="text" id="new-comp-name-th" placeholder="บริษัท สยาม เอนเนอร์ยี่ จำกัด" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" required />
                    </div>

                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">คำอธิบายรายละเอียดระบบงาน / บริษัท</label>
                        <textarea id="new-comp-desc" rows="2" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" placeholder="อธิบายหน้าที่ของเว็บไซต์หรือบริการของบริษัท"></textarea>
                    </div>

                    <!-- Dynamic Website Links Section -->
                    <div class="p-3.5 sm:p-4 bg-slate-50/90 rounded-2xl border border-slate-200/80 space-y-3">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                            <div>
                                <label class="block font-bold text-slate-800 text-xs">🌐 ลิงก์เว็บไซต์และระบบงาน (Website & System Links)</label>
                                <p class="text-[11px] text-slate-400 mt-0.5">เพิ่มได้ทั้งเว็บหน้าบ้าน, เว็บหลังบ้าน และระบบเสริมต่าง ๆ</p>
                            </div>
                            <button type="button" onclick="app.addEditingLinkRow()" class="px-3 py-1.5 bg-navy-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition active:scale-95">
                                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                                <span>+ เพิ่มช่องลิงก์เว็บ</span>
                            </button>
                        </div>

                        <!-- Quick Presets -->
                        <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            <span class="font-medium">เพิ่มด่วน:</span>
                            <button type="button" onclick="app.addEditingLinkPreset('เว็บหน้าบ้าน')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition font-medium">+ เว็บหน้าบ้าน</button>
                            <button type="button" onclick="app.addEditingLinkPreset('เว็บหลังบ้าน')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition font-medium">+ เว็บหลังบ้าน</button>
                            <button type="button" onclick="app.addEditingLinkPreset('ระบบแอดมิน')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition font-medium">+ ระบบแอดมิน</button>
                            <button type="button" onclick="app.addEditingLinkPreset('ระบบสต็อก')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition font-medium">+ ระบบสต็อก</button>
                        </div>

                        <!-- Links Rows Container -->
                        <div id="new-comp-links-container" class="space-y-2.5"></div>
                    </div>

                    <div class="pt-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
                        <button type="button" onclick="app.closeModal()" class="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold transition text-center">ยกเลิก</button>
                        <button type="submit" class="w-full sm:w-auto px-5 py-2.5 sm:py-2 bg-navy-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 active:scale-[0.98]">
                            <i data-lucide="check" class="w-3.5 h-3.5"></i>
                            <span>บันทึกและสร้างบริษัท</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        this.renderEditingLinksRows("new-comp-links-container");
        modal.classList.remove("hidden");
        if (window.lucide) window.lucide.createIcons();
    }

    handleSaveCompany(e) {
        e.preventDefault();
        const code = document.getElementById("new-comp-code").value.trim().toLowerCase();
        const emoji = document.getElementById("new-comp-emoji") ? document.getElementById("new-comp-emoji").value.trim() : "🏢";
        const nameTh = document.getElementById("new-comp-name-th").value.trim();
        const category = document.getElementById("new-comp-category").value.trim() || "ธุรกิจ & บริการ";
        const desc = document.getElementById("new-comp-desc").value.trim() || "ระบบงานและเว็บไซต์สำหรับองค์กร";

        // Collect and validate links
        const validLinks = (this.tempEditingLinks || []).map(l => ({
            id: l.id || ("link_" + Math.random()),
            title: (l.title || "").trim() || "เว็บไซต์",
            url: (l.url || "").trim()
        })).filter(l => l.url !== "" && l.url !== "https://");

        if (validLinks.length === 0) {
            this.showToast("กรุณาระบุ URL เว็บไซต์อย่างน้อย 1 ลิงก์", "error");
            return;
        }

        const inviteCode = "INV-" + code.toUpperCase().replace("COMP_", "") + "-" + Math.floor(1000 + Math.random() * 9000);

        const newCompany = {
            id: code,
            code: code,
            name_th: nameTh,
            name_en: nameTh,
            category: category,
            website_url: validLinks[0].url,
            website_links: validLinks,
            sub_links: validLinks.slice(1).map(l => ({ id: l.id, title: l.title, url: l.url, badge: l.title })),
            description: desc,
            status: "online",
            tax_id: "-",
            branch_code: "00000",
            address: "-",
            invite_code: inviteCode,
            logo_emoji: emoji || "🏢",
            logo_image: this.tempEditingLogo || null,
            created_at: new Date().toISOString()
        };

        this.companies.push(newCompany);
        this.saveLocalData();
        this.closeModal();
        this.showToast(`สร้างบริษัท ${nameTh} สำเร็จแล้ว`, "success");
        this.render();
    }

    openEditCompanyModal(companyId) {
        const modal = document.getElementById("modal-container");
        const modalContent = document.getElementById("modal-content");
        if (!modal || !modalContent) return;

        const comp = this.companies.find(c => c.id === companyId);
        if (!comp) return;

        this.editingCompanyId = companyId;
        this.tempEditingLogo = comp.logo_image || null;
        this.tempEditingLinks = JSON.parse(JSON.stringify(this.getCompanyLinks(comp)));

        modalContent.innerHTML = `
            <div class="p-4 sm:p-8">
                <div class="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-100">
                    <div class="flex items-center gap-2 sm:gap-2.5 min-w-0">
                        <div class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                            <i data-lucide="edit-3" class="w-4 h-4"></i>
                        </div>
                        <div class="min-w-0">
                            <h2 class="text-sm sm:text-base font-bold text-slate-900 truncate">แก้ไขข้อมูล เว็บไซต์ และลิงก์บริษัท</h2>
                            <p class="text-[11px] sm:text-xs text-slate-400 truncate">รหัสบริษัท: ${comp.code}</p>
                        </div>
                    </div>
                    <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>

                <form onsubmit="app.handleUpdateCompany(event, '${comp.id}')" class="mt-4 sm:mt-5 space-y-3.5 sm:space-y-4 text-xs">
                    
                    <!-- Logo / Image Branding Section -->
                    <div class="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-3">
                        <label class="block font-bold text-slate-800 text-xs">โลโก้และรูปภาพบริษัท (Company Logo)</label>
                        
                        <div class="flex flex-col sm:flex-row items-center gap-4">
                            <!-- Preview Box -->
                            <div id="edit-logo-preview-box" class="w-20 h-20 rounded-2xl bg-white border-2 border-dashed border-slate-200 flex items-center justify-center text-3xl shadow-xs overflow-hidden flex-shrink-0">
                                ${comp.logo_image ? `<img src="${comp.logo_image}" class="w-full h-full object-cover" />` : `<span id="edit-preview-emoji">${comp.logo_emoji || '🏢'}</span>`}
                            </div>

                            <div class="flex-1 space-y-2.5 w-full">
                                <!-- Upload File Button -->
                                <div>
                                    <span class="block text-[11px] font-semibold text-slate-600 mb-1">1. อัปโหลดไฟล์ภาพจากเครื่อง (PNG, JPG, SVG, WebP)</span>
                                    <input type="file" id="edit-comp-file" accept="image/*" onchange="app.handleLogoFileUpload(event)" class="w-full text-xs text-slate-500 file:mr-2.5 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-navy-900 file:text-white hover:file:bg-slate-800 cursor-pointer" />
                                </div>

                                <!-- Or URL input -->
                                <div>
                                    <span class="block text-[11px] font-semibold text-slate-600 mb-1">2. หรือใส่ URL รูปภาพโดยตรง</span>
                                    <input type="url" id="edit-comp-logo-url" value="${comp.logo_image && comp.logo_image.startsWith('http') ? comp.logo_image : ''}" oninput="app.handleLogoUrlInput(this.value)" placeholder="https://example.com/logo.png" class="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-600" />
                                </div>
                            </div>
                        </div>

                        <!-- Emoji Fallback & Quick Picker -->
                        <div class="pt-2 border-t border-slate-200/60 flex flex-wrap items-center gap-2">
                            <span class="text-[11px] font-semibold text-slate-500">หรือใช้ Emoji แทนภาพ:</span>
                            <input type="text" id="edit-comp-emoji" value="${comp.logo_emoji || '🏢'}" maxlength="4" oninput="app.handleEmojiInput(this.value)" class="w-12 px-2 py-1 bg-white border border-slate-200 rounded-lg text-center text-sm font-semibold" />
                            
                            <div class="flex items-center gap-1 text-base">
                                ${['🏢', '💻', '🚚', '🛍️', '⚡', '🏥', '🌾', '🏗️', '☕', '📱', '✈️', '🏦'].map(e => `
                                    <button type="button" onclick="app.selectQuickEmoji('${e}')" class="p-1 hover:bg-slate-200 rounded-lg transition text-sm">${e}</button>
                                `).join('')}
                            </div>

                            <button type="button" onclick="app.clearLogoImage()" class="ml-auto text-[11px] text-rose-600 hover:underline">
                                ล้างรูปภาพ (ใช้ Emoji)
                            </button>
                        </div>
                    </div>

                    <!-- Company Names -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">ชื่อบริษัท (ภาษาไทย) *</label>
                            <input type="text" id="edit-comp-name-th" value="${comp.name_th}" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" required />
                        </div>

                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">ชื่อบริษัท (ภาษาอังกฤษ)</label>
                            <input type="text" id="edit-comp-name-en" value="${comp.name_en || ''}" placeholder="Siam Example Co., Ltd." class="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" />
                        </div>
                    </div>

                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">หมวดหมู่ธุรกิจ</label>
                        <input type="text" id="edit-comp-category" value="${comp.category || ''}" placeholder="เช่น เทคโนโลยี & ซอฟต์แวร์" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" />
                    </div>

                    <!-- Description -->
                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">คำอธิบายรายละเอียดระบบงาน / องค์กร</label>
                        <textarea id="edit-comp-desc" rows="2" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600">${comp.description || ''}</textarea>
                    </div>

                    <!-- Dynamic Website Links Section (เว็บหน้าบ้าน / หลังบ้าน) -->
                    <div class="p-3.5 sm:p-4 bg-slate-50/90 rounded-2xl border border-slate-200/80 space-y-3">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                            <div>
                                <label class="block font-bold text-slate-800 text-xs">🌐 ลิงก์เว็บไซต์และระบบงาน (Website & System Links)</label>
                                <p class="text-[11px] text-slate-400 mt-0.5">เพิ่มได้ทั้งเว็บหน้าบ้าน, เว็บหลังบ้าน และระบบงานเสริม พร้อมตั้งชื่อกำกับได้อิสระ</p>
                            </div>
                            <button type="button" onclick="app.addEditingLinkRow()" class="px-3 py-1.5 bg-navy-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition active:scale-95">
                                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                                <span>+ เพิ่มช่องลิงก์เว็บ</span>
                            </button>
                        </div>

                        <!-- Quick Presets -->
                        <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            <span class="font-medium">เพิ่มด่วน:</span>
                            <button type="button" onclick="app.addEditingLinkPreset('เว็บหน้าบ้าน')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition font-medium">+ เว็บหน้าบ้าน</button>
                            <button type="button" onclick="app.addEditingLinkPreset('เว็บหลังบ้าน')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition font-medium">+ เว็บหลังบ้าน</button>
                            <button type="button" onclick="app.addEditingLinkPreset('ระบบแอดมิน')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition font-medium">+ ระบบแอดมิน</button>
                            <button type="button" onclick="app.addEditingLinkPreset('ระบบสต็อก')" class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition font-medium">+ ระบบสต็อก</button>
                        </div>

                        <!-- Links Rows Container -->
                        <div id="edit-links-container" class="space-y-2.5"></div>
                    </div>

                    <div class="pt-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
                        <button type="button" onclick="app.closeModal()" class="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold transition text-center">ยกเลิก</button>
                        <button type="submit" class="w-full sm:w-auto px-5 py-2.5 sm:py-2 bg-navy-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 active:scale-[0.98]">
                            <i data-lucide="check" class="w-3.5 h-3.5"></i>
                            <span>บันทึกการแก้ไขข้อมูล</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        this.renderEditingLinksRows("edit-links-container");
        modal.classList.remove("hidden");
        if (window.lucide) window.lucide.createIcons();
    }

    handleUpdateCompany(event, companyId) {
        event.preventDefault();
        const comp = this.companies.find(c => c.id === companyId);
        if (!comp) return;

        const nameTh = document.getElementById("edit-comp-name-th").value.trim();
        const nameEn = document.getElementById("edit-comp-name-en").value.trim();
        const category = document.getElementById("edit-comp-category").value.trim() || "ธุรกิจ & บริการ";
        const desc = document.getElementById("edit-comp-desc").value.trim();
        const emoji = document.getElementById("edit-comp-emoji").value.trim() || "🏢";

        // Collect and validate links
        const validLinks = (this.tempEditingLinks || []).map(l => ({
            id: l.id || ("link_" + Math.random()),
            title: (l.title || "").trim() || "เว็บไซต์",
            url: (l.url || "").trim()
        })).filter(l => l.url !== "" && l.url !== "https://");

        if (validLinks.length === 0) {
            this.showToast("กรุณาระบุ URL เว็บไซต์อย่างน้อย 1 ลิงก์", "error");
            return;
        }

        comp.name_th = nameTh;
        comp.name_en = nameEn;
        comp.category = category;
        comp.description = desc;
        comp.logo_emoji = emoji;
        comp.logo_image = this.tempEditingLogo;
        comp.website_url = validLinks[0].url;
        comp.website_links = validLinks;
        comp.sub_links = validLinks.slice(1).map(l => ({ id: l.id, title: l.title, url: l.url, badge: l.title }));

        this.saveLocalData();
        this.closeModal();
        this.showToast(`บันทึกการแก้ไขข้อมูลบริษัท ${comp.name_th} เรียบร้อยแล้ว`, "success");
        this.render();
    }

    handleLogoFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP, SVG)");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const rawDataUrl = e.target.result;
            // Compress and resize logo image (max 160x160) to keep base64 tiny (~10-20KB)
            // This prevents localStorage quota exceeded and Firestore document size limit issues
            const img = new Image();
            img.onload = () => {
                const maxDim = 160;
                let width = img.width;
                let height = img.height;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                // Convert to compressed webp or jpeg
                const compressedDataUrl = canvas.toDataURL("image/webp", 0.85);
                this.tempEditingLogo = compressedDataUrl;

                const previewBox = document.getElementById("edit-logo-preview-box");
                if (previewBox) {
                    previewBox.innerHTML = `<img src="${this.tempEditingLogo}" class="w-full h-full object-cover" />`;
                }
                const urlInput = document.getElementById("edit-comp-logo-url");
                if (urlInput) urlInput.value = "";
            };
            img.onerror = () => {
                // Fallback to raw data url if canvas processing fails
                this.tempEditingLogo = rawDataUrl;
                const previewBox = document.getElementById("edit-logo-preview-box");
                if (previewBox) {
                    previewBox.innerHTML = `<img src="${this.tempEditingLogo}" class="w-full h-full object-cover" />`;
                }
            };
            img.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
    }

    handleLogoUrlInput(url) {
        const trimmed = url.trim();
        const previewBox = document.getElementById("edit-logo-preview-box");
        if (trimmed) {
            this.tempEditingLogo = trimmed;
            if (previewBox) {
                previewBox.innerHTML = `<img src="${trimmed}" onerror="this.onerror=null; this.parentElement.innerHTML='⚠️'" class="w-full h-full object-cover" />`;
            }
        } else {
            this.tempEditingLogo = null;
            const emoji = document.getElementById("edit-comp-emoji")?.value || "🏢";
            if (previewBox) {
                previewBox.innerHTML = `<span id="edit-preview-emoji">${emoji}</span>`;
            }
        }
    }

    handleEmojiInput(emoji) {
        const trimmed = emoji.trim() || "🏢";
        if (!this.tempEditingLogo) {
            const previewBox = document.getElementById("edit-logo-preview-box");
            if (previewBox) {
                previewBox.innerHTML = `<span id="edit-preview-emoji">${trimmed}</span>`;
            }
        }
    }

    selectQuickEmoji(emoji) {
        const emojiInput = document.getElementById("edit-comp-emoji");
        if (emojiInput) emojiInput.value = emoji;
        this.clearLogoImage();
    }

    clearLogoImage() {
        this.tempEditingLogo = null;
        const fileInput = document.getElementById("edit-comp-file");
        if (fileInput) fileInput.value = "";
        const urlInput = document.getElementById("edit-comp-logo-url");
        if (urlInput) urlInput.value = "";

        const emoji = document.getElementById("edit-comp-emoji")?.value || "🏢";
        const previewBox = document.getElementById("edit-logo-preview-box");
        if (previewBox) {
            previewBox.innerHTML = `<span id="edit-preview-emoji">${emoji}</span>`;
        }
    }

    generateRandomPassword() {
        const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
        const numbers = "23456789";
        let res = "";
        for (let i = 0; i < 4; i++) {
            res += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        res += "@";
        for (let i = 0; i < 3; i++) {
            res += numbers.charAt(Math.floor(Math.random() * numbers.length));
        }
        return res;
    }

    refreshGeneratedPassword() {
        const passInput = document.getElementById("gen-user-password");
        if (passInput) {
            passInput.value = this.generateRandomPassword();
        }
    }

    openUserManagerModal() {
        const modal = document.getElementById("modal-container");
        const modalContent = document.getElementById("modal-content");
        if (!modal || !modalContent) return;

        const defaultPass = this.generateRandomPassword();

        modalContent.innerHTML = `
            <div class="p-4 sm:p-8 max-w-4xl mx-auto space-y-5">
                <!-- Header -->
                <div class="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-100">
                    <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                            <i data-lucide="users" class="w-4 h-4 sm:w-5 sm:h-5"></i>
                        </div>
                        <div class="min-w-0">
                            <h2 class="text-sm sm:text-base font-bold text-slate-900 truncate">จัดการผู้ใช้งานและออกสิทธิ์ (Gen User System)</h2>
                            <p class="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">ระบบปิด ปลอดภัย 100% - ผู้ดูแลระบบเป็นผู้ออกบัญชีและส่งรหัสผ่านให้ผู้ใช้งาน</p>
                        </div>
                    </div>
                    <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>

                <!-- Form: Generate New User -->
                <div class="bg-slate-50/80 rounded-2xl p-4 sm:p-5 border border-slate-200/80">
                    <div class="flex items-center gap-2 mb-3.5 sm:mb-4">
                        <span class="w-2 h-2 rounded-full bg-blue-600"></span>
                        <h3 class="text-xs font-bold text-slate-800 uppercase tracking-wider">สร้างบัญชีผู้ใช้งานใหม่ (Generate Account)</h3>
                    </div>

                    <form onsubmit="app.handleGenerateUser(event)" class="space-y-3.5 sm:space-y-4 text-xs">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label class="block font-semibold text-slate-700 mb-1">ชื่อ-นามสกุลผู้ใช้งาน *</label>
                                <input type="text" id="gen-user-name" placeholder="เช่น นายสมหมาย การเงิน" class="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600" required />
                            </div>
                            <div>
                                <label class="block font-semibold text-slate-700 mb-1">ชื่อผู้ใช้งาน (Username สำหรับล็อกอิน) *</label>
                                <input type="text" id="gen-user-username" placeholder="เช่น sommai, user01" class="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" required />
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label class="block font-semibold text-slate-700 mb-1">บทบาทและสิทธิ์ (Role) *</label>
                                <select id="gen-user-role" class="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium">
                                    <option value="super_admin">👑 Super Admin (ผู้ดูแลระบบบัญชีกลาง)</option>
                                    <option value="company_manager">💼 ผู้บริหารบริษัท (Company Manager)</option>
                                    <option value="accountant" selected>📊 เจ้าหน้าที่บัญชี (Accountant)</option>
                                    <option value="auditor">🔍 ผู้ตรวจสอบบัญชี (Auditor - อ่านอย่างเดียว)</option>
                                </select>
                            </div>
                            <div>
                                <label class="block font-semibold text-slate-700 mb-1">สังกัดบริษัท (Company Access)</label>
                                <select id="gen-user-company" class="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600">
                                    <option value="">🏢 ส่วนกลาง (เข้าถึงได้ทุกบริษัท)</option>
                                    ${this.companies.map(c => `<option value="${c.id}">${c.name_th}</option>`).join("")}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">รหัสผ่านสำหรับเข้าสู่ระบบ (Password) *</label>
                            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                <div class="relative flex-1">
                                    <i data-lucide="key" class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"></i>
                                    <input type="text" id="gen-user-password" value="${defaultPass}" class="w-full pl-10 pr-3.5 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 font-mono font-bold tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-600" required />
                                </div>
                                <button type="button" onclick="app.refreshGeneratedPassword()" class="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl font-semibold transition flex items-center justify-center gap-1.5 whitespace-nowrap shadow-2xs active:scale-95">
                                    <i data-lucide="refresh-cw" class="w-3.5 h-3.5 text-blue-600"></i>
                                    <span>🎲 สุ่มรหัสใหม่</span>
                                </button>
                            </div>
                            <p class="text-[11px] text-slate-400 mt-1">สามารถใช้รหัสผ่านที่ระบบสุ่มให้อัตโนมัติ หรือพิมพ์แก้ไขตามที่ต้องการได้</p>
                        </div>

                        <div class="pt-2 flex items-center justify-end">
                            <button type="submit" class="w-full sm:w-auto px-5 py-2.5 bg-navy-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-sm transition flex items-center justify-center gap-2 active:scale-[0.98]">
                                <i data-lucide="user-plus" class="w-4 h-4"></i>
                                <span>✨ สร้างบัญชีและคัดลอกข้อมูลส่งให้ผู้ใช้</span>
                            </button>
                        </div>
                    </form>
                </div>

                <!-- Section: Existing Users List -->
                <div>
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-2">
                            <h3 class="text-xs font-bold text-slate-800 uppercase tracking-wider">บัญชีผู้ใช้งานในระบบทั้งหมด</h3>
                            <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">${this.users.length} บัญชี</span>
                        </div>
                        <span class="text-[11px] text-slate-400 hidden sm:inline">คลิกที่ปุ่มคัดลอกเพื่อส่งรหัสเข้าสู่ระบบให้พนักงาน</span>
                    </div>

                    <div class="border border-slate-200/80 rounded-2xl overflow-x-auto overflow-y-auto bg-white shadow-2xs max-h-72">
                        <table class="w-full min-w-[540px] text-left text-xs border-collapse">
                            <thead>
                                <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                                    <th class="py-2.5 px-4">ผู้ใช้งาน</th>
                                    <th class="py-2.5 px-3">บทบาท</th>
                                    <th class="py-2.5 px-3">สังกัด</th>
                                    <th class="py-2.5 px-3">รหัสผ่าน</th>
                                    <th class="py-2.5 px-4 text-center">จัดการ</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${this.users.map(u => {
                                    const comp = this.companies.find(c => c.id === u.company_id);
                                    const isInitialAdmin = u.id === "admin";
                                    const pass = u.password || "admin123";

                                    return `
                                        <tr class="hover:bg-slate-50/80 transition">
                                            <td class="py-2.5 px-4">
                                                <div class="flex items-center gap-2.5">
                                                    <img src="${u.avatar}" class="w-7 h-7 rounded-lg object-cover border border-slate-200 flex-shrink-0" />
                                                    <div class="min-w-0">
                                                        <div class="font-bold text-slate-900 truncate">${u.full_name}</div>
                                                        <div class="text-[11px] text-slate-400 font-mono truncate">Username: ${u.username || u.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td class="py-2.5 px-3 whitespace-nowrap">
                                                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${u.role === 'super_admin' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-700'}">
                                                    ${this.getRoleThaiShortName(u.role)}
                                                </span>
                                            </td>
                                            <td class="py-2.5 px-3 whitespace-nowrap text-slate-600 font-medium">
                                                ${comp ? comp.name_th : '🏢 ส่วนกลาง (HQ)'}
                                            </td>
                                            <td class="py-2.5 px-3 whitespace-nowrap font-mono text-slate-800 font-semibold bg-slate-50/50">
                                                ${pass}
                                            </td>
                                            <td class="py-2.5 px-4 text-center whitespace-nowrap">
                                                <div class="flex items-center justify-center gap-1.5">
                                                    <button onclick="app.copyUserCredentials('${u.id}')" title="คัดลอกข้อมูลส่งให้ผู้ใช้" class="px-2.5 py-1 text-[11px] font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition flex items-center gap-1 active:scale-95">
                                                        <i data-lucide="copy" class="w-3 h-3"></i>
                                                        <span class="hidden sm:inline">คัดลอกข้อมูลส่งผู้ใช้</span>
                                                        <span class="sm:hidden">คัดลอก</span>
                                                    </button>
                                                    <button onclick="app.openChangePasswordModal('${u.id}')" title="เปลี่ยนรหัสผ่านให้ผู้ใช้นี้" class="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition active:scale-95">
                                                        <i data-lucide="key" class="w-3.5 h-3.5"></i>
                                                    </button>
                                                    ${!isInitialAdmin ? `
                                                        <button onclick="app.deleteGeneratedUser('${u.id}')" title="ลบบัญชีนี้" class="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition active:scale-95">
                                                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                                        </button>
                                                    ` : ''}
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="pt-2 border-t border-slate-100 flex items-center justify-end">
                    <button type="button" onclick="app.closeModal()" class="w-full sm:w-auto px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold transition text-xs text-center">
                        ปิดหน้าต่าง
                    </button>
                </div>
            </div>
        `;

        modal.classList.remove("hidden");
        if (window.lucide) window.lucide.createIcons();
    }

    handleGenerateUser(e) {
        e.preventDefault();
        const nameInput = document.getElementById("gen-user-name");
        const usernameInput = document.getElementById("gen-user-username") || document.getElementById("gen-user-email");
        const roleSelect = document.getElementById("gen-user-role");
        const compSelect = document.getElementById("gen-user-company");
        const passInput = document.getElementById("gen-user-password");

        if (!nameInput || !usernameInput || !roleSelect || !passInput) return;

        const name = nameInput.value.trim();
        const username = usernameInput.value.trim().toLowerCase();
        const role = roleSelect.value;
        const compId = (role === "super_admin" || role === "auditor") ? null : (compSelect ? compSelect.value : null);
        const password = passInput.value.trim();

        if (this.users.some(u => (u.username && u.username.toLowerCase() === username) || (u.email && u.email.toLowerCase() === username))) {
            this.showToast(`ชื่อผู้ใช้งาน ${username} มีอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น`, "error");
            return;
        }

        const newUser = {
            id: "user_" + Date.now(),
            username: username,
            full_name: name,
            email: username,
            password: password,
            role: role,
            company_id: compId || null,
            title: this.getRoleThaiName(role),
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0f172a&color=fff&size=128`,
            created_at: new Date().toISOString()
        };

        this.users.push(newUser);
        this.saveLocalData();
        this.copyUserCredentials(newUser.id, true);
        this.openUserManagerModal();
        this.showToast(`สร้างบัญชี ${name} สำเร็จและคัดลอกข้อมูลให้แล้ว`, "success");
    }

    copyUserCredentials(userId, isNew = false) {
        const u = this.users.find(usr => usr.id === userId);
        if (!u) return;

        const comp = this.companies.find(c => c.id === u.company_id);
        const compName = comp ? comp.name_th : "ส่วนกลาง (ทุกบริษัท)";
        const roleName = this.getRoleThaiName(u.role);
        const pass = u.password || "admin123";
        const loginUrl = window.location.origin + window.location.pathname;

        const text = `==============================\n🔑 ข้อมูลการเข้าสู่ระบบศูนย์รวมลิงก์\n==============================\n🌐 เว็บไซต์: ${loginUrl}\n👤 ชื่อ-นามสกุล: ${u.full_name}\n🆔 Username: ${u.username || u.email}\n🔐 Password: ${pass}\n🏢 สังกัด: ${compName}\n🛡️ บทบาท: ${roleName}\n==============================`;

        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast(`📋 คัดลอกข้อมูลบัญชีของ ${u.full_name} แล้ว (พร้อมส่งให้ผู้ใช้)`, "success");
            }).catch(() => {
                prompt("คัดลอกข้อมูลการเข้าสู่ระบบ:", text);
            });
        } else {
            prompt("คัดลอกข้อมูลการเข้าสู่ระบบ:", text);
        }
    }

    deleteGeneratedUser(userId) {
        if (userId === "admin" || (this.currentUser && this.currentUser.id === userId)) {
            this.showToast("ไม่สามารถลบบัญชีผู้ดูแลระบบหลัก หรือบัญชีที่กำลังใช้งานอยู่ได้", "error");
            return;
        }

        const u = this.users.find(usr => usr.id === userId);
        if (!u) return;

        if (confirm(`คุณต้องการลบบัญชีผู้ใช้ ${u.full_name} (${u.email}) ใช่หรือไม่?`)) {
            this.users = this.users.filter(usr => usr.id !== userId);
            this.saveLocalData();
            this.openUserManagerModal();
            this.showToast(`ลบบัญชี ${u.full_name} เรียบร้อยแล้ว`, "info");
        }
    }

    openChangePasswordModal(targetUserId = null) {
        const modal = document.getElementById("modal-container");
        const modalContent = document.getElementById("modal-content");
        if (!modal || !modalContent) return;

        const isSelf = !targetUserId || (this.currentUser && targetUserId === this.currentUser.id);
        const targetUser = isSelf ? this.currentUser : this.users.find(u => u.id === targetUserId);
        if (!targetUser) return;

        const roleText = this.getRoleThaiShortName(targetUser.role);

        modalContent.innerHTML = `
            <div class="p-5 sm:p-7 max-w-md mx-auto space-y-5">
                <!-- Header -->
                <div class="flex items-center justify-between pb-3.5 border-b border-slate-100">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
                            <i data-lucide="key" class="w-5 h-5"></i>
                        </div>
                        <div class="min-w-0">
                            <h2 class="text-sm sm:text-base font-bold text-slate-900 truncate">
                                ${isSelf ? 'เปลี่ยนรหัสผ่านของคุณ' : `ตั้งรหัสผ่านใหม่: ${targetUser.full_name}`}
                            </h2>
                            <p class="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">
                                ${isSelf ? 'กำหนดรหัสผ่านใหม่เพื่อใช้เข้าสู่ระบบในครั้งถัดไป' : 'กำหนดรหัสผ่านใหม่ให้กับบัญชีผู้ใช้งานนี้'}
                            </p>
                        </div>
                    </div>
                    <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>

                <!-- User Info Preview Chip -->
                <div class="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
                    <img src="${targetUser.avatar}" class="w-9 h-9 rounded-xl object-cover border border-slate-200 flex-shrink-0" />
                    <div class="min-w-0 flex-1">
                        <div class="text-xs font-bold text-slate-800 truncate">${targetUser.full_name}</div>
                        <div class="text-[11px] text-slate-400 font-mono">ชื่อผู้ใช้งาน: <span class="font-semibold text-slate-700">${targetUser.username || targetUser.email}</span></div>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-white border border-slate-200 text-slate-600 flex-shrink-0">
                        ${roleText}
                    </span>
                </div>

                <!-- Form -->
                <form onsubmit="app.handleChangePasswordSubmit(event, '${targetUser.id}')" class="space-y-4 text-xs">
                    ${isSelf ? `
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">รหัสผ่านเดิมปัจจุบัน *</label>
                            <div class="relative">
                                <i data-lucide="lock" class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"></i>
                                <input type="password" id="cp-current-password" placeholder="กรอกรหัสผ่านเดิมที่ใช้งานอยู่" class="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 transition" required autocomplete="current-password" />
                                <button type="button" onclick="app.togglePasswordVisibility('cp-current-password', this)" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-lg transition" title="แสดง/ซ่อนรหัสผ่าน">
                                    <i data-lucide="eye" class="w-4 h-4"></i>
                                </button>
                            </div>
                        </div>
                    ` : ''}

                    <div>
                        <div class="flex items-center justify-between mb-1">
                            <label class="font-semibold text-slate-700">รหัสผ่านใหม่ (New Password) *</label>
                            <span class="text-[10px] text-slate-400 font-medium">อย่างน้อย 4 ตัวอักษร</span>
                        </div>
                        <div class="relative">
                            <i data-lucide="key" class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"></i>
                            <input type="password" id="cp-new-password" placeholder="กรอกรหัสผ่านใหม่" minlength="4" class="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 transition font-mono" required autocomplete="new-password" />
                            <button type="button" onclick="app.togglePasswordVisibility('cp-new-password', this)" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-lg transition" title="แสดง/ซ่อนรหัสผ่าน">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">ยืนยันรหัสผ่านใหม่อีกครั้ง *</label>
                        <div class="relative">
                            <i data-lucide="check" class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"></i>
                            <input type="password" id="cp-confirm-password" placeholder="กรอกรหัสผ่านใหม่อีกครั้งให้ตรงกัน" minlength="4" class="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 transition font-mono" required autocomplete="new-password" />
                            <button type="button" onclick="app.togglePasswordVisibility('cp-confirm-password', this)" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-lg transition" title="แสดง/ซ่อนรหัสผ่าน">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <div class="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                        <button type="button" onclick="app.closeModal()" class="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold transition text-xs">
                            ยกเลิก
                        </button>
                        <button type="submit" class="px-5 py-2.5 bg-navy-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition shadow-sm flex items-center gap-1.5 active:scale-[0.98]">
                            <i data-lucide="check" class="w-4 h-4"></i>
                            <span>บันทึกรหัสผ่านใหม่</span>
                        </button>
                    </div>
                </form>
            </div>
        `;

        modal.classList.remove("hidden");
        if (window.lucide) window.lucide.createIcons();
    }

    handleChangePasswordSubmit(e, targetUserId) {
        e.preventDefault();
        const isSelf = !targetUserId || (this.currentUser && targetUserId === this.currentUser.id);
        const targetUser = isSelf ? this.currentUser : this.users.find(u => u.id === targetUserId);
        if (!targetUser) return;

        const currentPassInput = document.getElementById("cp-current-password");
        const newPassInput = document.getElementById("cp-new-password");
        const confirmPassInput = document.getElementById("cp-confirm-password");

        if (!newPassInput || !confirmPassInput) return;

        const newPass = newPassInput.value.trim();
        const confirmPass = confirmPassInput.value.trim();

        if (isSelf) {
            const currentPass = currentPassInput ? currentPassInput.value.trim() : "";
            const validOldPass = targetUser.password || "admin123";
            if (currentPass !== validOldPass) {
                this.showToast("รหัสผ่านเดิมไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", "error");
                if (currentPassInput) {
                    currentPassInput.focus();
                    currentPassInput.select();
                }
                return;
            }

            if (newPass === currentPass) {
                this.showToast("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม", "error");
                newPassInput.focus();
                return;
            }
        }

        if (newPass.length < 4) {
            this.showToast("รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร", "error");
            newPassInput.focus();
            return;
        }

        if (newPass !== confirmPass) {
            this.showToast("รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน กรุณาตรวจสอบ", "error");
            confirmPassInput.focus();
            return;
        }

        // Update target user password in user array
        targetUser.password = newPass;
        const userIdx = this.users.findIndex(u => u.id === targetUser.id);
        if (userIdx !== -1) {
            this.users[userIdx].password = newPass;
        }

        if (isSelf) {
            this.currentUser.password = newPass;
        }

        this.saveLocalData(true);
        this.closeModal();

        const successMsg = isSelf 
            ? "✅ เปลี่ยนรหัสผ่านสำเร็จแล้ว สามารถใช้รหัสผ่านใหม่ในการเข้าสู่ระบบครั้งถัดไป" 
            : `✅ บันทึกรหัสผ่านใหม่ให้ ${targetUser.full_name} เรียบร้อยแล้ว`;
        this.showToast(successMsg, "success");
    }

    closeModal() {
        const modal = document.getElementById("modal-container");
        if (modal) modal.classList.add("hidden");
    }

    // =========================================================================
    // ACTIONS & WORKFLOW
    // =========================================================================
    approveTransaction(id) {
        const tx = this.transactions.find(t => t.id === id);
        if (!tx) return;
        tx.status = "approved";
        tx.approved_by = this.currentUser.id;
        tx.approved_at = new Date().toISOString();
        this.saveLocalData();
        this.showToast(`อนุมัติรายการ ${tx.transaction_no} สำเร็จ`, "success");
        this.render();
    }

    rejectTransaction(id) {
        const tx = this.transactions.find(t => t.id === id);
        if (!tx) return;
        tx.status = "rejected";
        this.saveLocalData();
        this.showToast(`ปฏิเสธรายการ ${tx.transaction_no}`, "error");
        this.render();
    }

    markAsPaid(id) {
        const tx = this.transactions.find(t => t.id === id);
        if (!tx) return;
        tx.status = "paid";
        this.saveLocalData();
        this.showToast(`ลงบันทึกชำระเงิน ${tx.transaction_no} แล้ว`, "success");
        this.render();
    }

    deleteTransaction(id) {
        if (!confirm("คุณต้องการลบรายการนี้ใช่หรือไม่?")) return;
        this.transactions = this.transactions.filter(t => t.id !== id);
        this.saveLocalData();
        this.showToast("ลบรายการเรียบร้อยแล้ว", "info");
        this.render();
    }

    toggleMobileSidebar() {
        const sidebar = document.getElementById("sidebar");
        if (!sidebar) return;
        sidebar.classList.toggle("hidden");
    }

    switchTab(tab) {
        this.activeTab = tab;
        const sidebar = document.getElementById("sidebar");
        if (sidebar && window.innerWidth < 768) {
            sidebar.classList.add("hidden");
        }
        this.render();
    }

    switchUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        this.currentUser = user;
        this.showToast(`สลับโปรไฟล์เป็น: ${user.full_name}`, "info");
        this.render();
    }

    copyInviteLink(compId) {
        const comp = this.companies.find(c => c.id === compId);
        if (!comp) return;
        const baseUrl = window.location.origin + window.location.pathname;
        const link = `${baseUrl}?cid=${comp.id}&invite=${comp.invite_code}`;
        this.copyText(link);
        this.showToast(`คัดลอกลิงก์ตรงเข้า ${comp.name_th} แล้ว`, "success");
    }

    copyCurrentInvite() {
        if (this.currentCompanyId === "all") {
            const baseUrl = window.location.origin + window.location.pathname;
            this.copyText(baseUrl);
            this.showToast("คัดลอกลิงก์หน้าบัญชีกลางแล้ว", "success");
        } else {
            this.copyInviteLink(this.currentCompanyId);
        }
    }

    copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast("คัดลอกลิงก์แล้ว", "success");
            }).catch(() => { prompt("คัดลอกลิงก์:", text); });
        } else {
            prompt("คัดลอกลิงก์:", text);
        }
    }

    handleSearchInput(val) {
        this.filterSearch = val;
        this.renderActiveTab();
        if (window.lucide) window.lucide.createIcons();
    }

    handleStatusFilter(val) {
        this.filterStatus = val;
        this.renderActiveTab();
        if (window.lucide) window.lucide.createIcons();
    }

    handleReportCompanyChange(val) {
        this.activeReportCompany = val;
        this.renderActiveTab();
        if (window.lucide) window.lucide.createIcons();
    }


    resetMockData() {
        if (!confirm("ต้องการรีเซ็ตข้อมูลทั้งหมดกลับเป็นค่าเริ่มต้นหรือไม่?")) return;
        localStorage.removeItem("mc_companies");
        localStorage.removeItem("mc_transactions");
        localStorage.removeItem("mc_users");
        this.initStorage();
        this.showToast("รีเซ็ตข้อมูลเรียบร้อยแล้ว", "info");
        this.render();
    }

    exportToCSV() {
        const txs = this.getVisibleTransactions();
        let csvContent = "\uFEFFเลขที่รายการ,วันที่,บริษัท,ประเภท,หมวดหมู่,รายละเอียด,คู่ค้า,ยอดก่อนภาษี,VAT_7%,หักณที่จ่าย,ยอดสุทธิ,สถานะ\n";
        txs.forEach(t => {
            const comp = this.companies.find(c => c.id === t.company_id);
            csvContent += `"${t.transaction_no}","${t.transaction_date}","${comp ? comp.name_th : t.company_id}","${t.type}","${t.category_name}","${t.description.replace(/"/g, '""')}","${t.counterparty_name.replace(/"/g, '""')}",${t.subtotal},${t.vat_amount},${t.wht_amount},${t.total_amount},"${t.status}"\n`;
        });
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `Transactions_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
        this.showToast("ส่งออกไฟล์ CSV สำหรับ Excel สำเร็จ", "success");
    }

    showToast(msg, type = "info") {
        const toast = document.getElementById("notification-toast");
        const toastMsg = document.getElementById("toast-message");
        if (!toast || !toastMsg) return;
        toastMsg.textContent = msg;
        toast.className = `fixed bottom-5 left-1/2 -translate-x-1/2 sm:left-auto sm:right-5 sm:translate-x-0 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-white text-xs font-semibold transition-all duration-300 max-w-[90vw] whitespace-nowrap ${
            type === 'success' ? 'bg-emerald-600' :
            type === 'error' ? 'bg-rose-600' : 'bg-slate-900'
        }`;
        setTimeout(() => { toast.className = "hidden"; }, 3000);
    }

    formatCurrency(num) {
        return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    formatCurrencyShort(num) {
        const n = Number(num || 0);
        if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(2) + "M";
        if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + "k";
        return n.toFixed(0);
    }

    // Thai Baht Text Generator (e.g. 10400.00 -> หนึ่งหมื่นสี่ร้อยบาทถ้วน)
    bahtText(num) {
        if (!num || isNaN(num)) return "ศูนย์บาทถ้วน";
        num = parseFloat(num).toFixed(2);
        const parts = num.split(".");
        const integerPart = parts[0];
        const decimalPart = parts[1];

        const thaiNumbers = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
        const thaiUnits = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];

        function readGroup(nStr) {
            let res = "";
            const len = nStr.length;
            for (let i = 0; i < len; i++) {
                const digit = parseInt(nStr.charAt(i));
                const pos = len - i - 1;
                if (digit !== 0) {
                    if (pos === 1 && digit === 1) {
                        res += "สิบ";
                    } else if (pos === 1 && digit === 2) {
                        res += "ยี่สิบ";
                    } else if (pos === 0 && digit === 1 && len > 1 && parseInt(nStr.charAt(len - 2)) !== 0) {
                        res += "เอ็ด";
                    } else {
                        res += thaiNumbers[digit] + thaiUnits[pos];
                    }
                }
            }
            return res;
        }

        let bahtStr = "";
        if (parseInt(integerPart) === 0) {
            bahtStr = "ศูนย์";
        } else if (integerPart.length > 6) {
            const overMillion = integerPart.substring(0, integerPart.length - 6);
            const remain = integerPart.substring(integerPart.length - 6);
            bahtStr = readGroup(overMillion) + "ล้าน" + readGroup(remain);
        } else {
            bahtStr = readGroup(integerPart);
        }

        let satangStr = "";
        if (parseInt(decimalPart) === 0) {
            satangStr = "ถ้วน";
        } else {
            satangStr = readGroup(decimalPart) + "สตางค์";
        }

        return bahtStr + "บาท" + satangStr;
    }
}

// Auto Initialize
window.addEventListener("DOMContentLoaded", () => {
    window.app = new AccountingApp();
});
