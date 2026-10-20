const $ = (id) => document.getElementById(id);
const { ReceiverSession, fitScanSize } = globalThis.QRAirGap;

const elements = {
  video: $("camera-video"),
  canvas: $("scan-canvas"),
  cameraStage: document.querySelector(".camera-stage"),
  cameraButton: $("camera-button"),
  resetButton: $("reset-button"),
  cameraState: $("camera-state"),
  progress: $("receive-progress"),
  percent: $("receive-percent"),
  count: $("received-count"),
  status: $("receive-status"),
  fileCard: $("receive-file-card"),
  fileName: $("receive-file-name"),
  fileSize: $("receive-file-size"),
  hash: $("receive-hash"),
  eventTitle: $("event-title"),
  eventDetail: $("event-detail"),
  download: $("download-button"),
};

const context = elements.canvas.getContext("2d", { willReadFrequently: true });
let receiver = new ReceiverSession();
let stream = null;
let scanning = false;
let lastScanAt = 0;
let lastRawFrame = "";
let lastRawFrameAt = 0;
let downloadUrl = null;

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(2)} MB`;
}

function setEvent(title, detail, error = false) {
  elements.eventTitle.textContent = title;
  elements.eventDetail.textContent = detail;
  document.querySelector(".event-dot").style.background = error ? "#ff9a7a" : "var(--lime)";
}

function updateProgress() {
  const { received, total } = receiver.progress;
  const percent = total ? Math.round((received / total) * 100) : 0;
  elements.percent.textContent = String(percent);
  elements.progress.style.width = `${percent}%`;
  elements.count.textContent = `${received} / ${total} 帧`;
  if (receiver.meta) {
    elements.fileCard.classList.remove("empty-card");
    elements.fileName.textContent = receiver.meta.name;
    elements.fileSize.textContent = `${formatBytes(receiver.meta.size)} · ${receiver.meta.total} 个数据分片`;
    elements.hash.textContent = `SHA-256 ${receiver.meta.sha256}`;
  }
}

async function completeTransfer() {
  elements.status.textContent = "正在校验完整文件";
  setEvent("分片已收齐", "正在进行 SHA-256 完整性校验");
  try {
    const result = await receiver.finalize();
    const blob = new Blob([result.bytes], { type: result.type });
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    stopCamera();
    elements.download.disabled = false;
    elements.download.dataset.filename = result.name;
    elements.status.textContent = "校验成功，可以下载";
    elements.cameraState.textContent = "接收完成";
    elements.cameraState.classList.add("good");
    setEvent("文件校验通过", `${result.name} 的大小和 SHA-256 均一致`);
  } catch (error) {
    elements.status.textContent = "校验失败";
    setEvent("无法恢复文件", error.message, true);
  }
}

async function handleFrame(raw) {
  if (raw === lastRawFrame && performance.now() - lastRawFrameAt < 800) return;
  lastRawFrame = raw;
  lastRawFrameAt = performance.now();
  try {
    const result = receiver.accept(raw);
    updateProgress();
    if (result.status === "metadata") {
      elements.status.textContent = "元数据已识别，等待数据帧";
      setEvent("文件信息已识别", `准备接收 ${receiver.meta.total} 个数据分片`);
    } else if (result.status === "duplicate") {
      elements.status.textContent = "重复帧已自动忽略";
    } else if (result.status === "complete") {
      await completeTransfer();
    } else {
      elements.status.textContent = `正在接收第 ${result.progress.received} 个分片`;
      setEvent("收到有效数据帧", `已完成 ${result.progress.received} / ${result.progress.total}`);
    }
  } catch (error) {
    if (/Not a QR AirGap frame/.test(error.message)) return;
    setEvent("二维码未被接受", error.message, true);
  }
}

function scanLoop(timestamp) {
  if (!scanning) return;
  if (timestamp - lastScanAt >= 90 && elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    lastScanAt = timestamp;
    if (elements.video.videoWidth && elements.video.videoHeight) {
      const { width, height } = fitScanSize(elements.video.videoWidth, elements.video.videoHeight);
      if (elements.canvas.width !== width) elements.canvas.width = width;
      if (elements.canvas.height !== height) elements.canvas.height = height;
      context.drawImage(elements.video, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const result = jsQR(imageData.data, width, height, { inversionAttempts: "dontInvert" });
      if (result?.data) handleFrame(result.data);
    }
  }
  requestAnimationFrame(scanLoop);
}

async function startCamera() {
  if (stream) {
    stopCamera();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setEvent("浏览器无法调用摄像头", "请使用新版 Chrome、Edge 或 Safari，并通过本地服务打开页面", true);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    elements.video.srcObject = stream;
    await elements.video.play();
    scanning = true;
    elements.cameraStage.classList.add("running");
    elements.cameraState.textContent = "正在扫描";
    elements.cameraState.classList.add("good");
    elements.cameraButton.textContent = "停止摄像头";
    setEvent("摄像头已启动", "请先扫描发送端显示的元数据帧");
    requestAnimationFrame(scanLoop);
  } catch (error) {
    setEvent("无法启动摄像头", `${error.name}：请检查系统和浏览器权限`, true);
  }
}

function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  elements.video.srcObject = null;
  elements.cameraStage.classList.remove("running");
  elements.cameraState.textContent = "摄像头已停止";
  elements.cameraState.classList.remove("good");
  elements.cameraButton.textContent = "启动摄像头";
}

function resetTransfer() {
  receiver = new ReceiverSession();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  elements.download.disabled = true;
  elements.download.removeAttribute("data-filename");
  elements.percent.textContent = "0";
  elements.progress.style.width = "0%";
  elements.count.textContent = "0 / 0 帧";
  elements.status.textContent = "等待元数据帧";
  elements.fileCard.classList.add("empty-card");
  elements.fileName.textContent = "尚未识别文件";
  elements.fileSize.textContent = "先扫描发送端显示的第 1 帧";
  elements.hash.textContent = "SHA-256 —";
  lastRawFrame = "";
  setEvent("已清空接收记录", "可以开始新的传输");
}

elements.cameraButton.addEventListener("click", startCamera);
elements.resetButton.addEventListener("click", resetTransfer);
elements.download.addEventListener("click", () => {
  if (!downloadUrl) return;
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = elements.download.dataset.filename || "received-file";
  link.click();
});
window.addEventListener("beforeunload", stopCamera);
