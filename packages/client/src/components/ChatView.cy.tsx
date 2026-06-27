import React from "react";
import { ChatView } from "./ChatView.js";
import { createInitialState } from "../lib/event-reducer.js";
import type { ToolContext } from "./tool-renderers/types.js";

const toolContext: ToolContext = { cwd: "/tmp", editors: [] };
const emptyState = createInitialState();

describe("ChatView", () => {
  it("renders chat-view container", () => {
    cy.mountWithProviders(
      <ChatView state={emptyState} toolContext={toolContext} />,
    );
    cy.get('[data-testid="chat-view"]').should("exist");
  });

  it("renders message list container", () => {
    cy.mountWithProviders(
      <ChatView state={emptyState} toolContext={toolContext} />,
    );
    cy.get('[data-testid="chat-message-list"]').should("exist");
  });

  it("does not show scroll-to-bottom button on empty state", () => {
    cy.mountWithProviders(
      <ChatView state={emptyState} toolContext={toolContext} />,
    );
    cy.get('[data-testid="scroll-to-bottom"]').should("not.exist");
  });
});
