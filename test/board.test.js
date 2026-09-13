import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Board } from "../src/relay/board.js";

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "videotext-board-"));
}

test("status persists across a simulated relay restart", () => {
    const dir = tmpDir();
    const first = new Board(dir);
    first.recordFetch({ battery: 4.0, rssi: -60, fw: "1", page: 205, reason: "timer" }, 1000);
    first.recordRedraw(1000);

    const second = new Board(dir); // simulates a fresh process reading the same dataDir
    const snapshot = second.snapshot();
    assert.equal(snapshot.battery, 4.0);
    assert.equal(snapshot.page, 205);
    assert.equal(snapshot.lastRedrawAt, 1000);
});

test("battery hysteresis: 3.3V sets low, 3.5V leaves it low, 3.7V clears it", () => {
    const board = new Board(tmpDir());
    board.recordFetch({ battery: 3.3, page: 100, reason: "timer" }, 1000);
    assert.equal(board.snapshot().batteryLow, true);

    board.recordFetch({ battery: 3.5, page: 100, reason: "timer" }, 2000);
    assert.equal(board.snapshot().batteryLow, true);

    board.recordFetch({ battery: 3.7, page: 100, reason: "timer" }, 3000);
    assert.equal(board.snapshot().batteryLow, false);
});

test("a button reason updates lastButtonAt; a timer reason does not", () => {
    const board = new Board(tmpDir());
    board.recordFetch({ page: 100, reason: "button" }, 1000);
    assert.equal(board.snapshot().lastButtonAt, 1000);
    board.recordFetch({ page: 100, reason: "timer" }, 2000);
    assert.equal(board.snapshot().lastButtonAt, 1000);
});

test("recordUrgentBypass stamps lastUrgentBypassAt", () => {
    const board = new Board(tmpDir());
    board.recordUrgentBypass(5000);
    assert.equal(board.snapshot().lastUrgentBypassAt, 5000);
});

test("recordUrgentAck stamps lastUrgentAckAt with the banner page's urgentSince, not the current time", () => {
    const board = new Board(tmpDir());
    board.recordUrgentAck(4200);
    assert.equal(board.snapshot().lastUrgentAckAt, 4200);
});
