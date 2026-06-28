import "./mount-with-providers.js";
import "../../packages/client/src/index.css";
import addContext from "mochawesome/addContext";

// Attach spec video to every test so mochawesome renders it in the report.
Cypress.on("test:after:run", (test, runnable) => {
  const videoPath = `videos/${Cypress.spec.relative}.mp4`;
  addContext({ test: runnable }, { title: "🎥 Recording", value: videoPath });
});

// Stub window.WebSocket globally — prevents real connection attempts
// in component context. Components under test receive WS state as props.
Cypress.on("window:before:load", (win) => {
  class StubWS extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = StubWS.OPEN;
    send() {}
    close() {}
  }
  // biome-ignore lint/suspicious/noExplicitAny: stub replaces browser WebSocket
  win.WebSocket = StubWS as any;
});
