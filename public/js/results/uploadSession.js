/**
 * SRAAS — Upload Results (Page 1)
 * Handles: result-session dropdown preview, drag & drop marks card,
 *          extract button enable/disable, submit processing state.
 */
document.addEventListener('DOMContentLoaded', function () {
    var sessionSelect = document.getElementById('resultSessionSelect');
    var detailsCard = document.getElementById('sessionDetailsCard');
    var subjectPreviewList = document.getElementById('subjectPreviewList');
    var dropZone = document.getElementById('dropZone');
    var chooseFileButton = document.getElementById('chooseFileButton');
    var fileInput = document.getElementById('marksCardInput');
    var fileNameLabel = document.getElementById('fileNameLabel');
    var fileError = document.getElementById('fileErrorFeedback');
    var form = document.getElementById('uploadForm');
    var extractButton = document.getElementById('extractButton');

    function updateExtractButton() {
        if (!extractButton) return;
        var hasSession = sessionSelect && sessionSelect.value !== '';
        var hasFile = fileInput && fileInput.files.length > 0;
        extractButton.disabled = !(hasSession && hasFile);
    }

    // ------------------------------
    // Session selection
    // ------------------------------
    if (sessionSelect) {
        sessionSelect.addEventListener('change', async function () {
            if (sessionSelect.classList) sessionSelect.classList.remove('is-invalid');
            var sessionId = this.value;

            if (!sessionId) {
                if (detailsCard) detailsCard.style.display = 'none';
                updateExtractButton();
                return;
            }

            try {
                var response = await fetch('/results/session-details/' + sessionId);
                var data = await response.json();

                if (data.success) {
                    setText('displayAcademicYear', data.session.academic_year);
                    setText('displaySemester', data.session.semester);
                    setText('displayExamSession', data.session.exam_session + ' ' + data.session.exam_year);
                    setText('displaySubjectCount', data.session.subjects_count);

                    if (subjectPreviewList) {
                        subjectPreviewList.innerHTML = data.session.subjects.map(function (s) {
                            return '<tr>' +
                                '<td><code>' + escapeHtml(s.subject_code) + '</code></td>' +
                                '<td>' + escapeHtml(s.subject_name) + '</td>' +
                                '<td class="text-center">' + s.credits + '</td>' +
                                '</tr>';
                        }).join('');
                    }

                    if (detailsCard) detailsCard.style.display = 'block';
                } else {
                    if (detailsCard) detailsCard.style.display = 'none';
                }
            } catch (err) {
                console.error('Failed to load session details:', err);
                if (detailsCard) detailsCard.style.display = 'none';
            }

            updateExtractButton();
        });
    }


    // ------------------------------
    // File chooser + drag & drop
    // ------------------------------
    if (chooseFileButton && fileInput) {
        chooseFileButton.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            fileInput.click();
        });
    }

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', function () { fileInput.click(); });

        ['dragenter', 'dragover'].forEach(function (evt) {
            dropZone.addEventListener(evt, function (e) {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('border-primary', 'bg-white');
            });
        });

        ['dragleave', 'drop'].forEach(function (evt) {
            dropZone.addEventListener(evt, function (e) {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('border-primary', 'bg-white');
            });
        });

        dropZone.addEventListener('drop', function (e) {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                fileInput.files = e.dataTransfer.files;
                handleFileChosen();
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', handleFileChosen);
        fileInput.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    function handleFileChosen() {
        if (fileInput.files.length > 0) {
            fileNameLabel.textContent = fileInput.files[0].name;
            fileNameLabel.classList.remove('text-danger');
            hideFileError();
        } else {
            fileNameLabel.textContent = '';
        }
        updateExtractButton();
    }

    function showFileError() {
        if (fileError) {
            fileError.classList.remove('d-none');
            fileError.classList.add('text-danger');
        }
    }

    function hideFileError() {
        if (fileError) {
            fileError.classList.add('d-none');
            fileError.classList.remove('text-danger');
        }
    }

    // ------------------------------
    // Submit -> processing lock
    // ------------------------------
    if (form) {
        form.addEventListener('submit', function (e) {
            var hasSession = sessionSelect && sessionSelect.value !== '';
            var hasFile = fileInput && fileInput.files.length > 0;

            if (!hasSession && sessionSelect) {
                sessionSelect.classList.add('is-invalid');
            }
            if (!hasFile) { showFileError(); }

            if (!hasSession || !hasFile) {
                e.preventDefault();
                return;
            }

            // Lock UI while OCR runs server-side
            extractButton.disabled = true;
            extractButton.innerHTML =
                '<span class="spinner-border spinner-border-sm align-middle me-2"></span> Processing Marks Card…' +
                '<div class="small fw-normal mt-1">Extracting text · Detecting student info · Matching subject codes…</div>';
        });
    }

    // ------------------------------
    // Small helpers
    // ------------------------------
    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
});

