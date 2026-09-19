import assert from "node:assert/strict";
import test from "node:test";
import { filesAppUrl, openFilesApp } from "@olares/lares-core/files/app-link";

const entrance = "https://489966aa.alice.olares.com";

test("Files app links keep the current Olares public or LAN zone", () => {
  assert.equal(
    filesAppUrl("drive/Home/Documents/report 1.pdf", { entrance }),
    "https://files.alice.olares.com/Files/Home/Documents/report%201.pdf",
  );
  assert.equal(
    filesAppUrl("drive/Home/Movies/a.mp4", { entrance: "http://489966aa.alice.olares.local" }),
    "http://files.alice.olares.local/Files/Home/Movies/a.mp4",
  );
});

test("Files app links map every previewable backend namespace", () => {
  const cases = [
    ["drive/Data/app/file.txt", "/Data/app/file.txt"],
    ["drive/Common/team/file.txt", "/Common/team/file.txt"],
    ["cache/node-a/tmp/file.txt", "/Cache/node-a/tmp/file.txt"],
    ["external/node-a/disk/file.txt", "/Files/External/node-a/disk/file.txt"],
    ["google/account-a/folder/file.txt", "/Drive/google/account-a/folder/file.txt"],
    ["dropbox/account-a/folder/file.txt", "/Drive/dropbox/account-a/folder/file.txt"],
    ["awss3/account-a/folder/file.txt", "/Drive/awss3/account-a/folder/file.txt"],
    ["tencent/account-a/folder/file.txt", "/Drive/tencent/account-a/folder/file.txt"],
    ["sync/repo-id/folder/file.txt", "/Seahub/repo-id/folder/file.txt?id=repo-id"],
  ];
  for (const [path, expected] of cases) {
    assert.equal(filesAppUrl(path, { entrance }), `https://files.alice.olares.com${expected}`);
  }
});

test("packaged clients can build a Files link from their account domain", () => {
  assert.equal(
    filesAppUrl("drive/Home/notes.txt", {
      entrance: "capacitor://localhost",
      accountDomain: "alice.olares.com",
      protocol: "https:",
    }),
    "https://files.alice.olares.com/Files/Home/notes.txt",
  );
});

test("opening a Files path uses a new noopener tab and rejects untrusted origins", () => {
  const opened: unknown[][] = [];
  assert.equal(openFilesApp("drive/Home/notes.txt", {
    entrance,
    open: (...args: unknown[]) => opened.push(args),
  }), true);
  assert.deepEqual(opened, [[
    "https://files.alice.olares.com/Files/Home/notes.txt",
    "_blank",
    "noopener,noreferrer",
  ]]);
  assert.equal(filesAppUrl("drive/Home/notes.txt", { entrance: "https://evil.example" }), "");
  assert.equal(filesAppUrl("drive/Home/notes.txt", { entrance: "ftp://app.alice.olares.com" }), "");
  assert.equal(filesAppUrl("../notes.txt", { entrance }), "");
});
