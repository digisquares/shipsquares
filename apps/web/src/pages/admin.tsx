import { useEffect } from "react";

import { Page } from "../components/page";
import { UpdatesCard } from "../components/updates";
import { pageTitle } from "../lib/page-title";

import { AiSettingsCard, ApiKeysCard, MembersCard, VcsConnectionsCard } from "./settings";

// Org admin (docs/web-ui/01, §5): governance lives in one role-gated area with a
// left sub-nav instead of the old single settings scroll. Each section reuses the
// existing card component; the active section comes from #/admin/<section>.
const SECTIONS = [
  { key: "members", label: "Members & roles", render: () => <MembersCard /> },
  { key: "api-keys", label: "API keys", render: () => <ApiKeysCard /> },
  { key: "connections", label: "Git connections", render: () => <VcsConnectionsCard /> },
  { key: "ai", label: "AI assistant", render: () => <AiSettingsCard /> },
  { key: "updates", label: "Updates", render: () => <UpdatesCard /> },
] as const;

export function Admin({ section }: { section: string }) {
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];

  useEffect(() => {
    document.title = pageTitle("Admin");
  }, []);

  return (
    <Page
      crumbs={[{ label: "Dashboard", href: "#/" }, { label: "Admin" }]}
      title="Admin"
      subtitle="Organization governance — members, keys, connections, AI and updates."
    >
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Admin sections">
          {SECTIONS.map((s) => (
            <a
              key={s.key}
              className={`admin-nav-item${s.key === active.key ? " active" : ""}`}
              href={`#/admin/${s.key}`}
              aria-current={s.key === active.key ? "page" : undefined}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <div className="admin-panel">{active.render()}</div>
      </div>
    </Page>
  );
}
