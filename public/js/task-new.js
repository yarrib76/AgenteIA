(function () {
  const taskForm = document.getElementById("taskForm");
  const taskIdInput = document.getElementById("taskId");
  const taskAgentIdInput = document.getElementById("taskAgentId");
  const taskPromptTemplateInput = document.getElementById("taskPromptTemplate");
  const taskInputField = document.getElementById("taskInput");
  const taskIntegrationIdInput = document.getElementById("taskIntegrationId");
  const taskScheduleEnabledInput = document.getElementById("taskScheduleEnabled");
  const taskScheduleTimeInput = document.getElementById("taskScheduleTime");
  const taskScheduleTimezoneInput = document.getElementById("taskScheduleTimezone");
  const taskScheduleDayInputs = Array.from(
    document.querySelectorAll('input[name="scheduleDays"]')
  );
  const taskScheduleToggleBtn = document.getElementById("taskScheduleToggleBtn");
  const taskScheduleBody = document.getElementById("taskScheduleBody");
  const taskResponseContactIdInput = document.getElementById("taskResponseContactId");
  const taskFileIdInput = document.getElementById("taskFileId");
  const taskUploadFileInput = document.getElementById("taskUploadFileInput");
  const uploadTaskFileBtn = document.getElementById("uploadTaskFileBtn");
  const taskFormTitle = document.getElementById("taskFormTitle");
  const saveTaskBtn = document.getElementById("saveTaskBtn");
  const cancelTaskEditBtn = document.getElementById("cancelTaskEditBtn");
  const taskMsg = document.getElementById("taskMsg");
  const promptButtons = document.querySelectorAll(".view-task-prompt-btn");
  const logButtons = document.querySelectorAll(".view-task-log-btn");
  const editButtons = document.querySelectorAll(".edit-task-btn");
  const deleteButtons = document.querySelectorAll(".delete-task-btn");
  const queueButtons = document.querySelectorAll(".queue-task-btn");
  const executeButtons = document.querySelectorAll(".execute-task-btn");
  const promptModal = document.getElementById("taskPromptModal");
  const promptOutput = document.getElementById("taskPromptOutput");
  const closeModalBtn = document.getElementById("closeTaskPromptModalBtn");
  const taskLogModal = document.getElementById("taskLogModal");
  const taskLogOutput = document.getElementById("taskLogOutput");
  const closeTaskLogModalBtn = document.getElementById("closeTaskLogModalBtn");
  const clearTaskLogsBtn = document.getElementById("clearTaskLogsBtn");
  const schedulePanelStorageKey = "task_schedule_panel_expanded";
  const tasksTable = document.getElementById("tasksTable");
  const tasksTableSearch = document.getElementById("tasksTableSearch");
  const tasksTableColumns = document.getElementById("tasksTableColumns");
  const tasksPrevPageBtn = document.getElementById("tasksPrevPageBtn");
  const tasksNextPageBtn = document.getElementById("tasksNextPageBtn");
  const tasksPageInfo = document.getElementById("tasksPageInfo");
  const tasksColumnStorageKey = "tasks_table_columns_v1";
  let currentLogTaskId = "";
  const logsTimeZone = "America/Argentina/Buenos_Aires";

  if (!taskForm) return;

  function setScheduleFieldsState() {
    const enabled = Boolean(taskScheduleEnabledInput && taskScheduleEnabledInput.checked);
    taskScheduleDayInputs.forEach((input) => {
      input.disabled = !enabled;
    });
    if (taskScheduleTimeInput) taskScheduleTimeInput.disabled = !enabled;
    if (taskScheduleTimezoneInput) taskScheduleTimezoneInput.disabled = !enabled;
  }

  function setSchedulePanelExpanded(expanded) {
    if (!taskScheduleBody || !taskScheduleToggleBtn) return;
    taskScheduleBody.classList.toggle("hidden", !expanded);
    taskScheduleToggleBtn.textContent = expanded ? "▾" : "▸";
    taskScheduleToggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    try {
      window.localStorage.setItem(schedulePanelStorageKey, expanded ? "1" : "0");
    } catch (error) {
      // noop
    }
  }

  function initSchedulePanel() {
    if (!taskScheduleBody || !taskScheduleToggleBtn) return;
    let expanded = false;
    try {
      const raw = window.localStorage.getItem(schedulePanelStorageKey);
      if (raw === "1") expanded = true;
      if (raw === "0") expanded = false;
    } catch (error) {
      expanded = false;
    }
    setSchedulePanelExpanded(expanded);

    taskScheduleToggleBtn.addEventListener("click", () => {
      const current = taskScheduleToggleBtn.getAttribute("aria-expanded") === "true";
      setSchedulePanelExpanded(!current);
    });
  }

  function initTasksDataTable() {
    if (!tasksTable) return;
    const defaultVisible = new Set([
      "fecha",
      "agente",
      "estado",
      "proxima_ejecucion",
      "respuesta_a",
      "archivo",
      "integracion",
      "acciones",
    ]);
    const ths = Array.from(tasksTable.querySelectorAll("thead th[data-col]"));
    const columns = ths.map((th) => ({
      key: String(th.dataset.col || "").trim(),
      label: String(th.textContent || "").trim(),
    }));
    if (!columns.length) return;

    let visibleColumns = new Set(defaultVisible);
    try {
      const saved = window.localStorage.getItem(tasksColumnStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          visibleColumns = new Set(parsed.map((x) => String(x || "").trim()));
        }
      }
    } catch (error) {
      visibleColumns = new Set(defaultVisible);
    }

    const rows = Array.from(tasksTable.querySelectorAll("tbody tr"));
    const pageSize = 10;
    let currentPage = 1;
    let filteredRows = rows.slice();

    function persistColumns() {
      try {
        window.localStorage.setItem(
          tasksColumnStorageKey,
          JSON.stringify(Array.from(visibleColumns))
        );
      } catch (error) {
        // noop
      }
    }

    function applyColumnVisibility() {
      columns.forEach((col) => {
        const visible = visibleColumns.has(col.key);
        tasksTable
          .querySelectorAll(`[data-col="${col.key}"]`)
          .forEach((cell) => {
            cell.style.display = visible ? "" : "none";
          });
      });
    }

    function renderPager() {
      const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
      if (currentPage > totalPages) currentPage = totalPages;
      if (tasksPageInfo) {
        tasksPageInfo.textContent = `Pagina ${currentPage}/${totalPages} (${filteredRows.length} resultados)`;
      }
      if (tasksPrevPageBtn) tasksPrevPageBtn.disabled = currentPage <= 1;
      if (tasksNextPageBtn) tasksNextPageBtn.disabled = currentPage >= totalPages;
    }

    function renderRows() {
      const start = (currentPage - 1) * pageSize;
      const end = start + pageSize;
      const visibleSet = new Set(filteredRows.slice(start, end));
      rows.forEach((row) => {
        row.style.display = visibleSet.has(row) ? "" : "none";
      });
      renderPager();
    }

    function applyFilter() {
      const term = String((tasksTableSearch && tasksTableSearch.value) || "")
        .toLowerCase()
        .trim();
      if (!term) {
        filteredRows = rows.slice();
      } else {
        filteredRows = rows.filter((row) =>
          String(row.textContent || "").toLowerCase().includes(term)
        );
      }
      currentPage = 1;
      renderRows();
    }

    function renderColumnToggles() {
      if (!tasksTableColumns) return;
      tasksTableColumns.innerHTML = "";
      columns.forEach((col) => {
        const id = `col_toggle_${col.key}`;
        const label = document.createElement("label");
        label.className = "col-toggle-item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = id;
        checkbox.checked = visibleColumns.has(col.key);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            visibleColumns.add(col.key);
          } else {
            visibleColumns.delete(col.key);
            if (visibleColumns.size === 0) {
              visibleColumns.add("acciones");
            }
          }
          persistColumns();
          applyColumnVisibility();
          renderColumnToggles();
        });
        const text = document.createElement("span");
        text.textContent = col.label;
        label.appendChild(checkbox);
        label.appendChild(text);
        tasksTableColumns.appendChild(label);
      });
    }

    if (tasksTableSearch) {
      tasksTableSearch.addEventListener("input", applyFilter);
    }
    if (tasksPrevPageBtn) {
      tasksPrevPageBtn.addEventListener("click", () => {
        if (currentPage <= 1) return;
        currentPage -= 1;
        renderRows();
      });
    }
    if (tasksNextPageBtn) {
      tasksNextPageBtn.addEventListener("click", () => {
        const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
        if (currentPage >= totalPages) return;
        currentPage += 1;
        renderRows();
      });
    }

    applyColumnVisibility();
    renderColumnToggles();
    applyFilter();
  }

  function setCreateMode() {
    taskForm.reset();
    taskIdInput.value = "";
    taskFormTitle.textContent = "Nueva tarea";
    saveTaskBtn.textContent = "Guardar tarea";
    cancelTaskEditBtn.classList.add("hidden");
    taskMsg.textContent = "";
    if (taskScheduleTimezoneInput) {
      taskScheduleTimezoneInput.value = "America/Argentina/Buenos_Aires";
    }
    if (taskScheduleTimeInput) {
      taskScheduleTimeInput.value = "09:00";
    }
    if (taskScheduleEnabledInput) {
      taskScheduleEnabledInput.checked = false;
    }
    taskScheduleDayInputs.forEach((checkbox) => {
      checkbox.checked = false;
    });
    setScheduleFieldsState();
  }

  function setEditMode(task) {
    taskIdInput.value = task.id;
    taskAgentIdInput.value = task.agentId;
    taskPromptTemplateInput.value = task.taskPromptTemplate;
    taskInputField.value = task.taskInput;
    taskIntegrationIdInput.value = task.integrationId || "";
    taskScheduleEnabledInput.checked = Boolean(task.scheduleEnabled);
    taskScheduleTimeInput.value = task.scheduleTime || "09:00";
    taskScheduleTimezoneInput.value =
      task.scheduleTimezone || "America/Argentina/Buenos_Aires";
    const selectedDays = new Set(
      String(task.scheduleDays || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    );
    taskScheduleDayInputs.forEach((checkbox) => {
      checkbox.checked = selectedDays.has(String(checkbox.value));
    });
    taskResponseContactIdInput.value = task.responseContactId || "";
    taskFileIdInput.value = task.fileId || "";
    setScheduleFieldsState();
    taskFormTitle.textContent = "Editar tarea";
    saveTaskBtn.textContent = "Guardar cambios";
    cancelTaskEditBtn.classList.remove("hidden");
    taskMsg.textContent = `Editando tarea: ${task.id}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelTaskEditBtn.addEventListener("click", setCreateMode);
  if (taskScheduleEnabledInput) {
    taskScheduleEnabledInput.addEventListener("change", () => {
      setScheduleFieldsState();
    });
  }

  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    taskMsg.textContent = "Guardando tarea...";

    const formData = new FormData(taskForm);
    const taskId = formData.get("taskId");
    const payload = {
      agentId: formData.get("agentId"),
      taskPromptTemplate: formData.get("taskPromptTemplate"),
      taskInput: formData.get("taskInput"),
      integrationId: formData.get("integrationId"),
      scheduleEnabled: Boolean(formData.get("scheduleEnabled")),
      scheduleDays: formData.getAll("scheduleDays"),
      scheduleTime: formData.get("scheduleTime"),
      scheduleTimezone: formData.get("scheduleTimezone"),
      responseContactId: formData.get("responseContactId"),
      fileId: formData.get("fileId"),
    };

    try {
      const isEdit = Boolean(taskId);
      const url = isEdit ? `/api/tasks/${taskId}` : "/api/tasks";
      const method = isEdit ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo guardar la tarea.");
      }
      taskMsg.textContent = isEdit ? "Tarea actualizada." : "Tarea guardada.";
      setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      taskMsg.textContent = error.message;
    }
  });

  function closeModal() {
    promptModal.classList.add("hidden");
    promptOutput.textContent = "";
  }

  closeModalBtn.addEventListener("click", closeModal);
  promptModal.addEventListener("click", (event) => {
    if (event.target === promptModal) closeModal();
  });

  promptButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      promptOutput.textContent = "Cargando...";
      promptModal.classList.remove("hidden");
      try {
        const response = await fetch(`/api/tasks/${button.dataset.taskId}/prompt`);
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo obtener el prompt.");
        }
        promptOutput.textContent = data.mergedPrompt || "(sin contenido)";
      } catch (error) {
        promptOutput.textContent = error.message;
      }
    });
  });

  function closeLogModal() {
    taskLogModal.classList.add("hidden");
    taskLogOutput.textContent = "";
    currentLogTaskId = "";
  }

  closeTaskLogModalBtn.addEventListener("click", closeLogModal);
  taskLogModal.addEventListener("click", (event) => {
    if (event.target === taskLogModal) closeLogModal();
  });

  function renderTaskLogs(task) {
    function formatLogDate(value) {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat("es-AR", {
        timeZone: logsTimeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(date);
    }

    const lines = [];
    lines.push(`Task ID: ${task.id}`);
    lines.push(`Estado: ${task.status}`);
    if (task.executionError) lines.push(`Error: ${task.executionError}`);
    if (task.executionResult) lines.push(`Resultado: ${task.executionResult}`);
    lines.push("");
    lines.push("Pasos:");

    const logs = Array.isArray(task.executionLogs) ? task.executionLogs : [];
    if (logs.length === 0) {
      lines.push("- Sin logs registrados.");
    } else {
      logs.forEach((log, idx) => {
        const atFormatted = formatLogDate(log.at);
        lines.push(
          `${idx + 1}. [${atFormatted}] step=${log.step} status=${log.status} msg=${log.message}`
        );
        if (log.data) {
          lines.push(`   data=${JSON.stringify(log.data)}`);
        }
      });
    }

    const actions = Array.isArray(task.executedActions) ? task.executedActions : [];
    lines.push("");
    lines.push(`Acciones ejecutadas: ${actions.length}`);
    actions.forEach((action, idx) => {
      lines.push(`${idx + 1}. ${JSON.stringify(action)}`);
    });
    return lines.join("\n");
  }

  async function loadTaskLog(taskId) {
    const response = await fetch(`/api/tasks/${taskId}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "No se pudo obtener detalle de tarea.");
    }
    taskLogOutput.textContent = renderTaskLogs(data.task);
  }

  logButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      currentLogTaskId = button.dataset.taskId;
      taskLogOutput.textContent = "Cargando log...";
      taskLogModal.classList.remove("hidden");
      try {
        await loadTaskLog(currentLogTaskId);
      } catch (error) {
        taskLogOutput.textContent = error.message;
      }
    });
  });

  if (clearTaskLogsBtn) {
    clearTaskLogsBtn.addEventListener("click", async () => {
      if (!currentLogTaskId) return;
      const confirmed = window.confirm(
        "Se borraran los logs y resultados de ejecucion de esta tarea. Continuar?"
      );
      if (!confirmed) return;

      try {
        clearTaskLogsBtn.disabled = true;
        const response = await fetch(`/api/tasks/${currentLogTaskId}/logs/clear`, {
          method: "POST",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudieron limpiar los logs.");
        }
        taskMsg.textContent = "Logs de tarea limpiados.";
        await loadTaskLog(currentLogTaskId);
        setTimeout(() => window.location.reload(), 400);
      } catch (error) {
        taskMsg.textContent = error.message;
      } finally {
        clearTaskLogsBtn.disabled = false;
      }
    });
  }

  editButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest("tr");
      const templateSource = row ? row.querySelector(".task-template-source") : null;
      const inputSource = row ? row.querySelector(".task-input-source") : null;
      setEditMode({
        id: button.dataset.id,
        agentId: button.dataset.agentId,
        fileId: button.dataset.fileId || "",
        integrationId: button.dataset.integrationId || "",
        responseContactId: button.dataset.responseContactId || "",
        scheduleEnabled: button.dataset.scheduleEnabled === "true",
        scheduleDays: button.dataset.scheduleDays || "",
        scheduleTime: button.dataset.scheduleTime || "09:00",
        scheduleTimezone:
          button.dataset.scheduleTimezone || "America/Argentina/Buenos_Aires",
        taskPromptTemplate: templateSource ? templateSource.value : "",
        taskInput: inputSource ? inputSource.value : "",
      });
    });
  });

  deleteButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Se eliminara la tarea. Esta accion no se puede deshacer."
      );
      if (!confirmed) return;

      try {
        const response = await fetch(`/api/tasks/${button.dataset.id}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo eliminar la tarea.");
        }
        window.location.reload();
      } catch (error) {
        taskMsg.textContent = error.message;
      }
    });
  });

  queueButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const response = await fetch(`/api/tasks/${button.dataset.id}/queue`, {
          method: "POST",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo pasar a queued.");
        }
        taskMsg.textContent = "Tarea encolada (queued).";
        setTimeout(() => window.location.reload(), 350);
      } catch (error) {
        taskMsg.textContent = error.message;
      }
    });
  });

  executeButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Se ejecutara la tarea manualmente usando el modelo del agente. Continuar?"
      );
      if (!confirmed) return;

      try {
        const response = await fetch(`/api/tasks/${button.dataset.id}/execute`, {
          method: "POST",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "No se pudo ejecutar la tarea.");
        }
        taskMsg.textContent = "Tarea ejecutada correctamente.";
        setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        taskMsg.textContent = error.message;
      }
    });
  });

  async function refreshFiles(selectFileId) {
    const response = await fetch("/api/files");
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "No se pudo cargar archivos.");
    }

    taskFileIdInput.innerHTML = '<option value="">Sin archivo</option>';
    (data.files || []).forEach((file) => {
      const option = document.createElement("option");
      option.value = file.id;
      option.textContent = `${file.originalName} (${file.relativePath})`;
      taskFileIdInput.appendChild(option);
    });
    if (selectFileId) taskFileIdInput.value = selectFileId;
  }

  uploadTaskFileBtn.addEventListener("click", async () => {
    const file = taskUploadFileInput.files && taskUploadFileInput.files[0];
    if (!file) {
      taskMsg.textContent = "Selecciona un archivo para subir.";
      return;
    }

    taskMsg.textContent = "Subiendo archivo...";
    uploadTaskFileBtn.disabled = true;

    try {
      const contentBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
        reader.readAsDataURL(file);
      });

      const response = await fetch("/api/files/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          mimeType: file.type,
          contentBase64,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo subir el archivo.");
      }

      await refreshFiles(data.file.id);
      taskUploadFileInput.value = "";
      taskMsg.textContent = `Archivo subido: ${data.file.originalName}`;
    } catch (error) {
      taskMsg.textContent = error.message;
    } finally {
      uploadTaskFileBtn.disabled = false;
    }
  });

  initSchedulePanel();
  setScheduleFieldsState();
  initTasksDataTable();
})();
