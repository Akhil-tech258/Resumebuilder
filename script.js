/* ============================================================
   RESUMEFORGE — script.js
   Version 1.0 | Firebase + Vanilla JS | Mobile-First
   ============================================================ */

'use strict';

/* ── 1. FIREBASE CONFIGURATION ─────────────────────────────
   IMPORTANT: Replace these values with your own Firebase
   project credentials from https://console.firebase.google.com
   Steps:
   1. Create a Firebase project
   2. Add a Web App
   3. Copy the firebaseConfig object here
   4. Enable Authentication → Email/Password
   5. Enable Firestore Database
   6. Enable Storage
   7. Deploy with: firebase deploy
   ─────────────────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey: "AIzaSyD9QTzXdIch7njqV3jjWFe4UMhN_POr57w",
  authDomain: "resum-1da6e.firebaseapp.com",
  projectId: "resum-1da6e",
  storageBucket: "resum-1da6e.firebasestorage.app",
  messagingSenderId: "579784313367",
  appId: "1:579784313367:web:cb203cb34145a8431cea52"
};

/* ── 2. APP STATE ──────────────────────────────────────────
   Central state object. All resume data lives here.
   Mirrors both localStorage (offline) and Firestore (cloud).
   ─────────────────────────────────────────────────────────── */
const AppState = {
  user: null,                  // Firebase user object
  currentTemplate: 'classic', // Active template name
  sectionOrder: [              // Draggable section order
    'objective','summary','experience','education',
    'skills','projects','certifications','achievements',
    'languages','hobbies','references'
  ],
  autoSaveTimer: null,         // Debounce timer ref
  isSaving: false,             // Cloud save in progress
  isFirebaseReady: false,      // Firebase initialized flag
  resumeData: {                // All resume field values
    firstName:'', lastName:'', jobTitle:'', email:'',
    phone:'', location:'', website:'', linkedin:'', github:'',
    objective:'', summary:'', skills:'',
    achievements:'', hobbies:'',
    referencesOnRequest: false,
    experience:[], education:[], projects:[],
    certifications:[], languages:[], references:[]
  }
};

/* ── 3. FIREBASE INITIALIZATION ────────────────────────────── */
let db, auth, storage;

function initFirebase() {
  try {
    // Use the global firebase object (loaded via compat CDN)
    firebase.initializeApp(firebaseConfig);
    auth    = firebase.auth();
    db      = firebase.firestore();
    storage = firebase.storage();
    AppState.isFirebaseReady = true;

    // Persist auth session across browser refreshes
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    // Listen for auth state changes
    auth.onAuthStateChanged(onAuthStateChanged);
    console.log('[ResumeForge] Firebase initialized successfully.');
  } catch (err) {
    console.warn('[ResumeForge] Firebase init failed:', err.message);
    console.warn('[ResumeForge] Running in offline mode (localStorage only).');
    AppState.isFirebaseReady = false;
    // Still boot the app in offline mode
    onAuthStateChanged(null);
  }
}

/* ── 4. AUTH STATE HANDLER ─────────────────────────────────── */
function onAuthStateChanged(user) {
  AppState.user = user;
  hideLoadingOverlay();

  if (user) {
    // Update navbar UI
    document.getElementById('nav-auth-out').classList.add('hidden');
    document.getElementById('nav-auth-in').classList.remove('hidden');
    updateNavAvatar(user);
    updateDropdownInfo(user);

    // Show email verification banner if unverified
    if (!user.emailVerified) {
      document.getElementById('verify-banner').classList.remove('hidden');
    }

    // Load resume data from Firestore, fall back to localStorage
    loadResumeData().then(() => {
      showSection('builder');
      populateFormFromState();
      updatePreview();
    });
  } else {
    document.getElementById('nav-auth-out').classList.remove('hidden');
    document.getElementById('nav-auth-in').classList.add('hidden');
    loadFromLocalStorage();
    showSection('landing');
  }
}

/* ── 5. AUTHENTICATION HANDLERS ────────────────────────────── */

/** Sign Up with email & password */
async function handleSignUp() {
  const name     = getValue('signup-name').trim();
  const email    = getValue('signup-email').trim();
  const password = getValue('signup-password');

  if (!name)     return showToast('Please enter your name.', 'error');
  if (!email)    return showToast('Please enter your email.', 'error');
  if (!isValidEmail(email)) return showToast('Please enter a valid email.', 'error');
  if (password.length < 6) return showToast('Password must be at least 6 characters.', 'error');

  if (!AppState.isFirebaseReady) {
    return showToast('Firebase not configured. Check firebaseConfig.', 'error');
  }

  try {
    setButtonLoading('signup-modal', true);
    const cred = await auth.createUserWithEmailAndPassword(email, password);

    // Update display name
    await cred.user.updateProfile({ displayName: name });

    // Send verification email
    await cred.user.sendEmailVerification();

    // Create user document in Firestore
    await db.collection('users').doc(cred.user.uid).set({
      name, email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      photoURL: ''
    });

    closeModal('signup-modal');
    showToast(`Welcome, ${name}! Check your email to verify your account.`, 'success');
    clearModal('signup-modal');
  } catch (err) {
    showToast(firebaseErrorMessage(err.code), 'error');
  } finally {
    setButtonLoading('signup-modal', false);
  }
}

/** Login with email & password */
async function handleLogin() {
  const email    = getValue('login-email').trim();
  const password = getValue('login-password');
  const remember = document.getElementById('login-remember').checked;

  if (!email)    return showToast('Please enter your email.', 'error');
  if (!password) return showToast('Please enter your password.', 'error');

  if (!AppState.isFirebaseReady) {
    return showToast('Firebase not configured.', 'error');
  }

  try {
    setButtonLoading('login-modal', true);
    const persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await auth.setPersistence(persistence);
    await auth.signInWithEmailAndPassword(email, password);
    closeModal('login-modal');
    clearModal('login-modal');
    showToast('Welcome back!', 'success');
  } catch (err) {
    showToast(firebaseErrorMessage(err.code), 'error');
  } finally {
    setButtonLoading('login-modal', false);
  }
}

/** Forgot Password — send reset email */
async function handleForgotPassword() {
  const email = getValue('forgot-email').trim();
  if (!email) return showToast('Please enter your email.', 'error');
  if (!isValidEmail(email)) return showToast('Please enter a valid email.', 'error');

  if (!AppState.isFirebaseReady) {
    return showToast('Firebase not configured.', 'error');
  }

  try {
    setButtonLoading('forgot-modal', true);
    await auth.sendPasswordResetEmail(email);
    showToast('Password reset email sent! Check your inbox.', 'success');
    closeModal('forgot-modal');
    clearModal('forgot-modal');
    showModal('login-modal');
  } catch (err) {
    showToast(firebaseErrorMessage(err.code), 'error');
  } finally {
    setButtonLoading('forgot-modal', false);
  }
}

