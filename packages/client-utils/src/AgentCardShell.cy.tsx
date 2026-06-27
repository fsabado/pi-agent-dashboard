import React from "react";
import { AgentCardShell } from "./AgentCardShell.js";

describe("AgentCardShell", () => {
  it("renders name", () => {
    cy.mountWithProviders(<AgentCardShell name="Explore" status="complete" />);
    cy.get('[data-testid="agent-card-name"]').should("have.text", "Explore");
  });

  it("renders children", () => {
    cy.mountWithProviders(
      <AgentCardShell name="Explore" status="complete">
        <span data-testid="child">child content</span>
      </AgentCardShell>,
    );
    cy.get('[data-testid="child"]').should("exist");
  });

  it("calls onClick when clicked", () => {
    const onClick = cy.stub().as("onClick");
    cy.mountWithProviders(
      <AgentCardShell name="Explore" status="complete" onClick={onClick} />,
    );
    cy.get('[data-testid="agent-card-shell"]').click();
    cy.get("@onClick").should("have.been.calledOnce");
  });

  it("applies selected styling", () => {
    cy.mountWithProviders(
      <AgentCardShell name="Explore" status="complete" selected />,
    );
    cy.get('[data-testid="agent-card-shell"]').should(
      "have.class",
      "border-blue-500/60",
    );
  });

  for (const status of ["running", "error", "complete"] as const) {
    it(`renders status icon for: ${status}`, () => {
      cy.mountWithProviders(<AgentCardShell name="Agent" status={status} />);
      cy.get('[data-testid="agent-card-status-icon"]').should("exist");
    });
  }
});
