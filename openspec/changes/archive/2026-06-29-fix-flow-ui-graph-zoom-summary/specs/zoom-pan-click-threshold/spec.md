## ADDED Requirements

### Requirement: Click-vs-drag disambiguation by movement threshold

The shared `useZoomPan` hook SHALL distinguish a click from a pan using a movement threshold so that a press-and-release with negligible movement is delivered as a `click` to the element under the pointer, while a press-and-drag pans. On `pointerdown` (primary button only) the hook SHALL record the start point and SHALL NOT call `setPointerCapture`. The hook SHALL enter the dragging state — calling `setPointerCapture` and beginning translation — only on a subsequent `pointermove` whose total displacement from the start point exceeds a fixed threshold (~4 CSS px). A `pointerup` that occurs before the threshold is crossed SHALL leave capture untaken, so the browser-synthesized `click` reaches the original target.

Deferring capture is the mechanism: capturing on `pointerdown` retargets the `pointerup` (and thus the `click`) to the capturing element, which is why eager capture suppresses child `onClick` handlers.

#### Scenario: Tap below threshold is a click
- **WHEN** the pointer is pressed and released over a child element with displacement at or below the threshold
- **THEN** the hook SHALL NOT call `setPointerCapture`, SHALL NOT translate, and the child element's `click` handler SHALL fire

#### Scenario: Drag beyond threshold pans
- **WHEN** the pointer is pressed and moved beyond the threshold before release
- **THEN** the hook SHALL call `setPointerCapture` once at the crossing and SHALL translate the content following the pointer

#### Scenario: Movement between zero and threshold does not pan
- **WHEN** the pointer is pressed and moved a distance greater than zero but not exceeding the threshold
- **THEN** the hook SHALL NOT capture and SHALL NOT translate

### Requirement: Flow graph node selection and overlay buttons work without capture hacks

With the click-vs-drag threshold in place, the live `FlowGraph` SHALL deliver node clicks to the node's `onClick` (graph⇄card selection) and SHALL deliver clicks to its overlay controls (Expand, error-routes toggle, zoom controls) WITHOUT per-element `onPointerDown → stopPropagation` workarounds on those controls. A pan MAY be initiated by dragging anywhere on the graph surface, including over a node. The zoom-control cluster MAY retain its own internal `stopPropagation` so dragging on the zoom buttons does not start a pan.

#### Scenario: Clicking a node selects it
- **WHEN** the user clicks (no drag) on a flow-graph node that has an `onSelectStep` handler
- **THEN** the node's selection handler SHALL fire and the node SHALL render as selected

#### Scenario: Clicking an overlay button activates it
- **WHEN** the user clicks the Expand or error-routes overlay button
- **THEN** the button's `onClick` SHALL fire, with no `onPointerDown → stopPropagation` guard on the button

#### Scenario: Dragging over a node pans
- **WHEN** the user presses on a node and drags beyond the threshold
- **THEN** the graph SHALL pan and the node SHALL NOT be selected (the gesture is a drag, not a click)
