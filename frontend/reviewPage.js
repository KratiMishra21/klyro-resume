document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeUploadForm");
  const fileInput = document.getElementById("resumeFile");
  const uploadStatus = document.getElementById("uploadStatus");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const file = fileInput.files[0];
    if (!file) {
      uploadStatus.innerHTML = "❌ Please choose a file first.";
      return;
    }

    uploadStatus.innerHTML = "🔄 Uploading and analyzing your resume... Please wait.";



    const formData = new FormData();
    formData.append("resume", file);

    try {
      const API_BASE_URL = window.location.hostname === "localhost"
  ? "http://localhost:3000"
  : "https://klyro-resume-38rn.onrender.com";

const response = await fetch(`${API_BASE_URL}/upload`, {
  method: "POST",
  body: formData,
});


      if (!response.ok) {
        throw new Error("Server error while analyzing resume.");
      }

      const result = await response.json();

      uploadStatus.innerHTML = `
        ✅ <strong>Analysis Complete!</strong><br><br>
        <div style="white-space: pre-wrap;">${result.analysis}</div>
      `;
    } catch (error) {
      console.error("❌ Error:", error);
      uploadStatus.innerHTML = "❌ Something went wrong. Please try again.";
    }
  });
});