/** Log Out */
async function handleLogout() {
  closeUserMenu();
  try {
    if (AppState.isFirebaseReady) await auth.signOut();
    AppState.user = null;
    showToast('Logged out successfully.', 'info');
    showSection('landing');
  } catch (err) {
    showToast('Logout failed. Please try again.', 'error');
  }
}

/** Resend email verification */
async function resendVerificationEmail() {
  if (!AppState.user) return;
  try {
    await AppState.user.sendEmailVerification();
    showToast('Verification email sent!', 'success');
  } catch (err) {
    showToast('Could not resend email. Try again later.', 'error');
  }
}

function dismissVerifyBanner() {
  document.getElementById('verify-banner').classList.add('hidden');
}

/* ── 6. DATA PERSISTENCE ────────────────────────────────────── */

/** Collect all form values into AppState.resumeData */
function collectResumeData() {
  const d = AppState.resumeData;

  d.firstName  = getValue('firstName');
  d.lastName   = getValue('lastName');
  d.jobTitle   = getValue('jobTitle');
  d.email      = getValue('email');
  d.phone      = getValue('phone');
  d.location   = getValue('location');
  d.website    = getValue('website');
  d.linkedin   = getValue('linkedin');
  d.github     = getValue('github');
  d.objective  = getValue('objective');
  d.summary    = getValue('summary');
  d.skills     = getValue('skills');
  d.achievements = getValue('achievements');
  d.hobbies    = getValue('hobbies');
  d.referencesOnRequest = document.getElementById('references-on-request').checked;

  // Dynamic lists are already kept in-state via their own handlers
  d.template     = AppState.currentTemplate;
  d.sectionOrder = [...AppState.sectionOrder];
}

/** Populate all form fields from AppState.resumeData */
function populateFormFromState() {
  const d = AppState.resumeData;

  setValue('firstName',   d.firstName  || '');
  setValue('lastName',    d.lastName   || '');
  setValue('jobTitle',    d.jobTitle   || '');
  setValue('email',       d.email      || '');
  setValue('phone',       d.phone      || '');
  setValue('location',    d.location   || '');
  setValue('website',     d.website    || '');
  setValue('linkedin',    d.linkedin   || '');
  setValue('github',      d.github     || '');
  setValue('objective',   d.objective  || '');
  setValue('summary',     d.summary    || '');
  setValue('skills',      d.skills     || '');
  setValue('achievements',d.achievements || '');
  setValue('hobbies',     d.hobbies    || '');

  const rorEl = document.getElementById('references-on-request');
  if (rorEl) rorEl.checked = d.referencesOnRequest || false;

  // Restore template
  if (d.template) {
    AppState.currentTemplate = d.template;
    document.querySelectorAll('.tpl-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.template === d.template);
    });
  }

  // Restore section order
  if (d.sectionOrder && d.sectionOrder.length > 0) {
    AppState.sectionOrder = d.sectionOrder;
    restoreSectionOrderUI();
  }

  // Render dynamic lists
  renderAllEntryLists();
  updateCharCounters();
}

/** Save to localStorage (always, as offline backup) */
function saveToLocalStorage() {
  try {
    const payload = {
      resumeData: AppState.resumeData,
      template:   AppState.currentTemplate,
      sectionOrder: AppState.sectionOrder
    };
    localStorage.setItem('resumeforge_data', JSON.stringify(payload));
  } catch (e) {
    console.warn('[ResumeForge] localStorage save failed:', e);
  }
}

/** Load from localStorage */
function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem('resumeforge_data');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.resumeData) AppState.resumeData = { ...AppState.resumeData, ...parsed.resumeData };
    if (parsed.template)   AppState.currentTemplate = parsed.template;
    if (parsed.sectionOrder) AppState.sectionOrder = parsed.sectionOrder;
    populateFormFromState();
    updatePreview();
  } catch (e) {
    console.warn('[ResumeForge] localStorage load failed:', e);
  }
}

