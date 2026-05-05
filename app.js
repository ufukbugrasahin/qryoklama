/**
 * QR YOKLAMA SİSTEMİ
 * SERVER_URL: Sunucu URL'ini buraya yaz (örn. "http://192.168.1.100:8000")
 * Vercel'de aynı origin olduğu için boş bırak.
 */
const SERVER_URL = "";

const CONFIG = {
    API_BASE:      SERVER_URL,
    POLL_INTERVAL: 4000,
    BASE_URL:      window.location.href.split('?')[0]
};

const INITIAL_STATE = {
    users: [
        { id: 100, email: "admin@uni.edu.tr",    password: "admin123", role: "admin",   name: "Sistem Yöneticisi" },
        { id: 101, email: "ufuk@uni.edu.tr",     password: "123",      role: "student", name: "Ufuk Buğra Şahin",  student_no: "20202020" },
        { id: 102, email: "peri@uni.edu.tr",     password: "123",      role: "teacher", name: "Peri Güneş",         department: "Bilgisayar Mühendisliği" },
        { id: 103, email: "boran@uni.edu.tr",    password: "123",      role: "student", name: "Boran Özsoy",        student_no: "20202021" },
        { id: 104, email: "enes@uni.edu.tr",     password: "123",      role: "student", name: "Enes Cinipi",        student_no: "20202022" },
        { id: 105, email: "ogrenci@uni.edu.tr",  password: "123",      role: "student", name: "Deneme Öğrencisi",   student_no: "20200000" }
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
        this.adminUsers  = [];
        this.adminCourses = [];
        this.editingUser  = null;
        this.editingCourse = null;
        this.init();
    }

    async init() {
        await this.syncFromCloud();
        await this.migratePasswords();
        this.setupEventListeners();
        this.handleRouting();
        this.startBackgroundPoller();
    }

    async migratePasswords() {
        // Varsayılan kullanıcıların şifrelerini sunucuya gönder (eski hash formatını sha256'ya dönüştürür)
        try {
            await fetch(`${CONFIG.API_BASE}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    users: INITIAL_STATE.users,
                    courses: [],
                    active_session: null,
                    records: []
                })
            });
        } catch(e) {}
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
        } catch (e) { console.error("Sync hatası:", e); }
    }

    async syncToCloud() {
        try {
            await fetch(`${CONFIG.API_BASE}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.db)
            });
        } catch (e) { console.error("Cloud kayıt hatası:", e); }
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
        ['view-login','view-teacher','view-session','view-student','view-history',
         'view-admin','view-student-history','view-stats','view-student-courses'].forEach(v => {
            document.getElementById(v)?.classList.add('hidden');
        });
        document.getElementById(viewId)?.classList.remove('hidden');
        const nav = document.getElementById('nav-main');
        if (viewId === 'view-login') nav.classList.add('hidden');
        else nav.classList.remove('hidden');
    }

    handleRoleChange() {
        const role = document.getElementById('login-role').value;
        const map = { student: 'ufuk@uni.edu.tr', teacher: 'peri@uni.edu.tr', admin: 'admin@uni.edu.tr' };
        document.getElementById('login-email').value = map[role] || '';
        document.getElementById('login-password').value = '';
    }

    // ── GİRİŞ ───────────────────────────────────────────────────────────────

    async login() {
        const email = document.getElementById('login-email').value.trim();
        const pass  = document.getElementById('login-password').value;
        try {
            const res = await fetch(`${CONFIG.API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: pass })
            });
            const data = await res.json();
            if (data.error) { this.toast('Giriş Hatalı: ' + data.error, 'error'); return; }
            this.currentUser = data;
            await this.syncFromCloud();
            this.showDashboard();
            const pending = sessionStorage.getItem('pending_session');
            if (pending && data.role === 'student') {
                await this.processAttendance(pending);
                sessionStorage.removeItem('pending_session');
            }
        } catch(e) {
            this.toast('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.', 'error');
        }
    }

    logout() { window.location.href = CONFIG.BASE_URL; }

    showDashboard() {
        document.getElementById('user-display-name').innerText = this.currentUser.name;
        const roleLabel = { teacher: 'Öğretim Görevlisi', student: 'Öğrenci', admin: 'Yönetici' };
        document.getElementById('user-display-role').innerText = roleLabel[this.currentUser.role] || '';
        const avatarEl = document.getElementById('nav-avatar');
        if (avatarEl) avatarEl.textContent = this.currentUser.name[0].toUpperCase();

        if (this.currentUser.role === 'teacher') {
            this.renderTeacherCourses();
            this.switchView('view-teacher');
        } else if (this.currentUser.role === 'admin') {
            this.switchView('view-admin');
            this.loadAdminData();
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
        // QR verisi içine süre sınırı (5 dk) göm
        const expiry = Date.now() + 5 * 60 * 1000;
        const qrData = `ATTEND_${Date.now()}_EXP_${expiry}`;
        this.db.active_session = { course_id: course.id, qr_data: qrData, pin, active: true };
        this.db.records = [];
        await this.syncToCloud();
        document.getElementById('session-pin').innerText = pin;
        this.renderQRCode(qrData);
        this.renderAttendeeList();
        this.switchView('view-session');
        this.startCountdown(expiry);
    }

    renderQRCode(data) {
        const container = document.getElementById('qr-output');
        container.innerHTML = '';
        new QRCode(container, { text: `${CONFIG.BASE_URL}?session=${data}`, width: 250, height: 250 });
    }

    async closeSession() {
        this.stopCountdown();
        this.db.active_session = null;
        await this.syncToCloud();
        this.switchView('view-teacher');
    }

    renderAttendeeList() {
        const container = document.getElementById('attendee-list-container');
        document.getElementById('attendee-count').innerText = this.db.records.length;
        if (this.db.records.length === 0) {
            container.innerHTML = '<div style="padding:2rem;color:var(--text-secondary);text-align:center;">Öğrenci bekleniyor...</div>';
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

    printCurrentSession() {
        if (this.db.records.length === 0) { this.toast('Henüz katılımcı yok.', 'info'); return; }
        const course = this.db.courses.find(c => c.id === this.db.active_session?.course_id);
        const attendees = this.db.records.map(id => this.db.users.find(u => u.id === parseInt(id))).filter(Boolean);
        this.printSession({ course_code: course?.code || '', course_name: course?.name || 'Ders', date: new Date().toLocaleString('tr-TR'), attendees });
    }

    // ── GEÇMİŞ YOKLAMALAR (ÖĞRETMEN) ─────────────────────────────────────────

    async showHistory() {
        this.switchView('view-history');
        document.getElementById('history-list').innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Yükleniyor...</div>';
        try {
            const res = await fetch(`${CONFIG.API_BASE}/teacher/${this.currentUser.id}/history`);
            this.historyData = res.ok ? await res.json() : [];
        } catch (e) { this.historyData = []; }
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
                    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
                        <div style="background:rgba(59,130,246,0.1);color:var(--accent);padding:0.25rem 1rem;border-radius:1rem;font-weight:800;font-size:0.8rem;">${s.attendee_count}${s.enrolled_count ? ' / ' + s.enrolled_count : ''} ÖĞRENCİ</div>
                        <button class="btn btn-primary" style="width:auto;padding:0.4rem 1rem;font-size:0.8rem;" onclick="app.toggleHistoryDetail(${idx})">Listele</button>
                        <button class="btn" style="width:auto;padding:0.4rem 1rem;font-size:0.8rem;background:rgba(255,255,255,0.08);border:1px solid var(--glass-border);" onclick="app.printHistorySession(${idx})">🖨️ Yazdır</button>
                        <button class="btn" style="width:auto;padding:0.4rem 1rem;font-size:0.8rem;background:rgba(16,185,129,0.1);border:1px solid var(--success);color:var(--success);" onclick="app.exportHistoryExcel(${idx})">📥 Excel</button>
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
        const hasAttendees = s.attendees && s.attendees.length > 0;
        const hasAbsent    = s.absent    && s.absent.length    > 0;
        if (!hasAttendees && !hasAbsent) {
            container.innerHTML = '<div style="color:var(--text-secondary);font-size:0.9rem;padding:0.5rem 0;">Kayıtlı öğrenci veya katılım kaydı yok.</div>';
            return;
        }
        let html = '';
        if (hasAttendees) {
            html += s.attendees.map((a, i) => `
                <div class="list-item" style="padding:0.75rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex;align-items:center;gap:1rem;">
                        <div style="color:var(--text-secondary);font-size:0.75rem;min-width:1.5rem;">${i+1}.</div>
                        <div><div style="font-weight:700;">${a.name}</div><div style="font-size:0.7rem;color:var(--text-secondary);">${a.student_no}</div></div>
                    </div>
                    <div class="status-present">KATILDI</div>
                </div>`).join('');
        }
        if (hasAbsent) {
            html += s.absent.map(a => `
                <div class="list-item" style="padding:0.75rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex;align-items:center;gap:1rem;">
                        <div style="color:var(--text-secondary);font-size:0.75rem;min-width:1.5rem;">—</div>
                        <div><div style="font-weight:700;color:var(--text-secondary);">${a.name}</div><div style="font-size:0.7rem;color:var(--text-secondary);">${a.student_no}</div></div>
                    </div>
                    <div style="background:rgba(244,63,94,0.1);color:var(--danger);padding:0.25rem 0.75rem;border-radius:2rem;font-size:0.7rem;font-weight:700;border:1px solid rgba(244,63,94,0.25);white-space:nowrap;">GELMEDİ</div>
                </div>`).join('');
        }
        container.innerHTML = html;
    }

    printHistorySession(idx) {
        const s = this.historyData[idx];
        this.printSession({ course_code: s.course_code, course_name: s.course_name, date: s.date, attendees: s.attendees });
    }

    // ── GEÇMİŞ (ÖĞRENCİ) ────────────────────────────────────────────────────

    async showStudentHistory() {
        this.switchView('view-student-history');
        document.getElementById('student-history-list').innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Yükleniyor...</div>';
        try {
            const res = await fetch(`${CONFIG.API_BASE}/student/${this.currentUser.id}/history`);
            const data = res.ok ? await res.json() : [];
            this.renderStudentHistory(data);
        } catch (e) {
            document.getElementById('student-history-list').innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Veri alınamadı.</div>';
        }
    }

    renderStudentHistory(data) {
        const container = document.getElementById('student-history-list');
        if (!data.length) {
            container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Henüz katıldığınız bir ders yok.</div>';
            return;
        }
        const grouped = {};
        data.forEach(r => {
            if (!grouped[r.course_code]) grouped[r.course_code] = { name: r.course_name, records: [] };
            grouped[r.course_code].records.push(r);
        });
        container.innerHTML = Object.entries(grouped).map(([code, g]) => `
            <div class="glass-card" style="padding:1.5rem;margin-bottom:1rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                    <div>
                        <div style="color:var(--accent);font-weight:800;font-size:0.7rem;">${code}</div>
                        <div style="font-weight:700;">${g.name}</div>
                    </div>
                    <div style="background:rgba(16,185,129,0.1);color:var(--success);padding:0.25rem 1rem;border-radius:1rem;font-weight:800;font-size:0.8rem;">${g.records.length} KATILIM</div>
                </div>
                ${g.records.map(r => `
                    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.85rem;">
                        <span>📅 ${r.date}</span>
                        <span class="status-present" style="font-size:0.7rem;">KATILDI</span>
                    </div>`).join('')}
            </div>`).join('');
    }

    // ── ÖĞRENCİ DERSLERİ & DEVAM ─────────────────────────────────────────────

    async showStudentCourses() {
        this.switchView('view-student-courses');
        document.getElementById('student-courses-list').innerHTML =
            '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Yükleniyor...</div>';
        try {
            const res  = await fetch(`${CONFIG.API_BASE}/student/${this.currentUser.id}/courses`);
            const data = res.ok ? await res.json() : [];
            this.renderStudentCourses(data);
        } catch(e) {
            document.getElementById('student-courses-list').innerHTML =
                '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Veri alınamadı.</div>';
        }
    }

    renderStudentCourses(data) {
        const container = document.getElementById('student-courses-list');
        if (!data.length) {
            container.innerHTML = `
                <div class="glass-card" style="padding:3rem;text-align:center;">
                    <div style="font-size:2.5rem;margin-bottom:0.75rem;">📚</div>
                    <div style="font-weight:700;margin-bottom:0.5rem;">Henüz bir derse kayıtlı değilsiniz</div>
                    <div style="color:var(--text-secondary);font-size:0.875rem;">Yukarıdaki alana ders kodunu girerek kayıt olabilirsiniz.</div>
                </div>`;
            return;
        }
        container.innerHTML = data.map(c => {
            const r     = c.attendance_rate;
            const color = r === null ? '#64748b' : r >= 85 ? '#10b981' : r >= 70 ? '#f59e0b' : '#f43f5e';
            const label = r === null ? 'Henüz ders yapılmadı' : r >= 85 ? '✓ Devam yeterli' : r >= 70 ? '⚠ Dikkat et!' : '✕ Devamsızlık riski!';
            const bar   = r === null ? 0 : Math.min(r, 100);
            const rText = r === null ? '—' : `%${r}`;
            return `
                <div class="glass-card" style="padding:1.5rem;margin-bottom:1rem;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                        <div>
                            <div style="color:var(--accent);font-weight:800;font-size:0.7rem;margin-bottom:0.25rem;">${c.course_code}</div>
                            <div style="font-weight:700;font-size:1rem;">${c.course_name}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:0.75rem;">
                            <div style="font-size:1.75rem;font-weight:900;color:${color};font-variant-numeric:tabular-nums;">${rText}</div>
                            <button class="btn-icon btn-danger" title="Dersten çık" onclick="app.unenrollFromCourse(${c.course_id},'${c.course_name.replace(/'/g,"\\'")}')">🚪</button>
                        </div>
                    </div>
                    <div style="background:rgba(255,255,255,0.06);border-radius:100px;height:7px;overflow:hidden;margin-bottom:0.6rem;">
                        <div style="height:100%;width:${bar}%;background:${color};border-radius:100px;transition:width 0.6s ease;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.8rem;">
                        <div style="font-weight:700;color:${color};">${label}</div>
                        <div style="color:var(--text-secondary);">${c.attended} / ${c.total_sessions} oturum</div>
                    </div>
                </div>`;
        }).join('');
    }

    async enrollInCourse() {
        const code = (document.getElementById('enroll-code').value || '').trim().toUpperCase();
        if (!code) { this.toast('Ders kodunu girin.', 'error'); return; }
        try {
            const res  = await fetch(`${CONFIG.API_BASE}/student/${this.currentUser.id}/enroll`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_code: code })
            });
            const data = await res.json();
            if (data.error) { this.toast(data.error, 'error'); return; }
            document.getElementById('enroll-code').value = '';
            this.toast(`${data.course_name} dersine kayıt oldunuz!`, 'success');
            this.showStudentCourses();
        } catch(e) {
            this.toast('Sunucuya bağlanılamadı.', 'error');
        }
    }

    async unenrollFromCourse(courseId, courseName) {
        if (!confirm(`"${courseName}" dersinden çıkmak istiyor musunuz?`)) return;
        try {
            await fetch(`${CONFIG.API_BASE}/student/${this.currentUser.id}/enroll/${courseId}`, { method: 'DELETE' });
            this.toast(`${courseName} dersinden çıkıldı.`, 'info');
            this.showStudentCourses();
        } catch(e) {
            this.toast('Hata oluştu.', 'error');
        }
    }

    // ── YAZDIR ───────────────────────────────────────────────────────────────

    printSession({ course_code, course_name, date, attendees }) {
        const rows = attendees.map((a, i) => `<tr><td>${i+1}</td><td>${a.name||''}</td><td>${a.student_no||''}</td><td style="text-align:center;">✓</td></tr>`).join('');
        const win = window.open('', '_blank', 'width=800,height=600');
        win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Yoklama - ${course_name}</title>
        <style>body{font-family:Arial,sans-serif;margin:2rem;color:#111;}h2{margin:0 0 0.25rem;}
        .meta{font-size:0.85rem;color:#555;margin-bottom:1.5rem;}table{width:100%;border-collapse:collapse;}
        th,td{border:1px solid #ccc;padding:0.5rem 0.75rem;font-size:0.9rem;}th{background:#f0f0f0;font-weight:700;}
        tr:nth-child(even){background:#fafafa;}.footer{margin-top:2rem;font-size:0.8rem;color:#888;border-top:1px solid #ccc;padding-top:0.5rem;}
        @media print{button{display:none;}}</style></head><body>
        <h2>${course_code} — ${course_name}</h2>
        <div class="meta">📅 ${date} &nbsp;|&nbsp; Toplam: ${attendees.length} öğrenci</div>
        <table><thead><tr><th>#</th><th>Ad Soyad</th><th>Öğrenci No</th><th>İmza</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="footer">QR Yoklama Sistemi — ${new Date().toLocaleString('tr-TR')}</div>
        <br><button onclick="window.print()">🖨️ Yazdır</button></body></html>`);
        win.document.close(); win.focus();
    }

    // ── ÖĞRENCİ YOKLAMA ─────────────────────────────────────────────────────

    async startScan() {
        const container = document.getElementById('scanner-container');
        document.getElementById('btn-scan').classList.add('hidden');
        container.classList.remove('hidden');
        this.scanner = new Html5Qrcode("scanner-container");
        this.scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (decodedText) => {
            this.stopScan();
            const m = decodedText.match(/session=([^&]+)/);
            this.processAttendance(m ? m[1] : decodedText);
        }).catch(() => this.stopScan());
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
        } else { this.toast('Hatalı kod! Lütfen tekrar deneyin.', 'error'); }
    }

    async processAttendance(qrData) {
        // QR süre kontrolü
        const expMatch = qrData.match(/_EXP_(\d+)/);
        if (expMatch && Date.now() > parseInt(expMatch[1])) {
            this.toast('QR kodunun süresi dolmuş! Öğretmenden yeni kod isteyin.', 'warning'); return;
        }
        await this.syncFromCloud();
        if (this.db.active_session && this.db.active_session.qr_data === qrData) {
            if (!this.db.records.includes(this.currentUser.id)) {
                this.db.records.push(this.currentUser.id);
                await this.syncToCloud();
                document.getElementById('btn-scan').classList.add('hidden');
                const course = this.db.courses.find(c => c.id === this.db.active_session.course_id);
                document.getElementById('success-course-name').innerText = course ? course.name : "Ders";
                document.getElementById('success-overlay').classList.remove('hidden');
                this.toast('Yoklamanız başarıyla alındı!', 'success');
            } else { this.toast('Bu derse zaten katıldınız!', 'warning'); }
        } else { this.toast('Geçersiz oturum! QR kodu eşleşmiyor.', 'error'); }
    }

    // ── İSTATİSTİK ───────────────────────────────────────────────────────────

    async showStats() {
        this.switchView('view-stats');
        document.getElementById('stats-summary').innerHTML = '<div style="color:var(--text-secondary);">Yükleniyor...</div>';
        document.getElementById('stats-charts').innerHTML  = '';
        try {
            const res = await fetch(`${CONFIG.API_BASE}/teacher/${this.currentUser.id}/stats`);
            if (!res.ok) throw new Error();
            const data = await res.json();
            this.renderStats(data);
            this.statsData = data;
        } catch(e) {
            document.getElementById('stats-summary').innerHTML = '<div style="color:var(--text-secondary);">Veri alınamadı.</div>';
        }
    }

    renderStats(data) {
        const totalSessions = data.courses.reduce((s, c) => s + c.total_sessions, 0);
        const summaryEl = document.getElementById('stats-summary');
        summaryEl.innerHTML = [
            ['📚', 'Toplam Ders',    data.courses.length],
            ['📋', 'Toplam Oturum', totalSessions],
            ['👥', 'Öğrenci Sayısı', data.total_students],
        ].map(([icon, label, val]) => `
            <div class="glass-card" style="padding:1.25rem;text-align:center;">
                <div style="font-size:1.75rem;">${icon}</div>
                <div style="font-size:1.5rem;font-weight:800;margin:0.25rem 0;">${val}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);">${label}</div>
            </div>`).join('');

        const chartsEl = document.getElementById('stats-charts');
        chartsEl.innerHTML = '';
        data.courses.forEach(c => {
            const wrapper = document.createElement('div');
            wrapper.className = 'glass-card';
            wrapper.style.cssText = 'padding:1.5rem;margin-bottom:1.25rem;';
            const canvasId = `chart-${c.course_code.replace(/\W/g,'_')}`;
            wrapper.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;">
                    <div>
                        <span style="color:var(--accent);font-weight:800;font-size:0.7rem;">${c.course_code}</span>
                        <div style="font-weight:700;">${c.course_name}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.25rem;font-weight:800;color:var(--success);">${c.avg_attendance}</div>
                        <div style="font-size:0.7rem;color:var(--text-secondary);">ort. katılım</div>
                    </div>
                </div>
                ${c.counts.length > 0
                    ? `<canvas id="${canvasId}" height="80"></canvas>`
                    : '<div style="color:var(--text-secondary);font-size:0.85rem;">Henüz tamamlanmış oturum yok.</div>'
                }`;
            chartsEl.appendChild(wrapper);

            if (c.counts.length > 0) {
                const ctx = document.getElementById(canvasId);
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: c.counts.map((_, i) => `${i+1}. Ders`),
                        datasets: [{
                            label: 'Katılım',
                            data: c.counts,
                            backgroundColor: 'rgba(59,130,246,0.6)',
                            borderColor: '#3b82f6',
                            borderWidth: 1,
                            borderRadius: 4,
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                            y: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
                        }
                    }
                });
            }
        });
    }

    exportStatsExcel() {
        if (!this.statsData || !this.statsData.courses.length) { this.toast('İstatistik verisi henüz yok.', 'info'); return; }
        const rows = [['Ders Kodu', 'Ders Adı', 'Toplam Oturum', 'Ort. Katılım']];
        this.statsData.courses.forEach(c => rows.push([c.course_code, c.course_name, c.total_sessions, c.avg_attendance]));
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'İstatistikler');
        XLSX.writeFile(wb, `yoklama_istatistik_${new Date().toLocaleDateString('tr-TR').replace(/\./g,'-')}.xlsx`);
    }

    exportHistoryExcel(idx) {
        const s = this.historyData[idx];
        if (!s) return;
        const rows = [['#', 'Ad Soyad', 'Öğrenci No', 'Durum']];
        s.attendees.forEach((a, i) => rows.push([i+1, a.name, a.student_no, 'Katıldı']));
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Yoklama');
        XLSX.writeFile(wb, `${s.course_code}_${s.date.replace(/[: ]/g,'-')}.xlsx`);
    }

    // ── ADMİN PANELİ ─────────────────────────────────────────────────────────

    async loadAdminData() {
        this.switchAdminTab('users');
        await Promise.all([this.refreshAdminUsers(), this.fetchAdminStats()]);
    }

    async fetchAdminStats() {
        try {
            const res  = await fetch(`${CONFIG.API_BASE}/admin/stats`);
            const data = res.ok ? await res.json() : null;
            if (data) this.renderAdminStats(data);
        } catch(e) {}
    }

    renderAdminStats(data) {
        const el = document.getElementById('admin-stats-row');
        if (!el) return;
        el.innerHTML = [
            ['👥', data.students,    'Öğrenci'],
            ['👨‍🏫', data.teachers,    'Öğretmen'],
            ['📚', data.courses,     'Ders'],
            ['📋', data.sessions,    'Oturum'],
            ['🔗', data.enrollments, 'Kayıt'],
        ].map(([icon, val, label]) => `
            <div class="glass-card" style="padding:1.1rem;text-align:center;">
                <div style="font-size:1.4rem;margin-bottom:0.3rem;">${icon}</div>
                <div style="font-size:1.6rem;font-weight:800;line-height:1;margin-bottom:0.2rem;">${val}</div>
                <div style="font-size:0.7rem;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
            </div>`).join('');
    }

    switchAdminTab(tab) {
        ['users','courses','enrollment'].forEach(t => {
            document.getElementById(`admin-${t}-panel`)?.classList.toggle('hidden', tab !== t);
            document.getElementById(`tab-btn-${t}`)?.classList.toggle('tab-active', tab === t);
        });
        if (tab === 'courses')    this.refreshAdminCourses();
        if (tab === 'users')      this.refreshAdminUsers();
        if (tab === 'enrollment') this.refreshAdminEnrollment();
    }

    async refreshAdminUsers() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/admin/users`);
            this.adminUsers = res.ok ? await res.json() : [];
        } catch(e) { this.adminUsers = []; }
        this.renderAdminUsers();
    }

    async refreshAdminCourses() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/admin/courses`);
            this.adminCourses = res.ok ? await res.json() : [];
        } catch(e) { this.adminCourses = []; }
        this.renderAdminCourses();
    }

    renderAdminUsers() {
        const container = document.getElementById('admin-users-list');
        const roleBadge = { student: ['#10b981','Öğrenci'], teacher: ['#3b82f6','Öğretmen'], admin: ['#f59e0b','Admin'] };
        container.innerHTML = this.adminUsers.length === 0
            ? '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Kullanıcı yok.</div>'
            : this.adminUsers.map(u => {
                const [color, label] = roleBadge[u.role] || ['#94a3b8', u.role];
                return `
                <div class="admin-list-item">
                    <div class="admin-list-avatar" style="background:${color}22;color:${color};">${u.name[0]}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.name}</div>
                        <div style="font-size:0.75rem;color:var(--text-secondary);">${u.email}</div>
                        ${u.student_no ? `<div style="font-size:0.7rem;color:var(--text-secondary);">No: ${u.student_no}</div>` : ''}
                    </div>
                    <span class="role-badge" style="background:${color}22;color:${color};">${label}</span>
                    <div style="display:flex;gap:0.5rem;">
                        <button class="btn-icon" onclick="app.openUserModal(${u.id})">✏️</button>
                        <button class="btn-icon btn-danger" onclick="app.deleteUser(${u.id},'${u.name}')">🗑️</button>
                    </div>
                </div>`;
            }).join('');
    }

    renderAdminCourses() {
        const container = document.getElementById('admin-courses-list');
        container.innerHTML = this.adminCourses.length === 0
            ? '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Ders yok.</div>'
            : this.adminCourses.map(c => `
                <div class="admin-list-item">
                    <div class="admin-list-avatar" style="background:rgba(59,130,246,0.15);color:var(--accent);">${c.code[0]}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;">${c.name}</div>
                        <div style="font-size:0.75rem;color:var(--text-secondary);">${c.code} &nbsp;·&nbsp; ${c.teacher_name || 'Öğretmen atanmamış'}</div>
                    </div>
                    <span style="background:rgba(129,140,248,0.12);color:#a5b4fc;font-size:0.7rem;font-weight:700;padding:0.2rem 0.6rem;border-radius:0.375rem;white-space:nowrap;">${c.enrollment_count || 0} kayıtlı</span>
                    <div style="display:flex;gap:0.5rem;">
                        <button class="btn-icon" onclick="app.openCourseModal(${c.id})">✏️</button>
                        <button class="btn-icon btn-danger" onclick="app.deleteCourse(${c.id},'${c.name}')">🗑️</button>
                    </div>
                </div>`).join('');
    }

    // ── KULLANICI MODAL ───────────────────────────────────────────────────────

    async openUserModal(userId = null) {
        this.editingUser = userId ? this.adminUsers.find(u => u.id === userId) : null;
        const u = this.editingUser;
        document.getElementById('modal-title').innerText = u ? 'Kullanıcı Düzenle' : 'Kullanıcı Ekle';
        document.getElementById('modal-body').innerHTML = `
            <div class="input-group"><label>Ad Soyad</label>
                <input type="text" id="m-name" value="${u?.name||''}"></div>
            <div class="input-group"><label>E-posta</label>
                <input type="email" id="m-email" value="${u?.email||''}"></div>
            <div class="input-group"><label>${u ? 'Yeni Şifre (boş = değişmez)' : 'Şifre'}</label>
                <input type="password" id="m-password" placeholder="••••••"></div>
            <div class="input-group"><label>Rol</label>
                <select id="m-role" onchange="app.toggleModalRole()">
                    <option value="student" ${u?.role==='student'?'selected':''}>Öğrenci</option>
                    <option value="teacher" ${u?.role==='teacher'?'selected':''}>Öğretmen</option>
                    <option value="admin"   ${u?.role==='admin'  ?'selected':''}>Admin</option>
                </select></div>
            <div id="m-student-fields" class="${(u?.role||'student')==='student'?'':'hidden'}">
                <div class="input-group"><label>Öğrenci No</label>
                    <input type="text" id="m-student-no" value="${u?.student_no||''}"></div>
            </div>
            <div id="m-teacher-fields" class="${u?.role==='teacher'?'':'hidden'}">
                <div class="input-group"><label>Departman</label>
                    <input type="text" id="m-department" value="${u?.department||''}"></div>
            </div>
            <div style="display:flex;gap:0.75rem;margin-top:1.5rem;">
                <button class="btn" style="background:rgba(255,255,255,0.06);border:1px solid var(--glass-border);" onclick="app.closeModal()">İptal</button>
                <button class="btn btn-primary" onclick="app.saveUser()">Kaydet</button>
            </div>`;
        document.getElementById('modal-overlay').classList.remove('hidden');
    }

    toggleModalRole() {
        const role = document.getElementById('m-role').value;
        document.getElementById('m-student-fields').classList.toggle('hidden', role !== 'student');
        document.getElementById('m-teacher-fields').classList.toggle('hidden', role !== 'teacher');
    }

    async saveUser() {
        const data = {
            name:       document.getElementById('m-name').value.trim(),
            email:      document.getElementById('m-email').value.trim(),
            password:   document.getElementById('m-password').value,
            role:       document.getElementById('m-role').value,
            student_no: document.getElementById('m-student-no')?.value.trim() || '',
            department: document.getElementById('m-department')?.value.trim() || '',
        };
        if (!data.name || !data.email) { this.toast('Ad ve e-posta zorunlu.', 'error'); return; }

        const url    = this.editingUser ? `/admin/users/${this.editingUser.id}` : '/admin/users';
        const method = this.editingUser ? 'PUT' : 'POST';
        const res = await fetch(`${CONFIG.API_BASE}${url}`, {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.error) { this.toast(result.error, 'error'); return; }
        this.closeModal();
        this.toast('Kullanıcı kaydedildi.', 'success');
        await this.refreshAdminUsers();
        this.fetchAdminStats();
        await this.syncFromCloud();
    }

    async deleteUser(userId, name) {
        if (!confirm(`"${name}" silinsin mi?`)) return;
        await fetch(`${CONFIG.API_BASE}/admin/users/${userId}`, { method: 'DELETE' });
        this.toast(`${name} silindi.`, 'info');
        await this.refreshAdminUsers();
        this.fetchAdminStats();
        await this.syncFromCloud();
    }

    // ── DERS MODAL ────────────────────────────────────────────────────────────

    async openCourseModal(courseId = null) {
        this.editingCourse = courseId ? this.adminCourses.find(c => c.id === courseId) : null;
        const c = this.editingCourse;
        let teachers = [];
        try {
            const res = await fetch(`${CONFIG.API_BASE}/admin/teachers`);
            teachers = res.ok ? await res.json() : [];
        } catch(e) {}

        document.getElementById('modal-title').innerText = c ? 'Ders Düzenle' : 'Ders Ekle';
        document.getElementById('modal-body').innerHTML = `
            <div class="input-group"><label>Ders Kodu</label>
                <input type="text" id="m-code" value="${c?.code||''}" placeholder="BLG301"></div>
            <div class="input-group"><label>Ders Adı</label>
                <input type="text" id="m-cname" value="${c?.name||''}"></div>
            <div class="input-group"><label>Öğretmen</label>
                <select id="m-teacher">
                    ${teachers.map(t => `<option value="${t.id}" ${c?.teacher_id===t.id?'selected':''}>${t.name}</option>`).join('')}
                </select></div>
            <div style="display:flex;gap:0.75rem;margin-top:1.5rem;">
                <button class="btn" style="background:rgba(255,255,255,0.06);border:1px solid var(--glass-border);" onclick="app.closeModal()">İptal</button>
                <button class="btn btn-primary" onclick="app.saveCourse()">Kaydet</button>
            </div>`;
        document.getElementById('modal-overlay').classList.remove('hidden');
    }

    async saveCourse() {
        const data = {
            code:       document.getElementById('m-code').value.trim(),
            name:       document.getElementById('m-cname').value.trim(),
            teacher_id: document.getElementById('m-teacher').value,
        };
        if (!data.code || !data.name) { this.toast('Ders kodu ve adı zorunlu.', 'error'); return; }
        const url    = this.editingCourse ? `/admin/courses/${this.editingCourse.id}` : '/admin/courses';
        const method = this.editingCourse ? 'PUT' : 'POST';
        const res = await fetch(`${CONFIG.API_BASE}${url}`, {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.error) { this.toast(result.error, 'error'); return; }
        this.closeModal();
        this.toast('Ders kaydedildi.', 'success');
        await this.refreshAdminCourses();
        await this.syncFromCloud();
    }

    async deleteCourse(courseId, name) {
        if (!confirm(`"${name}" dersi silinsin mi?`)) return;
        await fetch(`${CONFIG.API_BASE}/admin/courses/${courseId}`, { method: 'DELETE' });
        this.toast(`${name} dersi silindi.`, 'info');
        await this.refreshAdminCourses();
        this.fetchAdminStats();
        await this.syncFromCloud();
    }

    // ── ADMİN KAYIT YÖNETİMİ ─────────────────────────────────────────────────

    async refreshAdminEnrollment() {
        await this.refreshAdminCourses();
        const select = document.getElementById('enrollment-course-select');
        if (!select) return;
        if (!this.adminCourses.length) {
            select.innerHTML = '<option value="">Ders bulunamadı</option>';
            return;
        }
        const prev = select.value;
        select.innerHTML = this.adminCourses.map(c =>
            `<option value="${c.id}" ${c.id == prev ? 'selected' : ''}>${c.code} — ${c.name}</option>`
        ).join('');
        this.loadEnrollmentForCourse();
    }

    async loadEnrollmentForCourse() {
        const courseId  = document.getElementById('enrollment-course-select')?.value;
        const container = document.getElementById('admin-enrollment-list');
        if (!courseId || !container) return;
        container.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">Yükleniyor...</div>';
        try {
            const [enrollRes, usersRes] = await Promise.all([
                fetch(`${CONFIG.API_BASE}/admin/courses/${courseId}/students`),
                fetch(`${CONFIG.API_BASE}/admin/users`),
            ]);
            const enrolled  = enrollRes.ok ? await enrollRes.json() : [];
            const allUsers  = usersRes.ok  ? await usersRes.json()  : [];
            const enrolledIds = new Set(enrolled.map(e => e.student_id));
            const unenrolled  = allUsers.filter(u => u.role === 'student' && !enrolledIds.has(u.id));

            const studentSel = document.getElementById('enrollment-student-select');
            studentSel.innerHTML = unenrolled.length
                ? unenrolled.map(u => `<option value="${u.id}">${u.name}${u.student_no ? ' (' + u.student_no + ')' : ''}</option>`).join('')
                : '<option value="">Tüm öğrenciler zaten kayıtlı</option>';

            this.renderEnrollmentList(enrolled, parseInt(courseId));
        } catch(e) {
            container.innerHTML = '<div style="padding:1rem;color:var(--danger);">Veri alınamadı.</div>';
        }
    }

    renderEnrollmentList(enrolled, courseId) {
        const container = document.getElementById('admin-enrollment-list');
        if (!enrolled.length) {
            container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary);">Bu derse kayıtlı öğrenci yok.</div>';
            return;
        }
        container.innerHTML =
            `<div style="font-size:0.75rem;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:0.75rem;">Kayıtlı Öğrenciler (${enrolled.length})</div>` +
            enrolled.map(e => {
                const r     = e.attendance_rate;
                const color = r === null ? '#64748b' : r >= 85 ? '#10b981' : r >= 70 ? '#f59e0b' : '#f43f5e';
                const rText = r === null ? '—' : `%${r}`;
                return `
                    <div class="admin-list-item">
                        <div class="admin-list-avatar" style="background:rgba(16,185,129,0.12);color:#10b981;">${e.name[0]}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.name}</div>
                            <div style="font-size:0.75rem;color:var(--text-secondary);">${e.student_no || e.email}</div>
                        </div>
                        <div style="text-align:right;min-width:4.5rem;">
                            <div style="font-weight:800;font-size:0.95rem;color:${color};">${rText}</div>
                            <div style="font-size:0.7rem;color:var(--text-secondary);">${e.attended}/${e.total_sessions} ders</div>
                        </div>
                        <button class="btn-icon btn-danger" onclick="app.adminUnenrollStudent(${courseId},${e.student_id},'${e.name.replace(/'/g,"\\'")}')">🗑️</button>
                    </div>`;
            }).join('');
    }

    async adminEnrollStudent() {
        const courseId  = document.getElementById('enrollment-course-select')?.value;
        const studentId = document.getElementById('enrollment-student-select')?.value;
        if (!courseId || !studentId) { this.toast('Ders ve öğrenci seçin.', 'error'); return; }
        const res  = await fetch(`${CONFIG.API_BASE}/admin/courses/${courseId}/enroll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: parseInt(studentId) }),
        });
        const data = await res.json();
        if (data.error) { this.toast(data.error, 'error'); return; }
        this.toast('Öğrenci derse eklendi.', 'success');
        this.loadEnrollmentForCourse();
        this.fetchAdminStats();
    }

    async adminUnenrollStudent(courseId, studentId, name) {
        if (!confirm(`"${name}" bu dersten çıkarılsın mı?`)) return;
        await fetch(`${CONFIG.API_BASE}/admin/courses/${courseId}/enroll/${studentId}`, { method: 'DELETE' });
        this.toast(`${name} dersten çıkarıldı.`, 'info');
        this.loadEnrollmentForCourse();
        this.fetchAdminStats();
    }

    closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
        this.editingUser = null;
        this.editingCourse = null;
    }

    // ── TOAST ────────────────────────────────────────────────────────────────

    toast(message, type = 'info') {
        const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
        const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        t.innerHTML = `
            <span class="toast-icon">${icons[type] || 'ℹ'}</span>
            <span class="toast-msg">${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
        document.getElementById('toast-container').appendChild(t);
        requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
        setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => t.remove(), 400);
        }, 3800);
    }

    // ── AUTH TABS ────────────────────────────────────────────────────────────

    switchAuthTab(tab) {
        document.getElementById('auth-login-panel')?.classList.toggle('hidden', tab !== 'login');
        document.getElementById('auth-register-panel')?.classList.toggle('hidden', tab !== 'register');
        document.getElementById('tab-btn-login')?.classList.toggle('active', tab === 'login');
        document.getElementById('tab-btn-register')?.classList.toggle('active', tab === 'register');
    }

    // ── KAYIT ────────────────────────────────────────────────────────────────

    async register() {
        const name   = document.getElementById('reg-name').value.trim();
        const email  = document.getElementById('reg-email').value.trim();
        const studNo = document.getElementById('reg-student-no').value.trim();
        const pass   = document.getElementById('reg-password').value;
        const pass2  = document.getElementById('reg-password2').value;
        if (!name || !email || !studNo || !pass) { this.toast('Tüm alanları doldurun.', 'error'); return; }
        if (pass !== pass2)  { this.toast('Şifreler eşleşmiyor.', 'error'); return; }
        if (pass.length < 6) { this.toast('Şifre en az 6 karakter olmalı.', 'error'); return; }
        try {
            const res = await fetch(`${CONFIG.API_BASE}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, student_no: studNo, password: pass })
            });
            const data = await res.json();
            if (data.error) { this.toast(data.error, 'error'); return; }
            this.toast('Hesabınız oluşturuldu! Giriş yapabilirsiniz.', 'success');
            this.switchAuthTab('login');
            document.getElementById('login-email').value = email;
            document.getElementById('login-password').value = '';
        } catch(e) {
            this.toast('Sunucuya bağlanılamadı.', 'error');
        }
    }

    // ── GERİ SAYIM ───────────────────────────────────────────────────────────

    startCountdown(expiry) {
        this.stopCountdown();
        const el = document.getElementById('qr-countdown');
        if (!el) return;
        const update = () => {
            const rem = expiry - Date.now();
            if (rem <= 0) {
                el.textContent = '⏱ Süre doldu';
                el.classList.add('urgent');
                this.stopCountdown();
                return;
            }
            const m = Math.floor(rem / 60000);
            const s = Math.floor((rem % 60000) / 1000);
            el.textContent = `⏱ ${m}:${s.toString().padStart(2, '0')}`;
            el.classList.toggle('urgent', rem < 60000);
        };
        update();
        this._countdownTimer = setInterval(update, 1000);
    }

    stopCountdown() {
        if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
        const el = document.getElementById('qr-countdown');
        if (el) { el.textContent = '⏱ 5:00'; el.classList.remove('urgent'); }
    }

    // ── UTILS ────────────────────────────────────────────────────────────────

    setupEventListeners() {
        document.getElementById('login-password')?.addEventListener('keypress', e => {
            if (e.key === 'Enter') this.login();
        });
        document.getElementById('reg-password2')?.addEventListener('keypress', e => {
            if (e.key === 'Enter') this.register();
        });
        document.getElementById('enroll-code')?.addEventListener('keypress', e => {
            if (e.key === 'Enter') this.enrollInCourse();
        });
        document.getElementById('modal-overlay')?.addEventListener('click', e => {
            if (e.target === document.getElementById('modal-overlay')) this.closeModal();
        });
    }
}

const app = new AttendanceApp();
