/**
 * QR YOKLAMA SİSTEMİ
 * PHP kaldırıldı → FastAPI backend
 *
 * SERVER_URL: Sunucu URL'ini buraya yaz (örn. "http://192.168.1.100:8000")
 * Yerel geliştirmede boş bırak ("") — FastAPI ile aynı origin'den çalışır.
 */
const SERVER_URL = "";   // ← Sunucu gelince buraya yaz

const CONFIG = {
    API_BASE:      SERVER_URL,
    POLL_INTERVAL: 4000,
    BASE_URL:      window.location.href.split('?')[0]
};

const INITIAL_STATE = {
    users: [
        { id: 101, email: "ufuk@uni.edu.tr",     password: "123", role: "student", name: "Ufuk Buğra Şahin",  student_no: "20202020" },
        { id: 102, email: "peri@uni.edu.tr",     password: "123", role: "teacher", name: "Peri Güneş",         department: "Bilgisayar Mühendisliği" },
        { id: 103, email: "boran@uni.edu.tr",    password: "123", role: "student", name: "Boran Özsoy",        student_no: "20202021" },
        { id: 104, email: "enes@uni.edu.tr",     password: "123", role: "student", name: "Enes Cinipi",        student_no: "20202022" },
        { id: 105, email: "ogrenci@uni.edu.tr",  password: "123", role: "student", name: "Deneme Öğrencisi",   student_no: "20200000" }
    ],
    courses: [
        { id: 501, code: "BLG301", name: "Yazılım Mühendisliği",  teacher_id: 102 },
        { id: 502, code: "BLG305", name: "Veritabanı Yönetimi",    teacher_id: 102 },
    ],
    active_session: null,
    records: []
};

class AttendanceApp {
    constructor() {
        this.db          = JSON.parse(JSON.stringify(INITIAL_STATE));
        this.currentUser = null;
        this.scanner     = null;
        this.historyData = [];
        this.init();
    }

    async init() {
        await this.syncFromCloud();
        this.setupEventListeners();
        this.handleRouting();
        this.startBackgroundPoller();
    }

    // ── CLOUD SYNC ──────────────────────────────────────────────────────────

