// --- Existing imports remain unchanged ---
import express from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import mammoth from "mammoth";
import { HfInference } from "@huggingface/inference";
import cors from "cors";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000; // ✅ Render uses process.env.PORT

// Correct __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from frontend & images folder
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/images", express.static(path.join(__dirname, "../images")));

app.use(cors());

// Multer storage
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

// Hugging Face API init
const hf = new HfInference(process.env.HF_API_KEY);

// ------------------ RESUME REVIEW ------------------
app.post("/upload", upload.single("resume"), async (req, res) => {
  const uploadPath = path.join(__dirname, "uploads", req.file.filename);

  try {
    const dataBuffer = await fs.readFile(uploadPath);
    let resumeText = "";

    if (req.file.mimetype === "application/pdf") {
      const pdfData = await pdfParse(dataBuffer);
      resumeText = pdfData.text;
    } else if (
      req.file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      req.file.mimetype === "application/msword"
    ) {
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      resumeText = result.value;
    } else {
      return res
        .status(400)
        .json({ error: "Unsupported file type. Upload a PDF or DOCX." });
    }

    if (!resumeText.trim()) {
      return res
        .status(400)
        .json({ error: "Could not extract text from resume." });
    }

    const result = await hf.chatCompletion({
      model: "mistralai/Mistral-7B-Instruct-v0.3",
      messages: [
        {
          role: "system",
          content:
            "You are an expert resume reviewer. Provide structured, professional, and constructive feedback. Format the response in clean, well-structured Markdown with clear section headings, bullet points, and bold highlights where needed.",
        },
        {
          role: "user",
          content: `Please review this resume for:
1. Overall Impression
2. Strengths
3. Areas for Improvement
4. ATS Compatibility Score (0–100)
5. Suggested Action Items

Resume:
${resumeText}`,
        },
      ],
      max_tokens: 800,
    });

    const outputText = result?.choices?.[0]?.message?.content || null;

    if (!outputText) {
      throw new Error("No valid response from Hugging Face");
    }

    res.status(200).json({ analysis: outputText });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Server error while analyzing resume." });
  } finally {
    try {
      await fs.unlink(uploadPath); // ✅ cleanup
    } catch {}
  }
});

// ------------------ KEYWORD MATCH FEATURE ------------------
app.post("/api/keyword-match", upload.single("resume"), async (req, res) => {
  const uploadPath = path.join(__dirname, "uploads", req.file.filename);

  try {
    const dataBuffer = await fs.readFile(uploadPath);
    const pdfData = await pdfParse(dataBuffer);
    const resumeText = pdfData.text;

    const jobDescription = req.body.jobDescription || "";
    const jobWords = jobDescription.toLowerCase().split(/\W+/);
    const resumeWords = resumeText.toLowerCase().split(/\W+/);

    const missing = jobWords.filter((w) => w && !resumeWords.includes(w));
    const matchScore = jobWords.length
      ? Math.round(
          ((jobWords.length - missing.length) / jobWords.length) * 100
        )
      : 0;

    res.json({ matchScore, missing });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Something went wrong on server" });
  } finally {
    try {
      await fs.unlink(uploadPath); // ✅ cleanup
    } catch {}
  }
});

// ------------------ HTML Serving ------------------
app.get("/:page", (req, res, next) => {
  const filePath = path.join(__dirname, "../frontend", req.params.page);
  if (path.extname(filePath) === ".html") {
    res.sendFile(filePath);
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});

