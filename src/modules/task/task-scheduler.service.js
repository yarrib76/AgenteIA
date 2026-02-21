const tasksService = require("./tasks.service");

function buildTaskSchedulerService() {
  const pollMs = Number.parseInt(process.env.SCHEDULER_POLL_MS || "30000", 10);
  let timer = null;
  let tickRunning = false;
  const locks = new Set();

  async function tick() {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const dueTasks = await tasksService.listDueScheduledTasks(new Date());
      for (const task of dueTasks) {
        if (!task || !task.id) continue;
        if (locks.has(task.id)) continue;
        locks.add(task.id);
        try {
          await tasksService.runScheduledTask(task.id, new Date());
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Scheduler task error (${task.id}):`, error.message);
        } finally {
          locks.delete(task.id);
        }
      }
    } finally {
      tickRunning = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      tick().catch((error) => {
        // eslint-disable-next-line no-console
        console.error("Scheduler tick error:", error.message);
      });
    }, Number.isFinite(pollMs) && pollMs > 1000 ? pollMs : 30000);
    tick().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Scheduler initial tick error:", error.message);
    });
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
  };
}

module.exports = buildTaskSchedulerService;
