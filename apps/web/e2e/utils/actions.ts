import { expect, type Locator, type Page } from "@playwright/test";

import { type MockState, ownerUser, type Role } from "../fixtures/mock-api";

// Reusable user actions + disambiguated locators. Keeping these here means a
// markup tweak (e.g. a second button with the same label) is fixed once.

/** Seed a logged-in session of the given role before navigating. */
export function seedSession(state: MockState, role: Role = "owner"): void {
  state.session = { ...ownerUser, role };
}

/** Sign in through the real login form (mock accepts the default password). */
export async function signIn(page: Page, email = "owner@local.test"): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

/** The "New app" toggle in the Apps card header (NOT the empty-state CTA). */
export function newAppButton(page: Page): Locator {
  return page
    .locator(".card", { has: page.getByRole("heading", { name: "Apps" }) })
    .locator(".card-head")
    .getByRole("button", { name: "New app" });
}

/** Open the New-app form and return the name input. */
export async function openNewAppForm(page: Page): Promise<Locator> {
  await newAppButton(page).click();
  const nameInput = page.getByLabel("App name");
  await expect(nameInput).toBeVisible();
  return nameInput;
}
