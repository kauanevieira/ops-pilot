import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_API_URL } from "../api/url.ts";
import { SettingsDialog } from "./SettingsDialog.tsx";
import type { ApiUrlSetting } from "./api-url-store.ts";

function open(setting: Partial<ApiUrlSetting> = {}) {
  const handlers = { onSave: vi.fn(), onReset: vi.fn(), onCancel: vi.fn() };
  render(
    <SettingsDialog
      setting={{ url: DEFAULT_API_URL, source: "default", persistent: true, ...setting }}
      {...handlers}
    />,
  );
  return handlers;
}

const field = () => screen.getByRole("textbox", { name: /url da api/i });

describe("SettingsDialog (US4)", () => {
  it("shows the URL in use", () => {
    open({ url: "http://localhost:3999", source: "saved" });
    expect(screen.getByRole("dialog", { name: "Configurações" })).toBeInTheDocument();
    expect(field()).toHaveValue("http://localhost:3999");
  });

  it("saves a valid URL, normalized", async () => {
    const { onSave } = open();
    await userEvent.clear(field());
    await userEvent.type(field(), "http://localhost:3999/");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledWith("http://localhost:3999");
  });

  it.each(["", "localhost:3000", "ftp://host", "texto qualquer"])("refuses %j with an inline message", async (bad) => {
    const { onSave } = open();
    await userEvent.clear(field());
    if (bad) await userEvent.type(field(), bad);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeInTheDocument();
  });

  it("Restore default and Cancel call their handlers", async () => {
    const { onReset, onCancel } = open({ url: "http://x:1", source: "saved" });
    await userEvent.click(screen.getByRole("button", { name: /restaurar padrão/i }));
    expect(onReset).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("Esc cancels", async () => {
    const { onCancel } = open();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("warns that the choice will not be remembered when storage is unavailable (FR-018)", () => {
    open({ persistent: false });
    expect(screen.getByText(/não será lembrada/i)).toBeInTheDocument();
  });

  it("does not warn when storage works", () => {
    open({ persistent: true });
    expect(screen.queryByText(/não será lembrada/i)).not.toBeInTheDocument();
  });
});
