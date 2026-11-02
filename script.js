// DOM elements
const loadingNote = document.getElementById('loading-note');
const loggerContainer = document.querySelector('.logger-container');
const roomName = document.getElementById('room-name');
const statusBadge = document.getElementById('status-badge');

// Start view: its controls in the header and the hint below
const mainViews = document.querySelectorAll('.main');
const startLogger = document.getElementById('start-logger');
const loadLogsFromDB = document.getElementById('load-logs-from-db');
const loadLogsFromFile = document.getElementById('load-logs-from-file');

// Log view: its controls in the header and the entries below
const logViews = document.querySelectorAll('.logs');
const stopLogger = document.getElementById('stop-logger');
const clearLogger = document.getElementById('clear-logger');
const downloadLogs = document.getElementById('download-logs');
const backToMain = document.getElementById('back-to-main');
const emptyLog = document.getElementById('empty-log');
const storageError = document.getElementById('storage-error');
const paginationButtons = document.querySelector('.prev-next-btns');
const prevPage = document.getElementById('prev-btn');
const nextPage = document.getElementById('next-btn');
const pageInfo = document.getElementById('page-info');

const logsModal = document.getElementById('logs-modal');
const logsSelect = document.getElementById('logs-select');
const closeModalButton = document.getElementById('close-modal');
const loadLog = document.getElementById('load-log');
const loadError = document.getElementById('load-error');

const subjectsElement = document.getElementById('subjects');
const scrollUpButton = document.getElementById('scroll-up');

// Settings, see the module-config meta in index.html
const DEFAULTS = {
    runCommand: 'execute',
    language: 'cpp'
};

// Logger variables
let isLoggingEnabled = false;
let currentPage = 1;
const submissionsPerPage = 10;
let subjects = [DEFAULTS.runCommand]; // Message subjects that are logged
let language = DEFAULTS.language; // Prism language of the code

// The log being recorded or loaded from IndexedDB (null for a log loaded from a file)
let currentLogId = null;
// Where and when the shown log was recorded, for the download name. Logs from
// files and older logs have no start time, only the date text of logsDate.
let logRoom = null;
let logStartedAt = null;
let logsDate = null;

// Database: one record per log in `logs`, one per run in `entries`.
// Logs saved before version 2 keep their runs inline (`studentsSubmissions`)
// and have no class, room or start time.
const db = new Dexie("CodeLogger");
db.version(1).stores({
    logs: 'id'
});
db.version(2).stores({
    logs: 'id, classId',
    entries: '++seq, logId'
});

// The classroom's theme (edrys.js puts it on <html>), the OS preference when opened on its own
const darkMode = matchMedia('(prefers-color-scheme: dark)');
function isDark() {
    const theme = document.documentElement.dataset.theme;
    return theme ? theme === 'dark' : darkMode.matches;
};

// Prism's token colours for the theme
function applyCodeTheme() {
    for (const link of document.querySelectorAll('link[data-code-theme]')) {
        link.media = (link.dataset.codeTheme === 'dark') === isDark() ? 'all' : 'not all';
    }
};

applyCodeTheme();
darkMode.addEventListener('change', applyCodeTheme);
// onTheme is missing in edrys.js before the themes came
Edrys.onTheme?.(applyCodeTheme);

Edrys.onReady(() => {
    // Who gets the logger is set by show-in (default "*, teacher-only"), not here
    loadingNote.classList.add('hidden');
    loggerContainer.classList.remove('hidden');

    // Messages arrive only from this room; changing rooms reloads the module
    roomName.textContent = Edrys.liveUser?.room ?? '';

    const config = readConfig();
    const runCommands = String(config.runCommand).split(',').map((s) => s.trim()).filter(Boolean);
    subjects = runCommands.length > 0 ? runCommands : [DEFAULTS.runCommand];
    subjectsElement.textContent = subjects.join(', ');
    language = String(config.language);
});

