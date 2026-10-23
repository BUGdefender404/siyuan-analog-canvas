import { Dialog } from "siyuan";

export interface PromptOptions {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  validate?: (value: string) => string | null;
  isMobile?: boolean;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isMobile?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string | null) => {
      if (settled) return false;
      settled = true;
      resolve(value);
      return true;
    };
    const finish = (value: string | null) => {
      if (settle(value)) dialog.destroy();
    };
    const dialog = new Dialog({
      title: options.title,
      content: `<div class="b3-dialog__content ac-dialog">
  <label class="ac-dialog__label">${escapeHtml(options.label ?? options.title)}</label>
  <input class="b3-text-field fn__block" type="text" value="${escapeHtml(options.value ?? "")}" placeholder="${escapeHtml(options.placeholder ?? "")}" />
  <div class="ac-dialog__error" role="alert"></div>
  <div class="ac-dialog__actions">
    <button class="b3-button b3-button--cancel">${escapeHtml(options.cancelText ?? "Cancel")}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text">${escapeHtml(options.confirmText ?? "OK")}</button>
  </div>
</div>`,
      width: options.isMobile ? "92vw" : "440px",
      destroyCallback: () => settle(null),
    });
    const content = dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
    const input = content.querySelector("input") as HTMLInputElement;
    const error = content.querySelector(".ac-dialog__error") as HTMLElement;
    const confirm = () => {
      const value = input.value.trim();
      const problem = options.validate?.(value);
      if (problem) {
        error.textContent = problem;
        input.focus();
        return;
      }
      finish(value);
    };
    content.querySelector(".b3-button--text")?.addEventListener("click", confirm);
    content.querySelector(".b3-button--cancel")?.addEventListener("click", () => finish(null));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirm();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
    });
  });
}

export interface CloseGuardOptions {
  title: string;
  message: string;
  saveText: string;
  discardText: string;
  cancelText: string;
  isMobile?: boolean;
}

export type CloseGuardChoice = "save" | "discard" | "cancel";

export function closeGuardDialog(options: CloseGuardOptions): Promise<CloseGuardChoice> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: CloseGuardChoice) => {
      if (settled) return false;
      settled = true;
      resolve(value);
      return true;
    };
    const finish = (value: CloseGuardChoice) => {
      if (settle(value)) dialog.destroy();
    };
    const dialog = new Dialog({
      title: options.title,
      content: `<div class="b3-dialog__content ac-dialog">
  <div class="ac-dialog__message">${escapeHtml(options.message)}</div>
  <div class="ac-dialog__actions">
    <button class="b3-button b3-button--cancel">${escapeHtml(options.cancelText)}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--outline ac-dialog__discard">${escapeHtml(options.discardText)}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text">${escapeHtml(options.saveText)}</button>
  </div>
</div>`,
      width: options.isMobile ? "92vw" : "460px",
      destroyCallback: () => settle("cancel"),
    });
    const content = dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
    content.querySelector(".b3-button--text")?.addEventListener("click", () => finish("save"));
    content.querySelector(".ac-dialog__discard")?.addEventListener("click", () => finish("discard"));
    content.querySelector(".b3-button--cancel")?.addEventListener("click", () => finish("cancel"));
    setTimeout(() => {
      (content.querySelector(".b3-button--text") as HTMLButtonElement | null)?.focus();
    });
  });
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return false;
      settled = true;
      resolve(value);
      return true;
    };
    const finish = (value: boolean) => {
      if (settle(value)) dialog.destroy();
    };
    const dialog = new Dialog({
      title: options.title,
      content: `<div class="b3-dialog__content ac-dialog">
  <div class="ac-dialog__message">${escapeHtml(options.message)}</div>
  <div class="ac-dialog__actions">
    <button class="b3-button b3-button--cancel">${escapeHtml(options.cancelText ?? "Cancel")}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text">${escapeHtml(options.confirmText ?? "OK")}</button>
  </div>
</div>`,
      width: options.isMobile ? "92vw" : "440px",
      destroyCallback: () => settle(false),
    });
    const content = dialog.element.querySelector(".b3-dialog__content") as HTMLElement;
    content.querySelector(".b3-button--text")?.addEventListener("click", () => finish(true));
    content.querySelector(".b3-button--cancel")?.addEventListener("click", () => finish(false));
    setTimeout(() => {
      (content.querySelector(".b3-button--text") as HTMLButtonElement | null)?.focus();
    });
  });
}