/** Save resume to Firestore */
async function saveToFirestore() {
  if (!AppState.isFirebaseReady || !AppState.user) return;
  try {
    AppState.isSaving = true;
    setSaveStatus('saving');
    await db.collection('resumes').doc(AppState.user.uid).set({
      ...AppState.resumeData,
      template:     AppState.currentTemplate,
      sectionOrder: AppState.sectionOrder,
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    setSaveStatus('saved');
  } catch (err) {
    console.error('[ResumeForge] Firestore save error:', err);
    setSaveStatus('error');
  } finally {
    AppState.isSaving = false;
  }
}

/** Load resume from Firestore */
async function loadResumeData() {
  // First, load from localStorage for instant display
  loadFromLocalStorage();

  if (!AppState.isFirebaseReady || !AppState.user) return;

  try {
    const doc = await db.collection('resumes').doc(AppState.user.uid).get();
    if (doc.exists) {
      const data = doc.data();
      AppState.resumeData  = { ...AppState.resumeData, ...data };
      if (data.template)     AppState.currentTemplate = data.template;
      if (data.sectionOrder) AppState.sectionOrder    = data.sectionOrder;
    }
  } catch (err) {
    console.warn('[ResumeForge] Firestore load failed, using local data:', err);
  }
}

/** Auto-save: debounced 1.5s after last keystroke */
function triggerAutoSave() {
  collectResumeData();
  saveToLocalStorage();
  setSaveStatus('saving');

  clearTimeout(AppState.autoSaveTimer);
  AppState.autoSaveTimer = setTimeout(async () => {
    if (AppState.user && AppState.isFirebaseReady) {
      await saveToFirestore();
    } else {
      setSaveStatus('saved');
    }
  }, 1500);
}

/* ── 7. LIVE PREVIEW ENGINE ─────────────────────────────────── */

/** Called on every form input change — updates preview + triggers save */
function updatePreview() {
  collectResumeData();
  updateCharCounters();
  renderResumePreview();
  triggerAutoSave();
}

/** Master preview renderer — picks the right template */
function renderResumePreview() {
  const preview = document.getElementById('resume-preview');
  if (!preview) return;

  const tpl = AppState.currentTemplate;
  const d   = AppState.resumeData;

  // Set template class
  preview.className = `resume-preview tpl-${tpl}`;

  // Generate HTML based on template
  switch (tpl) {
    case 'modern':    preview.innerHTML = buildModernTemplate(d);    break;
    case 'minimal':   preview.innerHTML = buildMinimalTemplate(d);   break;
    case 'executive': preview.innerHTML = buildExecutiveTemplate(d); break;
    case 'creative':  preview.innerHTML = buildCreativeTemplate(d);  break;
    default:          preview.innerHTML = buildClassicTemplate(d);   break;
  }
}

/* ── 8. TEMPLATE BUILDERS ────────────────────────────────────── */

/** Render an ordered list of sections */
function renderSectionsOrdered(d, sectionMap) {
  return AppState.sectionOrder
    .map(key => sectionMap[key] ? sectionMap[key]() : '')
    .join('');
}

/** Escape HTML to prevent XSS in preview */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/** Format skills array as chip spans */
function renderSkillChips(skillsStr, cls) {
  if (!skillsStr.trim()) return '';
  return skillsStr.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => `<span class="${cls}">${esc(s)}</span>`)
    .join('');
}

/** Build contact info items */
function buildContactItems(d) {
  const items = [];
  if (d.email)    items.push({ icon: 'fa-envelope', text: esc(d.email) });
  if (d.phone)    items.push({ icon: 'fa-phone',    text: esc(d.phone) });
  if (d.location) items.push({ icon: 'fa-location-dot', text: esc(d.location) });
  if (d.website)  items.push({ icon: 'fa-globe',    text: esc(d.website) });
  if (d.linkedin) items.push({ icon: 'fa-linkedin fab', text: esc(d.linkedin) });
  if (d.github)   items.push({ icon: 'fa-github fab',   text: esc(d.github) });
  return items;
}

/** Generic experience/education entry block */
function buildEntryHTML(entry, cls, includeUrl = false) {
  const url = includeUrl && entry.url
    ? `<span class="${cls}-dates"><a href="${esc(entry.url)}" style="color:inherit;">${esc(entry.url)}</a></span>`
    : '';
  return `
    <div class="${cls}-block">
      <div class="${cls}-header">
        <div>
          <div class="${cls}-title">${esc(entry.title || entry.name || '')}</div>
          <div class="${cls}-subtitle">${esc(entry.subtitle || entry.institution || entry.issuer || entry.company || '')}</div>
        </div>
        <div class="${cls}-dates">${esc(entry.dates || entry.year || '')}</div>
      </div>
      ${entry.description ? `<div class="${cls}-desc">${esc(entry.description)}</div>` : ''}
      ${url}
    </div>`;
}

/* ─── CLASSIC TEMPLATE ─── */
function buildClassicTemplate(d) {
  const fullName = `${esc(d.firstName)} ${esc(d.lastName)}`.trim();
  const contact  = buildContactItems(d)
    .map(i => `<span><i class="fas ${i.icon}"></i>${i.text}</span>`)
    .join('');

  const sections = {
    objective:      () => d.objective ? `<div class="section-title">Career Objective</div><p class="text-block">${esc(d.objective)}</p>` : '',
    summary:        () => d.summary ? `<div class="section-title">Professional Summary</div><p class="text-block">${esc(d.summary)}</p>` : '',
    experience:     () => d.experience.length ? `<div class="section-title">Work Experience</div>${d.experience.map(e=>buildEntryHTML(e,'tpl-classic')).join('')}` : '',
    education:      () => d.education.length ? `<div class="section-title">Education</div>${d.education.map(e=>buildEntryHTML(e,'tpl-classic')).join('')}` : '',
    skills:         () => d.skills ? `<div class="section-title">Skills</div><div class="skills-list">${renderSkillChips(d.skills,'skill-chip')}</div>` : '',
    projects:       () => d.projects.length ? `<div class="section-title">Projects</div>${d.projects.map(e=>buildEntryHTML(e,'tpl-classic',true)).join('')}` : '',
    certifications: () => d.certifications.length ? `<div class="section-title">Certifications</div>${d.certifications.map(e=>buildEntryHTML(e,'tpl-classic')).join('')}` : '',
    achievements:   () => d.achievements ? `<div class="section-title">Achievements</div><p class="text-block">${esc(d.achievements)}</p>` : '',
    languages:      () => d.languages.length ? `<div class="section-title">Languages</div><div class="skills-list">${d.languages.map(l=>`<span class="skill-chip">${esc(l.name)}${l.level?' — '+esc(l.level):''}</span>`).join('')}</div>` : '',
    hobbies:        () => d.hobbies ? `<div class="section-title">Interests & Hobbies</div><p class="text-block">${esc(d.hobbies)}</p>` : '',
    references:     () => buildReferencesSection(d, 'tpl-classic'),
  };

  return `
    <div class="resume-header">
      ${fullName ? `<div class="resume-name">${fullName}</div>` : '<div class="resume-name" style="color:#d1d5db;">Your Name</div>'}
      ${d.jobTitle ? `<div class="resume-headline">${esc(d.jobTitle)}</div>` : ''}
      ${contact ? `<div class="resume-contact">${contact}</div>` : ''}
    </div>
    ${renderSectionsOrdered(d, sections)}
  `;
}

/* ─── MODERN TEMPLATE ─── */
function buildModernTemplate(d) {
  const fullName = `${esc(d.firstName)} ${esc(d.lastName)}`.trim();
  const contactItems = buildContactItems(d);

  const sidebar = `
    <div class="resume-sidebar">
      <div class="resume-name">${fullName || '<span style="color:#6b7280">Your Name</span>'}</div>
      ${d.jobTitle ? `<div class="resume-headline">${esc(d.jobTitle)}</div>` : ''}
      <div class="sidebar-section-title">Contact</div>
      <div class="sidebar-contact">
        ${contactItems.map(i=>`<span><i class="fas ${i.icon}"></i>${i.text}</span>`).join('')}
      </div>
      ${d.skills ? `<div class="sidebar-section-title">Skills</div><div class="sidebar-skill">${d.skills.split(',').map(s=>`<div>• ${esc(s.trim())}</div>`).join('')}</div>` : ''}
      ${d.languages.length ? `<div class="sidebar-section-title">Languages</div><div class="sidebar-skill">${d.languages.map(l=>`<div>• ${esc(l.name)}${l.level?' ('+esc(l.level)+')':''}</div>`).join('')}</div>` : ''}
      ${d.hobbies ? `<div class="sidebar-section-title">Interests</div><div class="sidebar-skill">${esc(d.hobbies)}</div>` : ''}
    </div>`;

  const mainSections = {lock">${esc(d.objective)}</div>` : '',
    summary:        () => d.summary ? `<div class="section-title">Professional Summary</div><div class="text-block">${esc(d.summary)}</div>` : '',
    experience:     () => d.experience.length ? `<div class="section-title">Experience</div>${d.experience.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.title||e.name||'')}</div><div class="entry-subtitle">${esc(e.company||e.subtitle||'')}</div></div><div class="entry-dates">${esc(e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    education:      () => d.education.length ? `<div class="section-title">Education</div>${d.education.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.name||e.title||'')}</div><div class="entry-subtitle">${esc(e.institution||'')}</div></div><div class="entry-dates">${esc(e.year||e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    skills:         () => '',   // Rendered in sidebar
    projects:       () => d.projects.length ? `<div class="section-title">Projects</div>${d.projects.map(e=>`<div class="entry-block"><div class="entry-title">${esc(e.name||e.title||'')}</div>${e.subtitle?`<div class="entry-subtitle">${esc(e.subtitle)}</div>`:''}<div class="entry-dates">${esc(e.dates||'')}</div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    certifications: () => d.certifications.length ? `<div class="section-title">Certifications</div>${d.certifications.map(e=>`<div class="entry-block"><div class="entry-title">${esc(e.name||e.title||'')}</div><div class="entry-subtitle">${esc(e.issuer||e.subtitle||'')}</div><div class="entry-dates">${esc(e.year||e.dates||'')}</div></div>`).join('')}` : '',
    achievements:   () => d.achievements ? `<div class="section-title">Achievements</div><div class="text-block">${esc(d.achievements)}</div>` : '',
    languages:      () => '',   // Rendered in sidebar
    hobbies:        () => '',   // Rendered in sidebar
    references:     () => buildReferencesSection(d, 'tpl-modern'),
  };

  return `
    ${sidebar}
    <div class="resume-main">
      ${renderSectionsOrdered(d, mainSections)}
    </div>`;
}

/* ─── MINIMAL TEMPLATE ─── */
function buildMinimalTemplate(d) {
  const firstName = esc(d.firstName) || '';
  const lastName  = esc(d.lastName) || '';
  const contact   = buildContactItems(d)
    .map(i => `<span><i class="fas ${i.icon}"></i>${i.text}</span>`)
    .join('');

  const sections = {
    objective:      () => d.objective ? `<div class="section-title">Objective</div><div class="text-block">${esc(d.objective)}</div>` : '',
    summary:        () => d.summary ? `<div class="section-title">Summary</div><div class="text-block">${esc(d.summary)}</div>` : '',
    experience:     () => d.experience.length ? `<div class="section-title">Experience</div>${d.experience.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.title||e.name||'')}</div><div class="entry-subtitle">${esc(e.company||e.subtitle||'')}</div></div><div class="entry-dates">${esc(e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    education:      () => d.education.length ? `<div class="section-title">Education</div>${d.education.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.name||e.title||'')}</div><div class="entry-subtitle">${esc(e.institution||'')}</div></div><div class="entry-dates">${esc(e.year||e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    skills:         () => d.skills ? `<div class="section-title">Skills</div><div>${renderSkillChips(d.skills,'skill-chip')}</div>` : '',
    projects:       () => d.projects.length ? `<div class="section-title">Projects</div>${d.projects.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.name||e.title||'')}</div></div><div class="entry-dates">${esc(e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    certifications: () => d.certifications.length ? `<div class="section-title">Certifications</div>${d.certifications.map(e=>`<div class="entry-block"><div class="entry-title">${esc(e.name||e.title||'')}</div><div class="entry-subtitle">${esc(e.issuer||e.subtitle||'')}</div></div>`).join('')}` : '',
    achievements:   () => d.achievements ? `<div class="section-title">Achievements</div><div class="text-block">${esc(d.achievements)}</div>` : '',
    languages:      () => d.languages.length ? `<div class="section-title">Languages</div><div>${d.languages.map(l=>`<span class="skill-chip">${esc(l.name)}${l.level?' ('+esc(l.level)+')':''}</span>`).join('')}</div>` : '',
    hobbies:        () => d.hobbies ? `<div class="section-title">Interests</div><div class="text-block">${esc(d.hobbies)}</div>` : '',
    references:     () => buildReferencesSection(d, 'tpl-minimal'),
  };

  return `
    <div class="resume-name"><strong>${firstName}</strong> ${lastName}</div>
    ${d.jobTitle ? `<div class="resume-headline">${esc(d.jobTitle)}</div>` : ''}
    ${contact ? `<div class="resume-contact">${contact}</div>` : ''}
    ${renderSectionsOrdered(d, sections)}
  `;
}

/* ─── EXECUTIVE TEMPLATE ─── */
function buildExecutiveTemplate(d) {
  const fullName = `${esc(d.firstName)} ${esc(d.lastName)}`.trim();
  const contact  = buildContactItems(d)
    .map(i => `<span><i class="fas ${i.icon}"></i>${i.text}</span>`)
    .join('');

  const sections = {
    objective:      () => d.objective ? `<div class="section-title">Career Objective</div><p class="text-block">${esc(d.objective)}</p>` : '',
    summary:        () => d.summary ? `<div class="section-title">Executive Summary</div><p class="text-block">${esc(d.summary)}</p>` : '',
    experience:     () => d.experience.length ? `<div class="section-title">Professional Experience</div>${d.experience.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.title||e.name||'')}</div><div class="entry-subtitle">${esc(e.company||e.subtitle||'')}</div></div><div class="entry-dates">${esc(e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    education:      () => d.education.length ? `<div class="section-title">Education</div>${d.education.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.name||e.title||'')}</div><div class="entry-subtitle">${esc(e.institution||'')}</div></div><div class="entry-dates">${esc(e.year||e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    skills:         () => d.skills ? `<div class="section-title">Core Competencies</div><div>${renderSkillChips(d.skills,'skill-chip')}</div>` : '',
    projects:       () => d.projects.length ? `<div class="section-title">Key Projects</div>${d.projects.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.name||e.title||'')}</div></div><div class="entry-dates">${esc(e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    certifications: () => d.certifications.length ? `<div class="section-title">Certifications</div>${d.certifications.map(e=>`<div class="entry-block"><div class="entry-title">${esc(e.name||e.title||'')}</div><div class="entry-subtitle">${esc(e.issuer||e.subtitle||'')}</div><div class="entry-dates">${esc(e.year||e.dates||'')}</div></div>`).join('')}` : '',
    achievements:   () => d.achievements ? `<div class="section-title">Key Achievements</div><p class="text-block">${esc(d.achievements)}</p>` : '',
    languages:      () => d.languages.length ? `<div class="section-title">Languages</div><div>${d.languages.map(l=>`<span class="skill-chip">${esc(l.name)}${l.level?' — '+esc(l.level):''}</span>`).join('')}</div>` : '',
    hobbies:        () => d.hobbies ? `<div class="section-title">Personal Interests</div><p class="text-block">${esc(d.hobbies)}</p>` : '',
    references:     () => buildReferencesSection(d, 'tpl-executive'),
  };

  return `
    <div class="resume-header">
      <div class="resume-name">${fullName || '<span style="opacity:0.4">Your Name</span>'}</div>
      ${d.jobTitle ? `<div class="resume-headline">${esc(d.jobTitle)}</div>` : ''}
      ${contact ? `<div class="resume-contact">${contact}</div>` : ''}
    </div>
    <div class="resume-body">
      ${renderSectionsOrdered(d, sections)}
    </div>`;
}

/* ─── CREATIVE TEMPLATE ─── */
function buildCreativeTemplate(d) {
  const fullName = `${esc(d.firstName)} ${esc(d.lastName)}`.trim();
  const contact  = buildContactItems(d)
    .map(i => `<span><i class="fas ${i.icon}"></i>${i.text}</span>`)
    .join('');

  const sections = {
    objective:      () => d.objective ? `<div class="section-title">Career Objective</div><div class="text-block">${esc(d.objective)}</div>` : '',
    summary:        () => d.summary ? `<div class="section-title">About Me</div><div class="text-block">${esc(d.summary)}</div>` : '',
    experience:     () => d.experience.length ? `<div class="section-title">Experience</div>${d.experience.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.title||e.name||'')}</div><div class="entry-subtitle">${esc(e.company||e.subtitle||'')}</div></div><div class="entry-dates">${esc(e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    education:      () => d.education.length ? `<div class="section-title">Education</div>${d.education.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.name||e.title||'')}</div><div class="entry-subtitle">${esc(e.institution||'')}</div></div><div class="entry-dates">${esc(e.year||e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    skills:         () => d.skills ? `<div class="section-title">Skills</div><div>${renderSkillChips(d.skills,'skill-chip')}</div>` : '',
    projects:       () => d.projects.length ? `<div class="section-title">Projects</div>${d.projects.map(e=>`<div class="entry-block"><div class="entry-header"><div><div class="entry-title">${esc(e.name||e.title||'')}</div></div><div class="entry-dates">${esc(e.dates||'')}</div></div>${e.description?`<div class="entry-desc">${esc(e.description)}</div>`:''}</div>`).join('')}` : '',
    certifications: () => d.certifications.length ? `<div class="section-title">Certifications</div>${d.certifications.map(e=>`<div class="entry-block"><div class="entry-title">${esc(e.name||e.title||'')}</div><div class="entry-subtitle">${esc(e.issuer||e.subtitle||'')}</div></div>`).join('')}` : '',
    achievements:   () => d.achievements ? `<div class="section-title">Achievements</div><div class="text-block">${esc(d.achievements)}</div>` : '',
    languages:      () => d.languages.length ? `<div class="section-title">Languages</div><div>${d.languages.map(l=>`<span class="skill-chip">${esc(l.name)}${l.level?' ('+esc(l.level)+')':''}</span>`).join('')}</div>` : '',
    hobbies:        () => d.hobbies ? `<div class="section-title">Interests</div><div class="text-block">${esc(d.hobbies)}</div>` : '',
    references:     () => buildReferencesSection(d, 'tpl-creative'),
  };

  return `
    <div class="resume-header">
      <div class="resume-name">${fullName || '<span style="opacity:0.5">Your Name</span>'}</div>
      ${d.jobTitle ? `<div class="resume-headline">${esc(d.jobTitle)}</div>` : ''}
      ${contact ? `<div class="resume-contact">${contact}</div>` : ''}
    </div>
    <div class="resume-body">
      ${renderSectionsOrdered(d, sections)}
    </div>`;
}

/** References section builder (shared across templates) */
function buildReferencesSection(d, cls) {
  const refClass = cls.replace('tpl-','');
  if (d.referencesOnRequest) {
    return `<div class="section-title">References</div><p class="text-block" style="font-style:italic;">References available upon request.</p>`;
  }
  if (!d.references.length) return '';
  return `
    <div class="section-title">References</div>
    ${d.references.map(r => `
      <div class="entry-block">
        <div class="entry-title">${esc(r.name||'')}</div>
        <div class="entry-subtitle">${esc(r.subtitle||'')}${r.company ? ' — '+esc(r.company) : ''}</div>
        ${r.email  ? `<div class="entry-dates">${esc(r.email)}</div>` : ''}
        ${r.phone  ? `<div class="entry-dates">${esc(r.phone)}</div>` : ''}
      </div>`).join('')}`;
}

/* ── 9. DYNAMIC ENTRY LISTS ─────────────────────────────────── */

/** Entry schema per section type */
const ENTRY_SCHEMAS = {
  experience: [
    { id:'title',       label:'Job Title',   placeholder:'Software Engineer',    span: 'full' },
    { id:'company',     label:'Company',     placeholder:'Google Inc.',          span: '' },
    { id:'dates',       label:'Dates',       placeholder:'Jan 2022 — Present',   span: '' },
    { id:'description', label:'Description', placeholder:'• Led development of…\n• Improved performance by…', type:'textarea', span:'full' }
  ],
  education: [
    { id:'name',        label:'Degree / Program', placeholder:'B.Sc. Computer Science', span:'full' },
    { id:'institution', label:'Institution',       placeholder:'MIT',                    span:'' },
    { id:'year',        label:'Year / Dates',      placeholder:'2018 — 2022',            span:'' },
    { id:'description', label:'Notes (GPA, honors…)', placeholder:'GPA 3.9, Dean\'s List', type:'textarea', span:'full' }
  ],
  projects: [
    { id:'name',        label:'Project Name',  placeholder:'ResumeForge',              span:'full' },
    { id:'subtitle',    label:'Tech Stack',    placeholder:'React, Firebase, Node.js', span:'' },
    { id:'dates',       label:'Year',          placeholder:'2024',                     span:'' },
    { id:'url',         label:'URL / GitHub',  placeholder:'github.com/you/project',   span:'' },
    { id:'description', label:'Description',   placeholder:'Built a full-stack…',      type:'textarea', span:'full' }
  ],
  certifications: [
    { id:'name',   label:'Certification Name', placeholder:'AWS Certified Developer',      span:'full' },
    { id:'issuer', label:'Issuing Org',         placeholder:'Amazon Web Services',          span:'' },
    { id:'year',   label:'Year',                placeholder:'2024',                         span:'' }
  ],
  languages: [
    { id:'name',  label:'Language', placeholder:'English',    span:'' },
    { id:'level', label:'Level',    placeholder:'Native / B2', span:'' }
  ],
  references: [
    { id:'name',     label:'Full Name',    placeholder:'Jane Smith',       span:'full' },
    { id:'subtitle', label:'Job Title',    placeholder:'Engineering Lead', span:'' },
    { id:'company',  label:'Company',      placeholder:'Acme Corp',        span:'' },
    { id:'email',    label:'Email',        placeholder:'jane@acme.com',    span:'' },
    { id:'phone',    label:'Phone',        placeholder:'+1 555 0001',      span:'' }
  ]
};

/** Add a new blank entry to a section */
function addEntry(section) {
  const arr = AppState.resumeData[section];
  if (!arr) return;
  const schema = ENTRY_SCHEMAS[section];
  const blank = {};
  schema.forEach(f => { blank[f.id] = ''; });
  arr.push(blank);
  renderEntryList(section);
  updatePreview();
}

/** Remove an entry by index */
function removeEntry(section, idx) {
  AppState.resumeData[section].splice(idx, 1);
  renderEntryList(section);
  updatePreview();
}

/** Render the form cards for a single section list */
function renderEntryList(section) {
  const container = document.getElementById(`${section}-list`);
  if (!container) return;
  const arr    = AppState.resumeData[section];
  const schema = ENTRY_SCHEMAS[section];

  container.innerHTML = arr.map((entry, idx) => {
    const label = entry.title || entry.name || `${capitalize(section)} ${idx + 1}`;
    const fields = schema.map(f => {
      const isTextarea = f.type === 'textarea';
      const inputEl = isTextarea
        ? `<textarea id="${section}_${idx}_${f.id}" placeholder="${esc(f.placeholder)}" rows="3"
             oninput="updateEntryField('${section}',${idx},'${f.id}',this.value)">${esc(entry[f.id] || '')}</textarea>`
        : `<input type="text" id="${section}_${idx}_${f.id}" placeholder="${esc(f.placeholder)}"
             value="${esc(entry[f.id] || '')}"
             oninput="updateEntryField('${section}',${idx},'${f.id}',this.value)" />`;
      return `<div class="form-group${f.span==='full'?' full':''}">
        <label for="${section}_${idx}_${f.id}">${f.label}</label>
        ${inputEl}
      </div>`;
    }).join('');

    return `
      <div class="entry-card" id="${section}-card-${idx}">
        <div class="entry-card-header">
          <span class="entry-card-title">${esc(label)}</span>
          <div class="entry-card-actions">
            ${idx > 0 ? `<button class="entry-btn move" onclick="moveEntry('${section}',${idx},-1)" title="Move up"><i class="fas fa-chevron-up"></i></button>` : ''}
            ${idx < arr.length-1 ? `<button class="entry-btn move" onclick="moveEntry('${section}',${idx},1)" title="Move down"><i class="fas fa-chevron-down"></i></button>` : ''}
            <button class="entry-btn" onclick="removeEntry('${section}',${idx})" title="Remove"><i class="fas fa-trash-can"></i></button>
          </div>
        </div>
        <div class="form-grid">${fields}</div>
      </div>`;
  }).join('');
}

/** Update a single field in an entry */
function updateEntryField(section, idx, field, value) {
  if (AppState.resumeData[section] && AppState.resumeData[section][idx] !== undefined) {
    AppState.resumeData[section][idx][field] = value;
    // Update card title if name/title field changed
    const titleEl = document.querySelector(`#${section}-card-${idx} .entry-card-title`);
    if (titleEl) {
      const entry = AppState.resumeData[section][idx];
      titleEl.textContent = entry.title || entry.name || `${capitalize(section)} ${idx + 1}`;
    }
    updatePreview();
  }
}

/** Move an entry up or down */
function moveEntry(section, idx, dir) {
  const arr = AppState.resumeData[section];
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= arr.length) return;
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  renderEntryList(section);
  updatePreview();
}

/** Render all entry lists at once (e.g. after loading data) */
function renderAllEntryLists() {
  Object.keys(ENTRY_SCHEMAS).forEach(section => renderEntryList(section));
}

/* ── 10. TEMPLATE SWITCHING ─────────────────────────────────── */
function switchTemplate(name, btn) {
  AppState.currentTemplate = name;
  document.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderResumePreview();
  triggerAutoSave();
  showToast(`Template switched to "${capitalize(name)}"`, 'info');
}

/* ── 11. SECTION DRAG-AND-DROP ──────────────────────────────── */
function initSortable() {
  const el = document.getElementById('sections-sortable');
  if (!el || typeof Sortable === 'undefined') return;

  Sortable.create(el, {
    animation:      200,
    ghostClass:     'sortable-chosen',
    handle:         '.sortable-item',
    onEnd(evt) {
      const items = el.querySelectorAll('[data-section]');
      AppState.sectionOrder = Array.from(items).map(i => i.dataset.section);
      renderResumePreview();
      triggerAutoSave();
    }
  });
}

/** Restore section order from saved data */
function restoreSectionOrderUI() {
  const list = document.getElementById('sections-sortable');
  if (!list) return;
  const items = Array.from(list.querySelectorAll('[data-section]'));
  AppState.sectionOrder.forEach(section => {
    const el = items.find(i => i.dataset.section === section);
    if (el) list.appendChild(el);
  });
}

/* ── 12. PDF DOWNLOAD ───────────────────────────────────────── */
function downloadPDF() {
  const fullName = `${AppState.resumeData.firstName}_${AppState.resumeData.lastName}`.trim() || 'Resume';
  const element  = document.getElementById('resume-preview');
  if (!element) return;

  showToast('Generating PDF…', 'info');

  const opt = {
    margin:       [0, 0, 0, 0],
    filename:     `${fullName}_Resume.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
  };

  html2pdf()
    .set(opt)
    .from(element)
    .save()
    .then(() => showToast('PDF downloaded!', 'success'))
    .catch(() => showToast('PDF export failed. Try printing instead.', 'error'));
}

/* ── 13. PRINT ──────────────────────────────────────────────── */
function printResume() {
  window.print();
}

/* ── 14. RESUME VALIDATION ──────────────────────────────────── */
function validateResume() {
  const d = AppState.resumeData;
  const checks = [];
  let score = 0;

  // Required fields
  const hasName = d.firstName.trim() || d.lastName.trim();
  checks.push({ pass: !!hasName, label: 'Full name provided', type: 'required' });
  checks.push({ pass: !!d.email.trim(), label: 'Email address provided', type: 'required' });
  checks.push({ pass: !!d.phone.trim(), label: 'Phone number provided', type: 'recommended' });
  checks.push({ pass: !!d.jobTitle.trim(), label: 'Job title / headline provided', type: 'recommended' });
  checks.push({ pass: !!d.location.trim(), label: 'Location provided', type: 'recommended' });

  // Content sections
  checks.push({ pass: d.experience.length > 0, label: 'At least one work experience entry', type: 'required' });
  checks.push({ pass: d.education.length > 0, label: 'At least one education entry', type: 'required' });
  checks.push({ pass: !!d.skills.trim(), label: 'Skills section filled', type: 'required' });
  checks.push({ pass: !!(d.summary.trim() || d.objective.trim()), label: 'Summary or objective provided', type: 'recommended' });

  // ATS-specific
  checks.push({ pass: isValidEmail(d.email), label: 'Valid email format for ATS parsing', type: 'ats' });
  checks.push({ pass: !hasSpecialChars(d.firstName + d.lastName), label: 'Name contains no special characters', type: 'ats' });
  checks.push({ pass: d.skills.split(',').filter(Boolean).length >= 3, label: 'At least 3 skills listed', type: 'ats' });
  checks.push({ pass: d.experience.every(e => e.dates && e.dates.trim()), label: 'All experience entries have dates', type: 'ats' });

  // Content quality
  const summaryLen = (d.summary || d.objective || '').length;
  checks.push({ pass: summaryLen >= 50, label: 'Summary / objective has meaningful content (50+ chars)', type: 'quality' });
  checks.push({ pass: d.experience.some(e => e.description && e.description.length > 30), label: 'Experience includes detailed descriptions', type: 'quality' });

  // Calculate score
  const passed = checks.filter(c => c.pass).length;
  score = Math.round((passed / checks.length) * 100);

  const scoreClass = score >= 80 ? 'score-excellent' : score >= 60 ? 'score-good' : 'score-poor';
  const scoreLabel = score >= 80 ? '🎉 Excellent! Ready to send.' : score >= 60 ? '⚡ Good, a few tweaks needed.' : '⚠️ Needs improvement.';

  const html = `
    <div class="validation-score">
      <div class="score-number ${scoreClass}">${score}</div>
      <div style="font-size:1.5rem;margin:4px 0">/ 100</div>
      <div class="score-label">${scoreLabel}</div>
    </div>
    <div class="validation-items">
      ${checks.map(c => `
        <div class="val-item ${c.pass ? 'pass' : c.type==='required'?'fail':'warn'}">
          <i class="fas ${c.pass ? 'fa-circle-check' : c.type==='required'?'fa-circle-xmark':'fa-triangle-exclamation'}"></i>
          <span>${c.label}</span>
        </div>`).join('')}
    </div>`;

  document.getElementById('validation-results').innerHTML = html;
  showModal('validate-modal');
}

/* ── 15. CLEAR ALL DATA ─────────────────────────────────────── */
function confirmClearResume() {
  showModal('confirm-modal');
}

async function clearAllData() {
  // Reset state
  AppState.resumeData = {
    firstName:'', lastName:'', jobTitle:'', email:'',
    phone:'', location:'', website:'', linkedin:'', github:'',
    objective:'', summary:'', skills:'',
    achievements:'', hobbies:'',
    referencesOnRequest: false,
    experience:[], education:[], projects:[],
    certifications:[], languages:[], references:[]
  };
  AppState.currentTemplate = 'classic';
  AppState.sectionOrder    = [
    'objective','summary','experience','education','skills',
    'projects','certifications','achievements','languages','hobbies','references'
  ];

  // Clear form fields
  populateFormFromState();
  renderResumePreview();
  saveToLocalStorage();

  // Clear from Firestore if logged in
  if (AppState.user && AppState.isFirebaseReady) {
    try {
      await db.collection('resumes').doc(AppState.user.uid).delete();
    } catch (e) { /* silent */ }
  }

  closeModal('confirm-modal');
  showToast('All resume data cleared.', 'info');
}

/* ── 16. UI HELPERS ─────────────────────────────────────────── */

/** Show a page section, hide others */
function showSection(name) {
  ['landing','builder'].forEach(s => {
    const el = document.getElementById(`${s}-section`);
    if (el) el.classList.toggle('hidden', s !== name);
  });
  window.scrollTo(0, 0);

  // Initialize sortable on first builder visit
  if (name === 'builder') {
    requestAnimationFrame(() => {
      initSortable();
      scalePreviewOnMobile();
    });
  }
}

/** Show modal */
function showModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/** Close modal */
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  document.body.style.overflow = '';
}

/** Switch between modals */
function switchModal(from, to) {
  closeModal(from);
  setTimeout(() => showModal(to), 150);
}

/** Close modal if clicking on overlay (not modal itself) */
function closeModalOnOverlay(event, id) {
  if (event.target.id === id) closeModal(id);
}

/** Toggle accordion open/close */
function toggleAccordion(id) {
  const body   = document.getElementById(id);
  const header = body?.previousElementSibling;
  if (!body) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (header) header.classList.toggle('active', !isOpen);
}

/** Toggle dark/light theme */
function toggleTheme() {
  const html    = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next    = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('theme-icon').className = next === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  localStorage.setItem('resumeforge_theme', next);
}

/** User dropdown menu */
function toggleUserMenu() {
  document.getElementById('user-dropdown')?.classList.toggle('open');
}
function closeUserMenu() {
  document.getElementById('user-dropdown')?.classList.remove('open');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#nav-user-menu')) closeUserMenu();
});

/** Update navbar avatar with user info */
function updateNavAvatar(user) {
  const img      = document.getElementById('nav-avatar-img');
  const initials = document.getElementById('nav-avatar-initials');
  if (user.photoURL) {
    img.src = user.photoURL;
    img.classList.remove('hidden');
    initials.textContent = '';
  } else {
    img.classList.add('hidden');
    const name = user.displayName || user.email || '';
    initials.textContent = getInitials(name);
  }
}

function updateDropdownInfo(user) {
  const nameEl  = document.getElementById('dropdown-name');
  const emailEl = document.getElementById('dropdown-email');
  if (nameEl)  nameEl.textContent  = user.displayName || 'User';
  if (emailEl) emailEl.textContent = user.email || '';
}

/** Mobile builder tab switch (form ↔ preview) */
function switchBuilderTab(tab) {
  const formPanel    = document.getElementById('builder-form-panel');
  const previewPanel = document.getElementById('builder-preview-panel');
  const tabForm      = document.getElementById('tab-form');
  const tabPreview   = document.getElementById('tab-preview');

  if (tab === 'form') {
    formPanel.classList.remove('mobile-hidden');
    previewPanel.classList.remove('mobile-visible');
    tabForm.classList.add('active');
    tabPreview.classList.remove('active');
  } else {
    formPanel.classList.add('mobile-hidden');
    previewPanel.classList.add('mobile-visible');
    tabForm.classList.remove('active');
    tabPreview.classList.add('active');
    scalePreviewOnMobile();
  }
}

/** Scale the resume preview to fit mobile screen width */
function scalePreviewOnMobile() {
  const wrapper  = document.querySelector('.preview-scale-wrapper');
  const preview  = document.getElementById('resume-preview');
  if (!wrapper || !preview) return;

  const wrapperW = wrapper.clientWidth - 32; // padding
  const resumeW  = 794; // A4 px width
  if (wrapperW < resumeW) {
    const scale = wrapperW / resumeW;
    preview.style.transform       = `scale(${scale})`;
    preview.style.transformOrigin = 'top left';
    preview.style.marginBottom    = `-${resumeW * (1 - scale)}px`;
  } else {
    preview.style.transform = '';
    preview.style.marginBottom = '';
  }
}

/** Toggle preview fullscreen / wide */
function togglePreviewFullscreen() {
  const panel = document.getElementById('builder-preview-panel');
  panel.classList.toggle('preview-fullscreen');
  const icon = document.querySelector('#preview-expand-btn i');
  if (icon) icon.className = panel.classList.contains('preview-fullscreen') ? 'fas fa-compress' : 'fas fa-expand';
}

/** Set save status indicator */
function setSaveStatus(state) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.className = `save-status ${state}`;
  const map = {
    saving: '<i class="fas fa-circle-notch fa-spin"></i> Saving…',
    saved:  '<i class="fas fa-circle-check"></i> Saved',
    error:  '<i class="fas fa-circle-exclamation"></i> Save failed'
  };
  el.innerHTML = map[state] || map.saved;
}

/** Show toast notification */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success:'fa-circle-check', error:'fa-circle-xmark', info:'fa-circle-info' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fas ${icons[type]||icons.info} toast-icon"></i><span>${esc(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

/** Password visibility toggle */
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
}

/** Disable/enable submit buttons during async ops */
function setButtonLoading(modalId, isLoading) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const btn = modal.querySelector('.btn-primary');
  if (!btn) return;
  btn.disabled = isLoading;
  if (isLoading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Please wait…';
  } else {
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

/** Clear all inputs inside a modal */
function clearModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.querySelectorAll('input').forEach(i => { i.value = ''; });
}

/** Hide the full-page loading overlay */
function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.add('fade-out');
  setTimeout(() => overlay.remove(), 400);
}

/** Scroll to features section on landing page */
function scrollToFeatures() {
  document.getElementById('features-section')?.scrollIntoView({ behavior: 'smooth' });
}

/** Update character counters for textareas */
function updateCharCounters() {
  const counters = [
    { id: 'objective', max: 300 },
    { id: 'summary',   max: 500 }
  ];
  counters.forEach(({ id, max }) => {
    const el  = document.getElementById(id);
    const cnt = document.getElementById(`${id}-counter`);
    if (el && cnt) {
      const len = el.value.length;
      cnt.textContent = `${len} / ${max}`;
      cnt.style.color = len > max ? 'var(--danger)' : 'var(--text-muted)';
    }
  });
}

/* ── 17. UTILITY FUNCTIONS ──────────────────────────────────── */

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}
function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function hasSpecialChars(str) {
  return /[<>{}|\\^~[\]`]/.test(str);
}

/** Map Firebase error codes to user-friendly messages */
function firebaseErrorMessage(code) {
  const map = {
    'auth/email-already-in-use':    'An account with this email already exists.',
    'auth/invalid-email':           'Please enter a valid email address.',
    'auth/weak-password':           'Password must be at least 6 characters.',
    'auth/user-not-found':          'No account found with this email.',
    'auth/wrong-password':          'Incorrect password. Please try again.',
    'auth/too-many-requests':       'Too many attempts. Please try again later.',
    'auth/network-request-failed':  'Network error. Check your connection.',
    'auth/user-disabled':           'This account has been disabled.',
    'auth/invalid-credential':      'Invalid credentials. Check email and password.',
    'auth/popup-closed-by-user':    'Sign-in popup was closed.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

/* ── 18. RESPONSIVE HANDLER ─────────────────────────────────── */
function handleResize() {
  scalePreviewOnMobile();
}

/* ── 19. KEYBOARD SHORTCUTS ─────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  // Escape closes open modals
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => {
      m.classList.add('hidden');
    });
    document.body.style.overflow = '';
  }
  // Ctrl+S / Cmd+S triggers save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    triggerAutoSave();
    showToast('Resume saved!', 'success');
  }
  // Ctrl+P opens print
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    if (document.getElementById('builder-section') && !document.getElementById('builder-section').classList.contains('hidden')) {
      e.preventDefault();
      printResume();
    }
  }
});

/* ── 20. NAVBAR SCROLL EFFECT ───────────────────────────────── */
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

/* ── 21. THEME INITIALIZATION ───────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('resumeforge_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.className = saved === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}

/* ── 22. APP BOOT ───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initFirebase();
  window.addEventListener('resize', handleResize, { passive: true });

  // Open first accordion (personal info) by default
  setTimeout(() => {
    const personalBody = document.getElementById('personal-body');
    if (personalBody && !personalBody.classList.contains('open')) {
      toggleAccordion('personal-body');
    }
  }, 300);
});

/* ── 23. FUTURE-READY EXTENSION POINTS ─────────────────────────
   These empty functions are stubs for Version 2 features.
   They are designed to be filled in without changing
   any existing code structure.

   v2 will add:
   - getAIResumeSuggestions()   → AI Writer integration
   - getATSScore()              → ATS keyword scoring
   - matchJobDescription()      → JD vs resume matching
   - generateCoverLetter()      → AI cover letter
   - uploadProfilePicture()     → Firebase Storage
   - getResumeHistory()         → Version history
   - syncToPortfolio()          → Portfolio generator
   - notifyRecruiter()          → Recruiter portal hook
   ─────────────────────────────────────────────────────────── */

// --- V2 Extension Stubs ---
window.ResumeForgeV2 = {
  /** @param {string} section - section name to improve */
  getAIResumeSuggestions: async (section) => {
    console.log('[V2] AI suggestions for:', section);
    // Will call Anthropic API via Firebase Cloud Function
  },
  /** @returns {Promise<number>} ATS score 0-100 */
  getATSScore: async () => {
    console.log('[V2] ATS score calculation');
  },
  /** @param {string} jobDescription */
  matchJobDescription: async (jobDescription) => {
    console.log('[V2] JD matching:', jobDescription.slice(0, 50));
  },
  /** @returns {Promise<string>} cover letter HTML */
  generateCoverLetter: async () => {
    console.log('[V2] Cover letter generation');
  },
  /** @param {File} file */
  uploadProfilePicture: async (file) => {
    console.log('[V2] Profile picture upload:', file.name);
    // storage.ref(`users/${AppState.user.uid}/avatar`).put(file)
  },
  getResumeHistory: async () => {
    console.log('[V2] Resume version history');
    // db.collection('resume_history').where('uid','==',uid).get()
  }
};
