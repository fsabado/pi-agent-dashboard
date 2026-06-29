import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarState } from "../../hooks/useSidebarState.js";
import { ResizableSidebar } from "../ResizableSidebar.js";

afterEach(() => cleanup());

function makeSidebar(overrides: Partial<SidebarState> = {}): SidebarState {
  return {
    width: 256,
    collapsed: false,
    setWidth: vi.fn(),
    toggleCollapse: vi.fn(),
    ...overrides,
  };
}

describe("ResizableSidebar", () => {
  it("renders children when expanded", () => {
    render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div data-testid="child">Hello</div>
      </ResizableSidebar>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("renders at specified width", () => {
    const { container } = render(
      <ResizableSidebar sidebar={makeSidebar({ width: 350 })}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    // The outer div should have width style
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper?.style.width).toBe("350px");
  });

  it("shows collapsed strip with expand button when collapsed", () => {
    render(
      <ResizableSidebar sidebar={makeSidebar({ collapsed: true })}>
        <div data-testid="child">Hidden</div>
      </ResizableSidebar>,
    );
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByTestId("sidebar-expand")).toBeTruthy();
  });

  it("calls toggleCollapse when collapse button clicked", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    fireEvent.click(screen.getByTestId("sidebar-collapse"));
    expect(sidebar.toggleCollapse).toHaveBeenCalledOnce();
  });

  it("calls toggleCollapse when expand button clicked", () => {
    const sidebar = makeSidebar({ collapsed: true });
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    fireEvent.click(screen.getByTestId("sidebar-expand"));
    expect(sidebar.toggleCollapse).toHaveBeenCalledOnce();
  });

  it("floats the collapse/expand affordance above sticky content (z-30)", () => {
    // The toggle overhangs into the content area where a sticky slot (z-10)
    // would otherwise occlude it. See change: improve-flow-graph-fidelity.
    const { rerender } = render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    expect(screen.getByTestId("sidebar-collapse").className).toMatch(/z-30/);
    rerender(
      <ResizableSidebar sidebar={makeSidebar({ collapsed: true })}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    expect(screen.getByTestId("sidebar-expand").className).toMatch(/z-30/);
  });

  it("calls setWidth on drag end", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    const handle = screen.getByTestId("drag-handle");
    fireEvent.mouseDown(handle);
    fireEvent.mouseUp(document, { clientX: 400 });
    expect(sidebar.setWidth).toHaveBeenCalledWith(400);
  });

  it("collapse button does not trigger drag", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    // Clicking the collapse button should not start a drag
    fireEvent.mouseDown(screen.getByTestId("sidebar-collapse"));
    fireEvent.mouseUp(document, { clientX: 400 });
    expect(sidebar.setWidth).not.toHaveBeenCalled();
  });

  it("renders drag handle", () => {
    render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    expect(screen.getByTestId("drag-handle")).toBeTruthy();
  });
});
