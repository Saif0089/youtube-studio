const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const logEl = $("log");

function log(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

listen("progress", (e) => log(e.payload));

$("make").onclick = async () => {
  $("make").disabled = true;
  $("progress").classList.remove("hidden");
  $("result").classList.add("hidden");
  $("uploadResult").classList.add("hidden");
  logEl.textContent = "";
  $("spin").classList.remove("hidden");
  $("statusText").textContent = "Generating… this takes a few minutes";
  try {
    await invoke("generate", {
      words: $("words").value,
      voice: $("voice").value,
      imageProvider: $("provider").value,
    });
    $("spin").classList.add("hidden");
    $("statusText").textContent = "Done";
    $("result").classList.remove("hidden");
    $("upload").disabled = false;
    $("upload").textContent = "⬆ Upload to YouTube (private)";
  } catch (err) {
    $("spin").classList.add("hidden");
    $("statusText").textContent = "Failed";
    log("ERROR: " + err);
  } finally {
    $("make").disabled = false;
  }
};

$("preview").onclick = () => invoke("open_preview").catch((e) => log("Preview error: " + e));

$("upload").onclick = async () => {
  $("upload").disabled = true;
  $("upload").textContent = "Uploading…";
  try {
    const url = await invoke("upload");
    $("reviewLink").textContent = url;
    $("reviewLink").onclick = (e) => { e.preventDefault(); invoke("open_url", { url }); };
    $("uploadResult").classList.remove("hidden");
    $("upload").textContent = "✅ Uploaded";
  } catch (err) {
    log("UPLOAD ERROR: " + err);
    $("upload").textContent = "⬆ Upload (retry)";
    $("upload").disabled = false;
  }
};
