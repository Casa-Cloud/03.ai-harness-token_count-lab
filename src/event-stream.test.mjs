import test from "node:test";
import assert from "node:assert/strict";
import { readEvents } from "./event-stream.mjs";

for (const newline of ["\n", "\r\n"]) {
  test(`parses streamed events with ${JSON.stringify(newline)} delimiters`, async () => {
    const expected = [
      { type: "run_started", goal: "Explain → calculate" },
      { type: "completed", answer: "First line\nSecond line: 72" },
      { type: "error", message: "Provider unavailable" }
    ];
    const bytes = new TextEncoder().encode(expected.map((event) => `data: ${JSON.stringify(event)}${newline}${newline}`).join(""));
    // Split every byte, including delimiters and multibyte Unicode characters.
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      }
    });
    const actual = [];
    await readEvents(stream, (event) => actual.push(event));
    assert.deepEqual(actual, expected);
  });
}

test("delivers events before the connection closes", async () => {
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const expected = { type: "thinking", step: 1 };
  let received;
  const eventReceived = new Promise((resolve) => { received = resolve; });
  const reading = readEvents(stream, received);
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(expected)}\n\n`));
  assert.deepEqual(await eventReceived, expected);
  controller.close();
  await reading;
});
