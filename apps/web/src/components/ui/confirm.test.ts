import { describe, expect, it } from "vitest";
import { createConfirmQueue } from "./confirm";

describe("createConfirmQueue", () => {
  it("resolves true when confirmed and false when cancelled", async () => {
    const q = createConfirmQueue();
    const first = q.ask({ title: "Kick?" });
    const id = q.current.value!.id;
    q.answer(id, true);
    await expect(first).resolves.toBe(true);
    expect(q.current.value).toBeNull();

    const second = q.ask({ title: "Ban?" });
    q.answer(q.current.value!.id, false);
    await expect(second).resolves.toBe(false);
  });

  it("shows queued prompts one after another, in order", async () => {
    const q = createConfirmQueue();
    const a = q.ask({ title: "A" });
    const b = q.ask({ title: "B", danger: true });
    expect(q.current.value?.title).toBe("A");

    q.answer(q.current.value!.id, true);
    expect(q.current.value?.title).toBe("B");
    expect(q.current.value?.danger).toBe(true);

    q.answer(q.current.value!.id, false);
    await expect(Promise.all([a, b])).resolves.toEqual([true, false]);
  });

  it("ignores an answer for a prompt that is already gone", async () => {
    const q = createConfirmQueue();
    const a = q.ask({ title: "A" });
    const id = q.current.value!.id;
    q.answer(id, false);
    // A double click on the button: the second answer must not touch the next prompt.
    const b = q.ask({ title: "B" });
    q.answer(id, true);
    expect(q.current.value?.title).toBe("B");
    await expect(a).resolves.toBe(false);
    q.answer(q.current.value!.id, true);
    await expect(b).resolves.toBe(true);
  });

  it("cancelAll declines everything waiting", async () => {
    const q = createConfirmQueue();
    const all = Promise.all([q.ask({ title: "A" }), q.ask({ title: "B" })]);
    q.cancelAll();
    await expect(all).resolves.toEqual([false, false]);
    expect(q.current.value).toBeNull();
  });
});
