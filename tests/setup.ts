import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { __resetMockStore } from "./__mocks__/$/index.js";

afterEach(() => {
  __resetMockStore();
  document.body.replaceChildren();
  document.getElementById("ocvd-page-style")?.remove();
  for (const node of document.querySelectorAll("[data-ocvd-ui]")) {
    node.remove();
  }
});
