import { test, expect } from "../fixtures/test";
import { seedSession } from "../utils/actions";

// MAIL scenarios (docs/testing/04). Mocked mode — the managed-email UI is mocked
// until the Stalwart catalog template bugs are fixed (project note / MCL-2/3).

test.describe("Mail", () => {
  test("MAIL-1 — Olivia connects an installed Stalwart server", async ({ appPage, state }) => {
    seedSession(state);
    state.catalogServices = [
      { id: "svc_sw", slug: "stalwart", name: "Stalwart", status: "running", error: null },
    ];
    state.servers = [{ id: "srv_1", name: "mail-1", host: "1.2.3.4" }];
    await appPage.goto("/#/mail");
    await expect(appPage.getByText("No mail server yet")).toBeVisible();

    await appPage.getByRole("button", { name: "Connect mail server" }).click();
    const modal = appPage.getByRole("dialog", { name: "Connect a mail server" });
    await expect(modal).toBeVisible();
    await modal.getByLabel("Mail hostname").fill("mail.acme.test");
    await modal.getByLabel("Admin secret").fill("admin-token");
    await modal.getByRole("button", { name: "Connect" }).click();

    await expect(appPage.getByText("Mail server connected")).toBeVisible();
    await expect(appPage.getByRole("heading", { name: "mail.acme.test" })).toBeVisible();
  });

  test("MAIL-2/3 — add a domain, then trigger DNS verification", async ({ appPage, state }) => {
    seedSession(state);
    state.mailInstances = [
      {
        id: "mi_1",
        hostname: "mail.acme.test",
        status: "running",
        port25Egress: "open",
        ptrOk: true,
      },
    ];
    await appPage.goto("/#/mail");
    await expect(appPage.getByRole("heading", { name: "mail.acme.test" })).toBeVisible();

    await appPage.getByLabel("New mail domain").fill("acme.test");
    await appPage.getByRole("button", { name: "Add domain" }).click();
    await expect(appPage.getByText("Domain added")).toBeVisible();
    await expect(appPage.getByText("acme.test", { exact: true })).toBeVisible();

    await appPage.getByRole("button", { name: "Verify" }).click();
    await expect(appPage.getByText("Re-checking DNS…")).toBeVisible();
  });

  test("MAIL-4 — creating a mailbox reveals a one-time password", async ({ appPage, state }) => {
    seedSession(state);
    state.mailInstances = [
      {
        id: "mi_1",
        hostname: "mail.acme.test",
        status: "running",
        port25Egress: "open",
        ptrOk: true,
      },
    ];
    state.mailDomains = {
      mi_1: [
        {
          id: "dom_1",
          fqdn: "acme.test",
          dkimSelector: "ss",
          dnsMode: "hint",
          verificationStatus: "verified",
          inboxSubdomain: "inbox.acme.test",
        },
      ],
    };
    await appPage.goto("/#/mail");
    await appPage.getByRole("button", { name: "Mailboxes" }).click();
    await appPage.getByLabel("New mailbox local part for acme.test").fill("alice");
    await appPage.getByRole("button", { name: "Add mailbox" }).click();

    const dialog = appPage.getByRole("dialog", { name: "Mailbox created" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("mailbox password")).toHaveText("Tmp-Pass-9x7Q-once");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect(appPage.getByText("alice@acme.test")).toBeVisible();
  });
});