    async syncFromCloud() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/sync?t=${Date.now()}`);
            if (!res.ok) return;
            const data = await res.json();

            if (data && data.users && data.users.length > 0) {
                data.users.forEach(u => u.id = parseInt(u.id));
                data.courses.forEach(c => { c.id = parseInt(c.id); c.teacher_id = parseInt(c.teacher_id); });
                if (data.records) data.records = data.records.map(id => parseInt(id));
                this.db = data;
            } else if (data && data.first_run) {
                await this.syncToCloud();
            }
        } catch (e) {
            console.error("Sync hatası:", e);
        }
    }

    async syncToCloud() {
        try {
            await fetch(`${CONFIG.API_BASE}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.db)
            });
        } catch (e) {
            console.error("Cloud kayıt hatası:", e);
        }
    }

    startBackgroundPoller() {
        setInterval(async () => {
            if (this.currentUser?.role === 'teacher' &&
                !document.getElementById('view-session').classList.contains('hidden')) {
                await this.syncFromCloud();
                this.renderAttendeeList();
            }
        }, CONFIG.POLL_INTERVAL);
    }

    // ── NAVİGASYON ──────────────────────────────────────────────────────────

    handleRouting() {
        const params = new URLSearchParams(window.location.search);
        const sessionQr = params.get('session');
        if (sessionQr) {
            sessionStorage.setItem('pending_session', sessionQr);
            this.switchView('view-login');
        }
    }

    switchView(viewId) {
        ['view-login', 'view-teacher', 'view-session', 'view-student', 'view-history'].forEach(v => {
            document.getElementById(v)?.classList.add('hidden');
        });
        document.getElementById(viewId)?.classList.remove('hidden');

        const nav = document.getElementById('nav-main');
        if (viewId === 'view-login') nav.classList.add('hidden');
        else nav.classList.remove('hidden');
    }

    handleRoleChange() {
        const role = document.getElementById('login-role').value;
        document.getElementById('login-email').value    = role === 'teacher' ? 'peri@uni.edu.tr' : 'ufuk@uni.edu.tr';
        document.getElementById('login-password').value = '123';
    }

    // ── GİRİŞ ───────────────────────────────────────────────────────────────

    async login() {
        const email = document.getElementById('login-email').value;
        const pass  = document.getElementById('login-password').value;
        await this.syncFromCloud();
        const user = this.db.users.find(u => u.email === email && u.password === pass);
        if (user) {
            this.currentUser = user;
            this.showDashboard();
            const pending = sessionStorage.getItem('pending_session');
            if (pending && user.role === 'student') {
                await this.processAttendance(pending);
                sessionStorage.removeItem('pending_session');
            }
        } else {
            alert("Giriş Hatalı! Lütfen bilgilerinizi kontrol edin.");
        }
    }

    logout() { window.location.href = CONFIG.BASE_URL; }

    showDashboard() {
        document.getElementById('user-display-name').innerText = this.currentUser.name;
        document.getElementById('user-display-role').innerText =
            this.currentUser.role === 'teacher' ? 'Öğretim Görevlisi' : 'Öğrenci';
        if (this.currentUser.role === 'teacher') {
            this.renderTeacherCourses();
            this.switchView('view-teacher');
        } else {
            this.switchView('view-student');
        }
    }

    // ── ÖĞRETMEN ─────────────────────────────────────────────────────────────

    renderTeacherCourses() {
        const container = document.getElementById('teacher-courses');
        container.innerHTML = '';
        const myCourses = this.db.courses.filter(c => c.teacher_id === this.currentUser.id);
        myCourses.forEach(c => {
            const card = document.createElement('div');
            card.className = 'course-card glass-card';
            card.innerHTML = `
                <div style="color:var(--accent);font-weight:800;font-size:0.7rem;">${c.code}</div>
                <h3>${c.name}</h3>
                <p style="font-size:0.8rem;color:var(--text-secondary);">Yoklama Başlat</p>`;
            card.onclick = () => this.startSession(c);
            container.appendChild(card);
        });
    }

    async startSession(course) {
        document.getElementById('active-session-title').innerText = course.name;
        const pin    = Math.floor(100000 + Math.random() * 900000).toString();
        const qrData = "ATTEND_" + Date.now();
        this.db.active_session = { course_id: course.id, qr_data: qrData, pin, active: true };
        this.db.records = [];
        await this.syncToCloud();
        document.getElementById('session-pin').innerText = pin;
        this.renderQRCode(qrData);
        this.renderAttendeeList();
        this.switchView('view-session');
    }

    renderQRCode(data) {
        const container = document.getElementById('qr-output');
        container.innerHTML = '';
        new QRCode(container, { text: `${CONFIG.BASE_URL}?session=${data}`, width: 250, height: 250 });
    }

    async closeSession() {
        this.db.active_session = null;
        await this.syncToCloud();
        this.switchView('view-teacher');
    }

    renderAttendeeList() {
        const container = document.getElementById('attendee-list-container');
        document.getElementById('attendee-count').innerText = this.db.records.length;
        if (this.db.records.length === 0) {
            container.innerHTML = '<div style="padding:2rem;" class="text-muted text-center">Öğrenci bekleniyor...</div>';
            return;
        }
        container.innerHTML = '';
        this.db.records.forEach(studentId => {
            const s = this.db.users.find(u => u.id === parseInt(studentId));
            if (!s) return;
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `
                <div>
                    <div style="font-weight:700;">${s.name}</div>
                    <div style="font-size:0.7rem;color:var(--text-secondary);">${s.student_no || ''}</div>
                </div>
                <div class="status-present">DERSTE</div>`;
            container.appendChild(item);
        });
    }

    /** Aktif oturumdaki listeyi yazdır */
    printCurrentSession() {
        if (this.db.records.length === 0) { alert("Henüz katılımcı yok."); return; }
        const course = this.db.courses.find(c => c.id === this.db.active_session?.course_id);
        const attendees = this.db.records
            .map(id => this.db.users.find(u => u.id === parseInt(id)))
            .filter(Boolean);
        this.printSession({
            course_code: course?.code || '',
            course_name: course?.name || 'Ders',
            date:        new Date().toLocaleString('tr-TR'),
            attendees
        });
    }

    // ── GEÇMİŞ YOKLAMALAR ────────────────────────────────────────────────────

    async showHistory() {
        this.switchView('view-history');
        document.getElementById('history-list').innerHTML =
            '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Yükleniyor...</div>';
        try {
            const res = await fetch(`${CONFIG.API_BASE}/teacher/${this.currentUser.id}/history`);
            this.historyData = res.ok ? await res.json() : [];
        } catch (e) {
            this.historyData = [];
        }
        this.renderHistory();
    }

    renderHistory() {
        const container = document.getElementById('history-list');
        if (!this.historyData.length) {
            container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Henüz geçmiş yoklama yok.</div>';
            return;
        }
        container.innerHTML = '';
        this.historyData.forEach((s, idx) => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.cssText = 'padding:1.5rem;margin-bottom:1rem;';
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">
                    <div>
                        <div style="color:var(--accent);font-weight:800;font-size:0.7rem;margin-bottom:0.25rem;">
                            ${s.course_code}${s.is_active ? ' &nbsp;<span style="color:var(--success);">● AKTİF</span>' : ''}
                        </div>
                        <div style="font-weight:700;font-size:1rem;">${s.course_name}</div>
                        <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.25rem;">📅 ${s.date}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                        <div style="background:rgba(59,130,246,0.1);color:var(--accent);padding:0.25rem 1rem;border-radius:1rem;font-weight:800;font-size:0.8rem;">
                            ${s.attendee_count} ÖĞRENCİ
                        </div>
                        <button class="btn btn-primary" style="width:auto;padding:0.4rem 1rem;font-size:0.8rem;"
                            onclick="app.toggleHistoryDetail(${idx})">
                            Listele
                        </button>
                        <button class="btn" style="width:auto;padding:0.4rem 1rem;font-size:0.8rem;background:rgba(255,255,255,0.08);border:1px solid var(--glass-border);"
                            onclick="app.printHistorySession(${idx})">
                            🖨️ Yazdır
                        </button>
                    </div>
                </div>
                <div id="history-detail-${idx}" class="hidden" style="margin-top:1rem;border-top:1px solid var(--glass-border);padding-top:1rem;"></div>`;
            container.appendChild(card);
        });
    }

    toggleHistoryDetail(idx) {
        const detail = document.getElementById(`history-detail-${idx}`);
        if (!detail) return;
        const isHidden = detail.classList.contains('hidden');
        detail.classList.toggle('hidden', !isHidden);
        if (isHidden) this.renderHistoryDetail(idx, detail);
    }

    renderHistoryDetail(idx, container) {
        const s = this.historyData[idx];
        if (!s.attendees.length) {
            container.innerHTML = '<div style="color:var(--text-secondary);font-size:0.9rem;">Bu oturuma katılım kaydı yok.</div>';
            return;
        }
        container.innerHTML = s.attendees.map((a, i) => `
            <div class="list-item" style="padding:0.75rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="display:flex;align-items:center;gap:1rem;">
                    <div style="color:var(--text-secondary);font-size:0.75rem;min-width:1.5rem;">${i + 1}.</div>
                    <div>
                        <div style="font-weight:700;">${a.name}</div>
                        <div style="font-size:0.7rem;color:var(--text-secondary);">${a.student_no}</div>
                    </div>
                </div>
                <div class="status-present">KATILDI</div>
            </div>`).join('');
    }

    printHistorySession(idx) {
        const s = this.historyData[idx];
        this.printSession({
            course_code: s.course_code,
            course_name: s.course_name,
            date:        s.date,
            attendees:   s.attendees.map(a => ({ name: a.name, student_no: a.student_no }))
        });
    }

    // ── YAZDIR ───────────────────────────────────────────────────────────────

    printSession({ course_code, course_name, date, attendees }) {
        const rows = attendees.map((a, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${a.name || ''}</td>
                <td>${a.student_no || ''}</td>
                <td style="text-align:center;">✓</td>
            </tr>`).join('');

        const win = window.open('', '_blank', 'width=800,height=600');
        win.document.write(`<!DOCTYPE html><html lang="tr"><head>
            <meta charset="UTF-8">
            <title>Yoklama Listesi - ${course_name}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 2rem; color: #111; }
                h2 { margin: 0 0 0.25rem; }
                .meta { font-size: 0.85rem; color: #555; margin-bottom: 1.5rem; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ccc; padding: 0.5rem 0.75rem; font-size: 0.9rem; }
                th { background: #f0f0f0; font-weight: 700; }
                tr:nth-child(even) { background: #fafafa; }
                .footer { margin-top: 2rem; font-size: 0.8rem; color: #888; border-top: 1px solid #ccc; padding-top: 0.5rem; }
                @media print { button { display: none; } }
            </style>
        </head><body>
            <h2>${course_code} — ${course_name}</h2>
            <div class="meta">📅 Tarih: ${date} &nbsp;|&nbsp; Toplam: ${attendees.length} öğrenci</div>
            <table>
                <thead><tr><th>#</th><th>Ad Soyad</th><th>Öğrenci No</th><th>İmza</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="footer">QR Yoklama Sistemi — ${new Date().toLocaleString('tr-TR')}</div>
            <br><button onclick="window.print()">🖨️ Yazdır</button>
        </body></html>`);
        win.document.close();
        win.focus();
    }

    // ── ÖĞRENCİ ─────────────────────────────────────────────────────────────

    async startScan() {
        const container = document.getElementById('scanner-container');
        document.getElementById('btn-scan').classList.add('hidden');
        container.classList.remove('hidden');
        this.scanner = new Html5Qrcode("scanner-container");
        this.scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: 250 },
            (decodedText) => {
                this.stopScan();
                const m = decodedText.match(/session=([^&]+)/);
                this.processAttendance(m ? m[1] : decodedText);
            }
        ).catch(() => this.stopScan());
    }

    stopScan() {
        if (this.scanner) {
            this.scanner.stop().then(() => {
                document.getElementById('scanner-container').classList.add('hidden');
                document.getElementById('btn-scan').classList.remove('hidden');
            });
        }
    }

    async submitManual() {
        const code = document.getElementById('manual-code').value;
        await this.syncFromCloud();
        if (this.db.active_session && this.db.active_session.pin === code) {
            await this.processAttendance(this.db.active_session.qr_data);
        } else {
            alert("Hatalı Kod!");
        }
    }

    async processAttendance(qrData) {
        await this.syncFromCloud();
        if (this.db.active_session && this.db.active_session.qr_data === qrData) {
            if (!this.db.records.includes(this.currentUser.id)) {
                this.db.records.push(this.currentUser.id);
                await this.syncToCloud();
                document.getElementById('btn-scan').classList.add('hidden');
                const course = this.db.courses.find(c => c.id === this.db.active_session.course_id);
                document.getElementById('success-course-name').innerText = course ? course.name : "Ders";
                document.getElementById('success-overlay').classList.remove('hidden');
            } else {
                alert("Zaten katıldınız!");
            }
        } else {
            alert("Geçersiz Oturum!");
        }
    }

    // ── UTILS ────────────────────────────────────────────────────────────────

    setupEventListeners() {
        document.getElementById('login-password')?.addEventListener('keypress', e => {
            if (e.key === 'Enter') this.login();
        });
    }
}

const app = new AttendanceApp();
