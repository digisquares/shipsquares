import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { relativeTime } from "../lib/time";
import { toast } from "../lib/toast";
import { useResource } from "../lib/use-resource";

import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { Field, TextInput } from "./form";
import { SkeletonRows } from "./skeleton";

// Scheduled jobs card (ROADMAP R1.5): the first web surface for /schedules —
// list this app's cron jobs, create one inline, run now, inspect the last
// run (status + clamped output tail), delete.

interface Schedule {
  id: string;
  name: string;
  target: string;
  appId: string | null;
  command: string;
  cron: string;
  enabled: boolean;
  createdAt: string;
}

interface ScheduleRun {
  id: string;
  status: string;
  exitCode: number | null;
  outputTail: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function SchedulesCard({ appId }: { appId: string }) {
  const { data, loading, error, reload } = useResource(() =>
    api.get<Schedule[]>("/api/v1/schedules"),
  );
  const schedules = data ? data.filter((s) => s.appId === appId) : null;
  const [lastRuns, setLastRuns] = useState<Record<string, ScheduleRun | undefined>>({});
  const [openTail, setOpenTail] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 3 * * *");
  const [command, setCommand] = useState("");
  const [creating, setCreating] = useState(false);

  // Last run per (this app's) schedule — fanned out when the list resolves.
  useEffect(() => {
    if (!data) return;
    const mine = data.filter((s) => s.appId === appId);
    let alive = true;
    void Promise.all(
      mine.map(async (s) => {
        const rr = await api.get<ScheduleRun[]>(`/api/v1/schedules/${s.id}/runs`);
        return [s.id, rr.ok ? rr.data[0] : undefined] as const;
      }),
    ).then((entries) => {
      if (alive) setLastRuns(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [data, appId]);

  async function create() {
    setCreating(true);
    const r = await api.post<Schedule>("/api/v1/schedules", {
      name: name.trim(),
      target: "app_container",
      appId,
      command: command.trim(),
      cron: cron.trim(),
    });
    setCreating(false);
    if (r.ok) {
      toast.success("Schedule created");
      setName("");
      setCommand("");
      reload();
    } else {
      toast.error(`Create failed (${r.status}) — check the cron expression`);
    }
  }

  async function runNow(s: Schedule) {
    const r = await api.post(`/api/v1/schedules/${s.id}/run`);
    if (r.ok) {
      toast.success(`Running "${s.name}" — refresh in a few seconds`);
      setTimeout(() => reload(), 4000);
    } else {
      toast.error(`Run failed (${r.status})`);
    }
  }

  async function remove(s: Schedule) {
    const ok = await confirm({
      title: "Delete schedule?",
      message: `"${s.name}" stops running (${s.cron}).`,
      danger: true,
    });
    if (!ok) return;
    const r = await api.del(`/api/v1/schedules/${s.id}`);
    if (r.ok) {
      toast.success("Schedule deleted");
      reload();
    } else {
      toast.error(`Delete failed (${r.status})`);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Scheduled jobs</h2>
      </div>
      <p className="muted">
        Cron commands run inside the app&apos;s container (pg-boss cron; output tail kept per run).
      </p>

      <div className="form-row">
        <Field label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="nightly-cleanup"
            maxLength={80}
          />
        </Field>
        <Field label="Cron (5-field, UTC)">
          <TextInput
            className="mono"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 3 * * *"
          />
        </Field>
        <Field label="Command">
          <TextInput
            className="mono"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="node scripts/cleanup.js"
            maxLength={4096}
          />
        </Field>
        <div className="card-actions key-create-action">
          <button
            className="btn btn-primary btn-sm"
            disabled={creating || !name.trim() || !command.trim() || !cron.trim()}
            onClick={() => void create()}
          >
            {creating ? "Creating…" : "Add schedule"}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <SkeletonRows count={2} />
      ) : error ? (
        <ErrorState title="Couldn't load schedules" message={error} onRetry={reload} />
      ) : schedules && schedules.length > 0 ? (
        <ul className="app-list">
          {schedules.map((s) => {
            const run = lastRuns[s.id];
            return (
              <li key={s.id} className="sched-row">
                <div className="app-row">
                  <span className="app-name">{s.name}</span>
                  <span className="app-id muted mono">{s.cron}</span>
                  <span className="app-id muted mono">
                    {run
                      ? `${run.status}${run.exitCode !== null ? ` (exit ${run.exitCode})` : ""} · ${relativeTime(run.startedAt)}`
                      : "never ran"}
                  </span>
                  <span className="card-actions">
                    {run?.outputTail && (
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-expanded={openTail === s.id}
                        onClick={() => setOpenTail(openTail === s.id ? null : s.id)}
                      >
                        {openTail === s.id ? "Hide output" : "Output"}
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => void runNow(s)}>
                      Run now
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => void remove(s)}
                    >
                      Delete
                    </button>
                  </span>
                </div>
                {openTail === s.id && run?.outputTail && (
                  <pre className="sched-tail mono">{run.outputTail}</pre>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No schedules" description="Add a cron command above." />
      )}
    </section>
  );
}
