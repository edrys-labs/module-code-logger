// DOM elements
const roleNote = document.getElementById('role-note');
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
const paginationButtons = document.querySelector('.prev-next-btns');
const prevPage = document.getElementById('prev-btn');
const nextPage = document.getElementById('next-btn');
const pageInfo = document.getElementById('page-info');

const logsModal = document.getElementById('logs-modal');
const logsSelect = document.getElementById('logs-select');
const closeModalButton = document.getElementById('close-modal');
const loadLog = document.getElementById('load-log');
const loadError = document.getElementById('load-error');

const scrollUpButton = document.getElementById('scroll-up');

// Logger variables
let isLoggingEnabled = false;
let logsDate = null;
let isLoadError = false;
let currentPage = 1;
const submissionsPerPage = 10;

Edrys.onReady(() => {
    console.log('Code Logger is ready!');

    // Only teachers may monitor. This hides the UI; it is not a security
    // boundary, since any module in the room can listen to 'execute'.
    if (Edrys.role !== 'teacher') {
        roleNote.textContent = 'The code log is only available to teachers.';
        return;
    }
    roleNote.classList.add('hidden');
    loggerContainer.classList.remove('hidden');

    // Messages arrive only from this room; changing rooms reloads the module
    roomName.textContent = Edrys.liveUser?.room ?? '';
});

// Switch between the start view ('main') and the log view ('logs')
function showView(view) {
    mainViews.forEach((element) => element.classList.toggle('hidden', view !== 'main'));
    logViews.forEach((element) => element.classList.toggle('hidden', view !== 'logs'));
};

// The badge in the header: kind is 'on', 'off' or 'wait'
function setStatus(text, kind) {
    statusBadge.textContent = text;
    statusBadge.className = `badge ${kind}`;
};

// The name edrys shows for a user, falling back to the raw username
function displayName(username) {
    return Edrys.liveClass?.users?.[username]?.displayName || username;
};

let studentsSubmissions = []; // To store the code submissions

// Listen for code submissions
Edrys.onMessage(({ from, subject, body }) => {
    if (subject === 'execute' && isLoggingEnabled) {
        const newEntry = {
            From: displayName(from),
            FromId: from,
            Date: new Date().toLocaleString(),
            // Any module may send under 'execute', and bodies can be any value
            Code: typeof body === 'string' ? body : JSON.stringify(body, null, 2)
        };

        studentsSubmissions.push(newEntry);

        renderSubmissions();
        storeLogInIndexedDB();
    }
}, (promiscuous = true));

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
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.classList.add('language-cpp');
        code.textContent = String(submission.Code ?? '');
        pre.appendChild(code);
        studentCode.appendChild(pre);

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

// Whether parsed JSON is a log as downloaded by this module
function isCodeLog(logs) {
    return Array.isArray(logs) && logs.every((entry) => entry && typeof entry === 'object' && 'Code' in entry);
};

// Logger Main Buttons Handlers
startLogger.onclick = () => {
    isLoggingEnabled = true;
    logsDate = new Date().toLocaleString();
    studentsSubmissions = [];
    currentPage = 1;
    renderSubmissions();

    stopLogger.disabled = false;
    clearLogger.disabled = true;
    backToMain.disabled = true;

    setStatus('monitoring', 'on');
    showView('logs');
}

stopLogger.onclick = () => {
    isLoggingEnabled = false;
    stopLogger.disabled = true;
    clearLogger.disabled = false;
    backToMain.disabled = false;
    setStatus('stopped', 'off');
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

    const username = Edrys.username.split('_')[0];
    const stationName = Edrys.liveUser.room;

    const a = document.createElement('a');
    a.href = url;
    a.download = `CodeLog_User: ${username}_${stationName}_Date: ${logsDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

backToMain.onclick = () => {
    studentsSubmissions = [];
    currentPage = 1;
    renderSubmissions();

    setStatus('idle', 'wait');
    showView('main');
};


// Store log in IndexedDB
function storeLogInIndexedDB() {
    const username = Edrys.username.split('_')[0];
    const stationName = Edrys.liveUser.room;

    db.logs.put({ id: `User: ${username}_${stationName}_Date: ${logsDate}`, studentsSubmissions: studentsSubmissions });
};

// Load logs from IndexedDB for the select field
function loadLogsIntoModal() {
    db.logs.toArray().then((allLogs) => {
        logsSelect.innerHTML = '<option value="" disabled selected>Choose a log</option>';

        if (allLogs.length === 0) {
            const noLogsOption = document.createElement('option');
            noLogsOption.textContent = "No logs available.";
            noLogsOption.disabled = true;
            logsSelect.appendChild(noLogsOption);
            return;
        }

        allLogs.forEach((log) => {
            const option = document.createElement('option');
            option.value = log.id;
            
            // Parse the log ID
            // Format: "User: username_Station name_Date: datetime"
            const parts = log.id.split('_Date:');
            const userAndStation = parts[0];  // "User: username_Station name"
            const dateTime = parts[1];        // " datetime"
            
            const stationName = userAndStation.split('_')[1]; // "Station name"
            
            option.textContent = `${stationName} - Date:${dateTime}`;
            logsSelect.appendChild(option);
        });
    });
}

// Load log from IndexedDB
function loadLogFromDB() {
    const selectedLogId = logsSelect.value;

    // Check if a log is selected
    if (!selectedLogId) {
        isLoadError = true;
        loadError.textContent = "Please select a log.";
        return;
    }

    // Fetch the log from IndexedDB
    db.logs.get(selectedLogId)
        .then((log) => {
            if (!log) {
                isLoadError = true;
                loadError.textContent = "Log not found.";
                return;
            }

            // Update submissions array and render
            studentsSubmissions = log.studentsSubmissions;
            renderSubmissions();

            // Extract the date from the id (to be used for download)
            logsDate = selectedLogId.split('_Date: ').pop();

            // No errors, close the dialog and show the log
            isLoadError = false;
            logsModal.close();
            loadError.textContent = "";

            showLoadedLog('loaded from DB');
        })
        .catch((error) => {
            isLoadError = true;
            loadError.textContent = "An error occurred while loading the log.";
            console.error("Error loading log:", error);
        });
};


// Show a log that was loaded, not recorded: it can't be stopped, only cleared or left
function showLoadedLog(status) {
    stopLogger.disabled = true;
    clearLogger.disabled = false;
    backToMain.disabled = false;
    setStatus(status, 'wait');
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
                // The log's own start, for the download name
                logsDate = logs.length > 0 ? logs[0].Date : new Date().toLocaleString();
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

// Database implementation
var db = new Dexie("CodeLogger");

db.version(1).stores({
    logs: 'id'
});