// The module's config merged with DEFAULTS. The settings form saves unset
// fields as '', and an unparsable config stays a string: both mean "default".
function readConfig() {
    const config = Edrys.module?.config;
    const merged = { ...DEFAULTS };
    if (config && typeof config === 'object') {
        for (const [key, value] of Object.entries(config)) {
            if (value !== '' && value != null) merged[key] = value;
        }
    }
    return merged;
};

// Switch between the start view ('main') and the log view ('logs')
function showView(view) {
    mainViews.forEach((element) => element.classList.toggle('hidden', view !== 'main'));
    logViews.forEach((element) => element.classList.toggle('hidden', view !== 'logs'));
};

// The pill in the toolbar: kind is 'ok' while monitoring, '' otherwise
function setStatus(text, kind) {
    statusBadge.textContent = text;
    statusBadge.className = `edrys-pill ${kind}`.trim();
};

// The name edrys shows for a user, falling back to the raw username
function displayName(username) {
    return Edrys.liveClass?.users?.[username]?.displayName || username;
};

let studentsSubmissions = []; // To store the code submissions

// Listen for code submissions
Edrys.onMessage(({ from, subject, body }) => {
    if (subjects.includes(subject) && isLoggingEnabled) {
        const newEntry = {
            From: displayName(from),
            FromId: from,
            Date: new Date().toLocaleString(),
            // Any module may send under these subjects, and bodies can be any value
            Code: typeof body === 'string' ? body : JSON.stringify(body, null, 2)
        };

        studentsSubmissions.push(newEntry);

        renderSubmissions();
        storeEntry(newEntry, studentsSubmissions.length === 1);
    }
}, true); // promiscuous: the code comes from other modules, e.g. editors

// Display the code submissions
function renderSubmissions() {
    const submissionsContainer = document.querySelector('.students-submissions');
    submissionsContainer.replaceChildren();

    downloadLogs.disabled = studentsSubmissions.length === 0;

    // Empty state
    emptyLog.classList.toggle('hidden', studentsSubmissions.length > 0);
    emptyLog.textContent = isLoggingEnabled
        ? 'No code has been run in this room yet. Waiting…'
        : 'This log is empty.';

    const startIndex = (currentPage - 1) * submissionsPerPage;
    const endIndex = startIndex + submissionsPerPage;
    const paginatedSubmissions = studentsSubmissions.slice(startIndex, endIndex);

    // Entries come from peers and from loaded files: insert them as text only
    paginatedSubmissions.forEach((submission) => {
        const submissionElement = document.createElement('div');
        submissionElement.classList.add('submission-wrapper');

        const studentInfo = document.createElement('div');
        studentInfo.classList.add('student-info');
        studentInfo.append(infoField('From', submission.From), infoField('Date', submission.Date));

        const studentCode = document.createElement('div');
        studentCode.classList.add('student-code');
        codeFiles(String(submission.Code ?? '')).forEach((file) => {
            if (file.name !== null) {
                const fileName = document.createElement('p');
                fileName.classList.add('file-name', 'mono');
                fileName.textContent = file.name;
                studentCode.appendChild(fileName);
            }
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.classList.add(`language-${language}`);
            code.textContent = file.code;
            pre.appendChild(code);
            studentCode.appendChild(pre);
        });

        submissionElement.append(studentInfo, studentCode);
        submissionsContainer.appendChild(submissionElement);
    });

    // Update pagination, shown only when there is more than one page
    const totalPages = Math.ceil(studentsSubmissions.length / submissionsPerPage);
    paginationButtons.classList.toggle('hidden', totalPages <= 1);
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
    prevPage.disabled = currentPage === 1;
    nextPage.disabled = currentPage === totalPages || totalPages === 0;

    // Highlight the code
    Prism.highlightAll();
};

// A "Label: value" field of the student info
function infoField(label, value) {
    const field = document.createElement('span');
    const labelElement = document.createElement('span');
    labelElement.classList.add('label');
    labelElement.textContent = `${label}:`;
    const valueElement = document.createElement('span');
    valueElement.textContent = String(value ?? '');
    field.append(labelElement, ' ', valueElement);
    return field;
};

