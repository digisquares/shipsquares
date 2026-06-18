// Golden eval dataset for assistant selection (ai-assistant-roadmap.md). Version-
// controlled prompts with the expected DETERMINISTIC outcomes — which help doc
// search_docs should surface, which guided_template a request maps to, and which
// category carries the tool an intent needs. evals.test.ts grades these in CI (no
// API key needed) so a tweak to a tool description, category, trigger, or doc that
// breaks selection is caught. The live Haiku picker is graded by the key-gated
// block in evals.test.ts.

export interface EvalCase {
  prompt: string;
  /** search_docs should rank this help-doc slug first. */
  expectDoc?: string;
  /** suggestGuide should return this guide id (null-expecting cases omit it). */
  expectGuide?: string;
  /** The category that must carry expectTool (intent → tool placement). */
  expectCategory?: string;
  /** A tool the request needs, expected to live in expectCategory. */
  expectTool?: string;
}

export const EVAL_CASES: EvalCase[] = [
  {
    prompt: "how do I set up point-in-time recovery?",
    expectDoc: "backups-and-pitr",
  },
  {
    prompt: "deploy nginx from docker hub",
    expectDoc: "deploy-from-docker-hub",
    expectGuide: "docker-hub-app",
    expectCategory: "apps",
    expectTool: "create_app",
  },
  {
    prompt: "deploy my code from github",
    expectDoc: "deploy-from-git",
    expectGuide: "git-repo-app",
    expectCategory: "apps",
    expectTool: "deploy_app",
  },
  {
    prompt: "set up plausible analytics",
    expectDoc: "catalog-apps",
    expectGuide: "catalog-app",
    expectCategory: "catalog",
    expectTool: "install_catalog",
  },
  {
    prompt: "add a managed postgres database",
    expectDoc: "managed-databases",
    expectGuide: "managed-postgres",
    expectCategory: "databases",
    expectTool: "create_database",
  },
  {
    prompt: "how does https work for a custom domain",
    expectDoc: "custom-domains-tls",
    expectCategory: "apps",
    expectTool: "add_domain",
  },
  {
    prompt: "how do I add a server to my fleet",
    expectDoc: "adding-servers",
    expectCategory: "servers",
    expectTool: "add_server",
  },
  {
    prompt: "what are PR preview environments",
    expectDoc: "pr-previews",
  },
  {
    prompt: "how do I host email on my own domain",
    expectDoc: "managed-email",
    expectCategory: "email",
    expectTool: "create_mailbox",
  },
  {
    prompt: "create a scheduled cron job",
    expectDoc: "scheduled-jobs",
    expectCategory: "jobs",
    expectTool: "create_schedule",
  },
  {
    prompt: "what can the assistant do for me",
    expectDoc: "ai-assistant",
  },
];
