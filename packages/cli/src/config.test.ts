import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "./config";

const savedEnv = { ...process.env };
let dir: string;
let path: string;

beforeEach(() => {
  for (const k of ["URL", "TOKEN", "MACHINE_ID", "PAYLOAD"]) delete process.env[`BINGBONG_${k}`];
  dir = mkdtempSync(join(tmpdir(), "bingbong-config-"));
  path = join(dir, "nested", "config.json");
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(dir, { recursive: true, force: true });
});

test("defaults when the file is missing", () => {
  expect(loadConfig(path)).toEqual({
    url: "http://localhost:3334",
    token: undefined,
    machine_id: hostname(),
    payload: "metadata",
  });
});

test("reads file values and strips trailing slash", () => {
  saveConfig({ url: "https://bb.example.com/", token: "secret", machine_id: "box", payload: "full" }, path);
  expect(loadConfig(path)).toEqual({
    url: "https://bb.example.com",
    token: "secret",
    machine_id: "box",
    payload: "full",
  });
});

test("env overrides file", () => {
  saveConfig({ url: "https://file", machine_id: "file-box", payload: "full" }, path);
  process.env.BINGBONG_URL = "http://env:1";
  process.env.BINGBONG_MACHINE_ID = "env-box";
  process.env.BINGBONG_TOKEN = "env-token";
  process.env.BINGBONG_PAYLOAD = "metadata";
  expect(loadConfig(path)).toEqual({
    url: "http://env:1",
    token: "env-token",
    machine_id: "env-box",
    payload: "metadata",
  });
});

test("save merges, preserves unknown keys, unsets with undefined", () => {
  saveConfig({ url: "https://a", token: "t" }, path);
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  writeFileSync(path, JSON.stringify({ ...raw, extra: 42 }));

  const merged = saveConfig({ machine_id: "m", token: undefined }, path);
  expect(merged.url).toBe("https://a");
  expect(merged.machine_id).toBe("m");
  expect(merged.token).toBeUndefined();
  expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ url: "https://a", extra: 42, machine_id: "m" });
});

test("malformed JSON throws (load and save) and leaves the file alone", () => {
  saveConfig({}, path); // creates the dir
  writeFileSync(path, '{"token": "sec');
  expect(() => loadConfig(path)).toThrow(path);
  expect(() => saveConfig({ url: "https://b" }, path)).toThrow(path);
  expect(readFileSync(path, "utf-8")).toBe('{"token": "sec');
});

test("non-object document or wrong-typed known key throws", () => {
  saveConfig({}, path);
  for (const bad of ['{"token":123}', '{"payload":"everything"}', '{"url":null}', "[]", "null"]) {
    writeFileSync(path, bad);
    expect(() => loadConfig(path)).toThrow(path);
  }
});

test.skipIf(process.platform === "win32")("config is written 0600, tightening an existing file", () => {
  saveConfig({ token: "t" }, path);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  chmodSync(path, 0o644);
  saveConfig({ url: "https://c" }, path);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});