// The files of a run. Editors in multi-file mode send '{"file": {"name": "code", ...}}';
// anything else is one unnamed file.
function codeFiles(code) {
    if (code.trimStart().startsWith('{')) {
        try {
            const { file } = JSON.parse(code);
            if (file && typeof file === 'object' && !Array.isArray(file)) {
                return Object.entries(file).map(([name, content]) => ({
                    name,
                    code: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
                }));
            }
        } catch (error) {
            // not JSON, so plain code that starts with '{'
        }
    }
    return [{ name: null, code }];
};

// "code-log_<room>_<start>.json", without characters that file systems reject
function downloadName() {
    const pad = (n) => String(n).padStart(2, '0');
    const start = logStartedAt
        ? `${logStartedAt.getFullYear()}-${pad(logStartedAt.getMonth() + 1)}-${pad(logStartedAt.getDate())}` +
          `T${pad(logStartedAt.getHours())}-${pad(logStartedAt.getMinutes())}`
        : logsDate;
    return ['code-log', logRoom, start]
        .filter(Boolean)
        .map((part) => String(part).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, ''))
        .join('_') + '.json';
};

// Room and date text of a log saved before version 2, from its id
// "User: username_Room name_Date: datetime"
function legacyLogInfo(id) {
    const [userAndRoom, dateTime = ''] = id.split('_Date:');
    return { room: userAndRoom.split('_')[1], date: dateTime.trim() };
};

// Whether parsed JSON is a log as downloaded by this module
function isCodeLog(logs) {
    return Array.isArray(logs) && logs.every((entry) => entry && typeof entry === 'object' && 'Code' in entry);
};

// Logger Main Buttons Handlers
startLogger.onclick = () => {
    isLoggingEnabled = true;
    currentLogId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    logRoom = Edrys.liveUser?.room ?? null;
    logStartedAt = new Date();
    logsDate = null;
    storageError.textContent = '';
    studentsSubmissions = [];
    currentPage = 1;
    renderSubmissions();

    stopLogger.disabled = false;
    clearLogger.disabled = true;
    backToMain.disabled = true;

    setStatus('monitoring', 'ok');
    showView('logs');
}

stopLogger.onclick = () => {
    isLoggingEnabled = false;
    stopLogger.disabled = true;
    clearLogger.disabled = false;
    backToMain.disabled = false;
    setStatus('stopped', '');
    renderSubmissions();
};

clearLogger.onclick = () => {
    studentsSubmissions = [];
    currentPage = 1;
    renderSubmissions();
};

downloadLogs.onclick = () => {
    const blob = new Blob([JSON.stringify(studentsSubmissions)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName();
    a.click();
    URL.revokeObjectURL(url);
};

backToMain.onclick = () => {
    studentsSubmissions = [];
    currentPage = 1;
    renderSubmissions();

    setStatus('idle', '');
    showView('main');
};


// Writes to IndexedDB, one after the other, so runs keep their order
let storeQueue = Promise.resolve();

// Store one run in IndexedDB; the log's own record is written with its first run
function storeEntry(entry, isFirst) {
    const logId = currentLogId;
    const log = {
        id: logId,
        classId: Edrys.class_id,
        room: Edrys.liveUser?.room ?? '',
        startedAt: logStartedAt.toISOString()
    };

    storeQueue = storeQueue
        .then(() => (isFirst ? db.logs.put(log) : undefined))
        .then(() => db.entries.add({ logId, ...entry }))
        .catch((error) => {
            console.error("Error saving log:", error);
            storageError.textContent =
                `Could not save the log in this browser (${error.name || error}). ` +
                "Runs are still listed here: download the log to keep it.";
        });
};

// The runs of a stored log, in the order they arrived
function readEntries(log) {
    if (Array.isArray(log.studentsSubmissions)) return Promise.resolve(log.studentsSubmissions);
    return db.entries.where('logId').equals(log.id).sortBy('seq')
        .then((entries) => entries.map(({ seq, logId, ...entry }) => entry));
};

// The select label of a stored log
function logLabel(log) {
    if (log.startedAt) return `${log.room} - ${new Date(log.startedAt).toLocaleString()}`;

    const { room, date } = legacyLogInfo(log.id);
    return `${room} - ${date} (older format)`;
};

// Load logs from IndexedDB for the select field: this class's logs, newest
// first, then the older ones that don't know their class
function loadLogsIntoModal() {
    db.logs.toArray().then((allLogs) => {
        logsSelect.replaceChildren(new Option('Choose a log', '', true, true));
        logsSelect.options[0].disabled = true;

        const logs = allLogs
            .filter((log) => !log.classId || log.classId === Edrys.class_id)
            .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));

        if (logs.length === 0) {
            const noLogsOption = new Option("No logs available.");
            noLogsOption.disabled = true;
            logsSelect.appendChild(noLogsOption);
            return;
        }

        logs.forEach((log) => logsSelect.appendChild(new Option(logLabel(log), log.id)));
    }).catch((error) => {
        loadError.textContent = "The saved logs could not be read.";
        console.error("Error listing logs:", error);
    });
}

