document.getElementById("resumeUploadForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    const fileInput = document.getElementById("resumeFile");
    const jobDescription = document.getElementById("jobDescription").value;
    const uploadStatus = document.getElementById("uploadStatus");

    if (!fileInput.files.length) {
        alert("Please upload a resume first!");
        return;
    }

    if (!jobDescription.trim()) {
        alert("Please paste a job description!");
        return;
    }

    const formData = new FormData();
    formData.append("resume", fileInput.files[0]);
    formData.append("jobDescription", jobDescription);

    uploadStatus.textContent = "Uploading and analyzing your resume...";

    try {
        const res = await fetch("/api/keyword-match", {
            method: "POST",
            body: formData
        });

        const data = await res.json();
        console.log(data);

        document.getElementById("matchScore").textContent = `${data.matchScore}% match`;
        document.getElementById("missingKeywords").textContent = `Missing keywords: ${data.missing.join(", ")}`;

        uploadStatus.textContent = "Analysis complete!";
    } catch (error) {
        console.error("Error:", error);
        uploadStatus.textContent = "Error analyzing your resume.";
    }
});
