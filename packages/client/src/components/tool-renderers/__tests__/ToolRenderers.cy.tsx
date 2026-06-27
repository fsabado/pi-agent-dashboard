import React from "react";
import { BashToolRenderer } from "../BashToolRenderer.js";
import { ReadToolRenderer } from "../ReadToolRenderer.js";
import { WriteToolRenderer } from "../WriteToolRenderer.js";
import type { ToolRendererProps } from "../types.js";

const context: ToolRendererProps["context"] = { cwd: "/tmp", editors: [] };

const base: Omit<ToolRendererProps, "args" | "result"> = {
  toolName: "test",
  status: "complete",
  context,
};

describe("BashToolRenderer", () => {
  it("renders command", () => {
    cy.mountWithProviders(
      <BashToolRenderer {...base} args={{ command: "ls -la" }} result="total 0" />,
    );
    cy.get('[data-testid="bash-tool-renderer"]').should("exist");
    cy.contains("ls -la").should("exist");
  });

  it("renders output", () => {
    cy.mountWithProviders(
      <BashToolRenderer {...base} args={{ command: "echo hi" }} result="hi" />,
    );
    cy.get('[data-testid="bash-output"]').should("contain.text", "hi");
  });

  it("shows running state when no result", () => {
    cy.mountWithProviders(
      <BashToolRenderer {...base} status="running" args={{ command: "sleep 10" }} />,
    );
    cy.contains("Running").should("exist");
  });
});

describe("ReadToolRenderer", () => {
  it("renders filename", () => {
    cy.mountWithProviders(
      <ReadToolRenderer {...base} args={{ path: "/src/foo.ts" }} result="const x = 1;" />,
    );
    cy.get('[data-testid="read-tool-renderer"]').should("exist");
    cy.contains("foo.ts").should("exist");
  });
});

describe("WriteToolRenderer", () => {
  it("renders filename", () => {
    cy.mountWithProviders(
      <WriteToolRenderer {...base} args={{ path: "/src/bar.ts", content: "export const x = 1;" }} />,
    );
    cy.get('[data-testid="write-tool-renderer"]').should("exist");
    cy.contains("bar.ts").should("exist");
  });
});