// Load log from IndexedDB
function loadLogFromDB() {
    const selectedLogId = logsSelect.value;

    // Check if a log is selected
    if (!selectedLogId) {
        loadError.textContent = "Please select a log.";
        return;
    }

    // Fetch the log from IndexedDB
    db.logs.get(selectedLogId)
        .then((log) => {
            if (!log) {
                loadError.textContent = "Log not found.";
                return;
            }

            return readEntries(log).then((entries) => {
                // Update submissions array and render
                studentsSubmissions = entries;
                currentPage = 1;
                currentLogId = log.id;
                renderSubmissions();

                // Where and when it was recorded (to be used for download)
                const legacy = log.startedAt ? null : legacyLogInfo(log.id);
                logRoom = log.room ?? legacy.room;
                logStartedAt = log.startedAt ? new Date(log.startedAt) : null;
                logsDate = legacy ? legacy.date : null;

                // No errors, close the dialog and show the log
                logsModal.close();
                loadError.textContent = "";

                showLoadedLog('loaded from DB');
            });
        })
        .catch((error) => {
            loadError.textContent = "An error occurred while loading the log.";
            console.error("Error loading log:", error);
        });
};


// Show a log that was loaded, not recorded: it can't be stopped, only cleared or left
function showLoadedLog(status) {
    stopLogger.disabled = true;
    clearLogger.disabled = false;
    backToMain.disabled = false;
    setStatus(status, '');
    showView('logs');
};

// Load Modal Handlers
loadLogsFromDB.onclick = () => {
    loadLogsIntoModal();
    logsModal.showModal();
};

closeModalButton.onclick = () => {
    logsModal.close();
};

// Also on Esc
logsModal.onclose = () => {
    loadError.textContent = "";
};

loadLog.onclick = () => {
    loadLogFromDB();
};

// Load logs from file
loadLogsFromFile.onclick = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.click();

    fileInput.onchange = () => {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();

        reader.onload = () => {
            try {
                const logs = JSON.parse(reader.result);
                // Check before replacing the current log, so a bad file leaves it intact
                if (!isCodeLog(logs)) throw new Error('Not a code log');

                studentsSubmissions = logs;
                currentPage = 1;
                currentLogId = null;
                // A file knows no room or start time: name the download after its first run
                logRoom = null;
                logStartedAt = null;
                logsDate = logs.length > 0 ? logs[0].Date : null;
                renderSubmissions();

                showLoadedLog('loaded from file');
            } catch (error) {
                alert("Invalid file format. Please upload a valid JSON file.");
            }
        };

        reader.readAsText(file);
    };
};


// Handle scroll up 
window.onscroll = () => {
    const scrolled = document.body.scrollTop > 20 || document.documentElement.scrollTop > 20;
    scrollUpButton.classList.toggle('hidden', !scrolled);
};

scrollUpButton.onclick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Pagination buttons handlers 
prevPage.onclick = () => {
    if (currentPage > 1) {
        currentPage--;
        renderSubmissions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

nextPage.onclick = () => {
    const totalPages = Math.ceil(studentsSubmissions.length / submissionsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderSubmissions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};
