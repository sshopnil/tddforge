import React from "react";
import { render } from "@orchetron/storm";
import { TddforgeApp } from "./ui.js";

export function runTui(initialWorkspaceRoot: string): void {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    console.error("TDDForge TUI requires an interactive terminal. Run `tddforge doctor` or `tddforge plan --story <file>` in non-interactive environments.");
    process.exitCode = 1;
    return;
  }

  void render(<TddforgeApp initialWorkspaceRoot={initialWorkspaceRoot} />)
    .waitUntilExit()
    .then(() => {
      process.exit(0);
    });
}
