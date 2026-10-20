const $ = (id) => document.getElementById(id);
const {
  createTransfer,
  validateFileSize,
} = globalThis.QRAirGap;

const elements = {
  fileInput: $("file-input"),
  chunkSize: $("chunk-size-input"),
  interval: $("interval-input"),
  fileCard: $("file-card"),
  fileName: $("file-name"),
  fileSize: $("file-size"),
  frameTotal: $("frame-total"),
  timeEstimate: $("time-estimate"),
  fileHash: $("file-hash"),
  output: $("qr-output"),
  frameKind: $("frame-kind"),
  frameCounter: $("frame-counter"),
  progress: $("send-progress"),
  previous: $("previous-button"),
  play: $("play-button"),
  next: $("next-button"),
  fullscreen: $("fullscreen-button"),
  message: $("sender-message"),
};

let transfer = null;
let frameIndex = 0;
let timer = null;
let preparingToken = 0;

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function formatDuration(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} 分 ${rest} 秒`;
}

function setControls(enabled) {
  for (const button of [elements.previous, elements.play, elements.next, elements.fullscreen]) {
    button.disabled = !enabled;
  }
}

function stopPlayback() {
  if (timer) clearInterval(timer);
  timer = null;
  elements.play.textContent = "开始播放";
}

function renderFrame() {
  if (!transfer) return;
  const rawFrame = transfer.frames[frameIndex];
  const qr = qrcode(0, "L");
  qr.addData(rawFrame, "Byte");
  qr.make();
  const moduleCount = qr.getModuleCount();
  const cellSize = Math.max(3, Math.min(7, Math.floor(760 / moduleCount)));
  const image = document.createElement("img");
  image.alt = `传输二维码，第 ${frameIndex + 1} 帧，共 ${transfer.frames.length} 帧`;
  image.src = qr.createDataURL(cellSize, cellSize * 4);
  elements.output.replaceChildren(image);
  elements.output.classList.remove("empty");
  elements.frameKind.textContent = frameIndex === 0 ? "元数据帧" : "文件数据";
  elements.frameKind.classList.add("good");
  elements.frameCounter.textContent = `${frameIndex + 1} / ${transfer.frames.length}`;
  elements.progress.style.width = `${((frameIndex + 1) / transfer.frames.length) * 100}%`;
  elements.message.textContent = frameIndex === 0
    ? "先让接收端成功识别这一帧，再点击“开始播放”。"
    : `正在显示数据帧 ${frameIndex} / ${transfer.meta.total}`;
}

function moveFrame(delta) {
  if (!transfer) return;
  frameIndex = (frameIndex + delta + transfer.frames.length) % transfer.frames.length;
  renderFrame();
}

async function prepareFile(file) {
  stopPlayback();
  const token = ++preparingToken;
  setControls(false);
  elements.message.textContent = "正在读取文件并计算 SHA-256…";
  try {
    validateFileSize(file.size);
    const data = new Uint8Array(await file.arrayBuffer());
    const chunkSize = Number(elements.chunkSize.value);
    const prepared = await createTransfer(data, { name: file.name, type: file.type }, chunkSize);
    if (token !== preparingToken) return;
    transfer = prepared;
    frameIndex = 0;
    elements.fileName.textContent = prepared.meta.name;
    elements.fileSize.textContent = formatBytes(prepared.meta.size);
    elements.frameTotal.textContent = `${prepared.meta.total} 帧`;
    elements.timeEstimate.textContent = formatDuration(prepared.frames.length * Number(elements.interval.value));
    elements.fileHash.textContent = `SHA-256 ${prepared.meta.sha256}`;
    elements.fileCard.classList.remove("hidden");
    setControls(true);
    renderFrame();
    if (file.size > 20 * 1024 * 1024) {
      elements.message.textContent = "文件超过 20 MB，二维码传输会很慢；建议先压缩、加密并拆分。";
    }
  } catch (error) {
    transfer = null;
    elements.message.textContent = `准备失败：${error.message}`;
  }
}

elements.fileInput.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  if (file) prepareFile(file);
});

elements.chunkSize.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  if (file) prepareFile(file);
});

elements.interval.addEventListener("change", () => {
  if (transfer) {
    elements.timeEstimate.textContent = formatDuration(transfer.frames.length * Number(elements.interval.value));
    if (timer) {
      stopPlayback();
      elements.play.click();
    }
  }
});

elements.previous.addEventListener("click", () => { stopPlayback(); moveFrame(-1); });
elements.next.addEventListener("click", () => { stopPlayback(); moveFrame(1); });
elements.play.addEventListener("click", () => {
  if (!transfer) return;
  if (timer) {
    stopPlayback();
    elements.message.textContent = "播放已暂停。";
    return;
  }
  if (frameIndex === 0) frameIndex = 1 % transfer.frames.length;
  renderFrame();
  timer = setInterval(() => moveFrame(1), Number(elements.interval.value));
  elements.play.textContent = "暂停播放";
});

elements.fullscreen.addEventListener("click", async () => {
  document.body.classList.toggle("fullscreen-qr");
  if (document.body.classList.contains("fullscreen-qr")) {
    try { await document.documentElement.requestFullscreen?.(); } catch { /* CSS fullscreen still works. */ }
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) document.body.classList.remove("fullscreen-qr");
});
