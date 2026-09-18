import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const accepted = process.argv.includes("--accept-research-license");
const fullDataset = process.argv.includes("--full");
if (!accepted) {
  console.error(
    [
      "Research assets were not downloaded.",
      "MathWriting is CC BY-NC-SA 4.0 and must not enter production model lineage.",
      "After legal approval, rerun with --accept-research-license.",
    ].join("\n"),
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const prototype = path.join(root, "prototype/constraint-decoding");
const modelDirectory = path.join(prototype, "public/models");
const dataDirectory = path.join(prototype, "data");
const cacheDirectory = path.join(root, ".poc-cache");
await Promise.all(
  [modelDirectory, dataDirectory, cacheDirectory].map((directory) =>
    mkdir(directory, { recursive: true }),
  ),
);

const assets = [
  {
    name: "encoder.onnx",
    url: "https://huggingface.co/m4jkiuwr/htt-mini/resolve/main/encoder.onnx?download=true",
    sha256: "2b56c120cd5b760637572fc5c35012dcf14c7e923ca3362d54fdd54ddc6ef719",
  },
  {
    name: "decoder_step.onnx",
    url: "https://huggingface.co/m4jkiuwr/htt-mini/resolve/main/decoder_step.onnx?download=true",
    sha256: "a06a382a4b21445e0ef4d5ba33db4dc4eb9250ca4ff4bace7a90d50342ef18ed",
  },
  {
    name: "vocab.json",
    url: "https://raw.githubusercontent.com/Projekt-Deep-Learning-2026/hand-to-tex/main/web/public/assets/vocab.json",
    sha256: "04eb943751749d1d88312e5b8450f48b70efded4bf92abf3041c49e97a490222",
  },
];

for (const asset of assets)
  await download(asset.url, path.join(modelDirectory, asset.name), "sha256", asset.sha256);

const dataset = fullDataset
  ? {
      archive: "mathwriting-2024.tgz",
      folder: "mathwriting-2024",
      url: "https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz",
      algorithm: "md5",
      digest: "f2d59c44a545347a5f67ac70fef7a13d",
    }
  : {
      archive: "mathwriting-2024-excerpt.tgz",
      folder: "mathwriting-2024-excerpt",
      url: "https://storage.googleapis.com/mathwriting_data/mathwriting-2024-excerpt.tgz",
      algorithm: "sha256",
      digest: "cba038def001480a89962b25cb20a60df4c4145e94c86ef9d2af65f192cb82bc",
    };

const archivePath = path.join(cacheDirectory, dataset.archive);
await download(dataset.url, archivePath, dataset.algorithm, dataset.digest);
const extracted = path.join(dataDirectory, dataset.folder, "test");
if (!(await exists(extracted))) {
  const result = spawnSync(
    "tar",
    ["-xzf", archivePath, "-C", dataDirectory, `${dataset.folder}/test`],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error(`tar exited with ${result.status}`);
}

console.log(`\nReady: ${modelDirectory}`);
console.log(`Dataset: ${extracted}`);
if (!fullDataset)
  console.log("Excerpt contains 100 test samples. Use --full for the planned 500-sample report.");

async function download(url, destination, algorithm, expectedDigest) {
  if (await exists(destination)) {
    const currentDigest = await digestFile(destination, algorithm);
    if (currentDigest === expectedDigest) {
      console.log(`Verified ${path.basename(destination)}`);
      return;
    }
    await rm(destination);
  }
  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  console.log(`Downloading ${path.basename(destination)}...`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  const downloadedDigest = await digestFile(temporary, algorithm);
  if (downloadedDigest !== expectedDigest) {
    await rm(temporary, { force: true });
    throw new Error(`${path.basename(destination)} checksum mismatch: ${downloadedDigest}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(temporary, destination);
}

async function digestFile(file, algorithm) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
